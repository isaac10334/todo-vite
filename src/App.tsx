import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Check,
    Play,
    Pause,
    SkipBack,
    SkipForward,
    Envelope,
    SignOut,
} from '@phosphor-icons/react';
import Confetti from 'react-confetti';
import { useUser } from './UserProvider';
import { supabase } from './lib/supabase';
import { LoroDoc, UndoManager, LoroList } from 'loro-crdt';
import { useEventListener } from 'usehooks-ts';
import { useInterval } from 'usehooks-ts';

// Types
interface TodoForRender {
    id: string;
    text: string;
    completed: boolean;
}

interface Workspace {
    id: string;
    user_id: string;
    name: string;
    data: string;
}

function hexToUint8Array(hex: string) {
    const clean = hex.startsWith('\\x') ? hex.slice(2) : hex;
    const arr = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
        arr[i / 2] = parseInt(clean.slice(i, i + 2), 16);
    }
    return arr;
}

function uint8ArrayToHex(arr: Uint8Array) {
    return (
        '\\x' +
        Array.from(arr)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('')
    );
}

// --- Timer Component ---
const Timer: React.FC<{
    workspaceId: string | null;
}> = ({ workspaceId }) => {
    const [duration, setDuration] = useState(25 * 60); // seconds
    const [isRunning, setIsRunning] = useState(false);
    const [timeLeft, setTimeLeft] = useState(duration);
    const [editing, setEditing] = useState(false);
    const [editMinutes, setEditMinutes] = useState(Math.floor(duration / 60));
    const [editSeconds, setEditSeconds] = useState(duration % 60);
    const [editField, setEditField] = useState<'none' | 'minutes' | 'seconds'>(
        'none'
    );

    // Fetch timer state from Supabase workspace
    useEffect(() => {
        if (!workspaceId) return;
        (async () => {
            const { data } = await supabase
                .from('workspaces')
                .select('timer_duration, timer_value, timer_running')
                .eq('id', workspaceId)
                .single();
            if (data) {
                setDuration(data.timer_duration ?? 25 * 60);
                setTimeLeft(data.timer_value ?? data.timer_duration ?? 25 * 60);
                setIsRunning(!!data.timer_running);
            }
        })();
    }, [workspaceId]);

    // Subscribe to timer changes in Supabase (realtime)
    useEffect(() => {
        if (!workspaceId) return;
        const channel = supabase
            .channel('timer-' + workspaceId)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'workspaces',
                    filter: `id=eq.${workspaceId}`,
                },
                (payload) => {
                    const d = payload.new;
                    setDuration(d.timer_duration ?? 25 * 60);
                    setTimeLeft(d.timer_value ?? d.timer_duration ?? 25 * 60);
                    setIsRunning(!!d.timer_running);
                }
            )
            .subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
    }, [workspaceId]);

    // Timer ticking
    useInterval(
        () => {
            if (isRunning && timeLeft > 0) {
                setTimeLeft((prev) => {
                    const next = Math.max(0, prev - 1);
                    // Sync to Supabase every tick
                    if (workspaceId) {
                        supabase
                            .from('workspaces')
                            .update({
                                timer_value: next,
                            })
                            .eq('id', workspaceId);
                    }
                    if (next === 0) setIsRunning(false);
                    return next;
                });
            }
        },
        isRunning ? 1000 : null
    );

    // Start timer
    const handleStart = async () => {
        if (!workspaceId) return;
        setIsRunning(true);
        await supabase
            .from('workspaces')
            .update({
                timer_running: true,
                timer_value: timeLeft,
                timer_duration: duration,
            })
            .eq('id', workspaceId);
    };
    // Pause timer
    const handlePause = async () => {
        if (!workspaceId) return;
        setIsRunning(false);
        await supabase
            .from('workspaces')
            .update({
                timer_running: false,
                timer_value: timeLeft,
                timer_duration: duration,
            })
            .eq('id', workspaceId);
    };
    // Reset timer
    const handleReset = async () => {
        if (!workspaceId) return;
        setIsRunning(false);
        setTimeLeft(duration);
        await supabase
            .from('workspaces')
            .update({
                timer_running: false,
                timer_value: duration,
                timer_duration: duration,
            })
            .eq('id', workspaceId);
    };

    // SVG semi-circle constants
    const radius = 90;
    const stroke = 14;
    const normalizedRadius = radius - stroke / 2;
    const circumference = Math.PI * normalizedRadius;
    const percent = Math.max(0, Math.min(1, timeLeft / duration));
    const offset = circumference * (1 - percent);

    // When entering edit mode, sync edit fields
    useEffect(() => {
        if (editing) {
            setEditMinutes(Math.floor(duration / 60));
            setEditSeconds(duration % 60);
        }
    }, [editing, duration]);

    // Start editing on click
    const handleEditStart = (field: 'minutes' | 'seconds') => {
        setEditing(true);
        setEditField(field);
    };
    // Focus the correct input when entering edit mode
    const minRef = React.useRef<HTMLInputElement>(null);
    const secRef = React.useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (editing) {
            if (editField === 'minutes') minRef.current?.focus();
            else if (editField === 'seconds') secRef.current?.focus();
        }
    }, [editing, editField]);

    // Handle inline edit changes
    const handleMinutesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = Math.max(0, parseInt(e.target.value) || 0);
        setEditMinutes(val);
    };
    const handleSecondsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let val = parseInt(e.target.value) || 0;
        if (val > 59) val = 59;
        if (val < 0) val = 0;
        setEditSeconds(val);
    };
    // Commit edit
    const commitEdit = async () => {
        const total = editMinutes * 60 + editSeconds;
        setDuration(total);
        setTimeLeft(total);
        setEditing(false);
        if (workspaceId) {
            await supabase
                .from('workspaces')
                .update({ timer_duration: total, timer_value: total })
                .eq('id', workspaceId);
        }
    };
    // Keyboard navigation for inline edit
    const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            commitEdit();
        } else if (e.key === 'Tab') {
            // Let tab work naturally
        }
    };

    return (
        <div className='bg-white/20 rounded-2xl shadow-lg p-8 w-[340px] flex flex-col items-center animate-bounce-in'>
            <div className='relative w-64 h-32 flex items-center justify-center'>
                <svg
                    width={radius * 2}
                    height={radius + 2}
                    viewBox={`0 0 ${radius * 2} ${radius + 2}`}
                    className='block'
                    style={{ position: 'relative', top: '6px' }}>
                    {/* Background arc */}
                    <path
                        d={`M${stroke / 2},${
                            radius + 2
                        } A${normalizedRadius},${normalizedRadius} 0 0 1 ${
                            radius * 2 - stroke / 2
                        },${radius + 2}`}
                        fill='none'
                        stroke='#d6bcfa' /* purple-300 */
                        strokeWidth={stroke}
                        strokeLinecap='round'
                    />
                    {/* Progress arc */}
                    <path
                        d={`M${stroke / 2},${
                            radius + 2
                        } A${normalizedRadius},${normalizedRadius} 0 0 1 ${
                            radius * 2 - stroke / 2
                        },${radius + 2}`}
                        fill='none'
                        stroke='#7c3aed' /* purple-600 */
                        strokeWidth={stroke}
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        strokeLinecap='round'
                        style={{ transition: 'stroke-dashoffset 0.5s linear' }}
                    />
                </svg>
                <div
                    className='absolute left-0 right-0 flex flex-col items-center'
                    style={{ top: '78px' }}>
                    {editing ? (
                        <div className='flex items-center gap-1'>
                            <input
                                ref={minRef}
                                type='number'
                                min={0}
                                max={999}
                                value={editMinutes}
                                onChange={handleMinutesChange}
                                onKeyDown={handleEditKeyDown}
                                onBlur={commitEdit}
                                className='w-10 text-3xl text-center rounded bg-transparent border-none focus:bg-white/80 focus:border-purple-200 focus:outline-none transition-colors appearance-none'
                                aria-label='Minutes'
                                style={{ outline: 'none', boxShadow: 'none' }}
                            />
                            <span className='text-3xl font-bold text-purple-800'>
                                :
                            </span>
                            <input
                                ref={secRef}
                                type='number'
                                min={0}
                                max={59}
                                value={editSeconds.toString().padStart(2, '0')}
                                onChange={handleSecondsChange}
                                onKeyDown={handleEditKeyDown}
                                onBlur={commitEdit}
                                className='w-10 text-3xl text-center rounded bg-transparent border-none focus:bg-white/80 focus:border-purple-200 focus:outline-none transition-colors appearance-none'
                                aria-label='Seconds'
                                style={{ outline: 'none', boxShadow: 'none' }}
                            />
                        </div>
                    ) : (
                        <span className='text-4xl font-bold text-purple-800 select-none'>
                            <span
                                className='cursor-pointer hover:underline underline-offset-2 transition-colors'
                                onClick={() => handleEditStart('minutes')}
                                title='Edit minutes'>
                                {Math.floor(timeLeft / 60)}
                            </span>
                            <span>:</span>
                            <span
                                className='cursor-pointer hover:underline underline-offset-2 transition-colors'
                                onClick={() => handleEditStart('seconds')}
                                title='Edit seconds'>
                                {(timeLeft % 60).toString().padStart(2, '0')}
                            </span>
                        </span>
                    )}
                </div>
            </div>
            <div className='flex mt-4'>
                <Button
                    onClick={handleReset}
                    className='mx-1 bg-purple-600 hover:bg-purple-700'
                    size='icon'
                    variant='outline'>
                    <SkipBack />
                </Button>
                <Button
                    onClick={isRunning ? handlePause : handleStart}
                    className='mx-1 bg-purple-600 hover:bg-purple-700'
                    size='icon'
                    variant='outline'>
                    {isRunning ? <Pause /> : <Play />}
                </Button>
                <Button
                    onClick={handlePause}
                    className='mx-1 bg-purple-600 hover:bg-purple-700'
                    size='icon'
                    variant='outline'>
                    <SkipForward />
                </Button>
            </div>
        </div>
    );
};

const App: React.FC = () => {
    const [newTodo, setNewTodo] = useState('');
    const [confetti, setConfetti] = useState(false);
    const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(
        null
    );
    const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(
        null
    );
    const [undoManager, setUndoManager] = useState<UndoManager | null>(null);
    const [loading, setLoading] = useState(true);

    // Auth
    const {
        user,
        isAnonymous,
        email,
        setEmail,
        code,
        setCode,
        login,
        verifyCode,
        logout,
    } = useUser();
    const [authStep, setAuthStep] = useState<'collapsed' | 'email' | 'code'>(
        'collapsed'
    );
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // On mount or user change, fetch or create the workspace
    useEffect(() => {
        if (!user) return;
        setLoading(true);
        (async () => {
            // If we have a workspace ID, fetch that workspace
            if (currentWorkspaceId) {
                const { data: ws, error } = await supabase
                    .from('workspaces')
                    .select('*')
                    .eq('id', currentWorkspaceId)
                    .single();
                if (error || !ws) {
                    setCurrentWorkspace(null);
                    setLoading(false);
                    return;
                }
                setCurrentWorkspace(ws);
                setLoading(false);
                return;
            }
            // Otherwise, fetch all workspaces for the user
            const { data: wsList, error } = await supabase
                .from('workspaces')
                .select('*')
                .eq('user_id', user.id);
            if (error) {
                setLoading(false);
                return;
            }
            if (!wsList || wsList.length === 0) {
                // Create a new workspace with empty data
                const newWorkspaceId = crypto.randomUUID();
                await supabase.from('workspaces').insert({
                    id: newWorkspaceId,
                    user_id: user.id,
                    name: 'My Workspace',
                    data: '', // empty string for empty byte[]
                });
                setCurrentWorkspace({
                    id: newWorkspaceId,
                    user_id: user.id,
                    name: 'My Workspace',
                    data: '',
                });
                setCurrentWorkspaceId(newWorkspaceId);
            } else {
                setCurrentWorkspace(wsList[0]);
                setCurrentWorkspaceId(wsList[0].id);
            }
            setLoading(false);
        })();
    }, [user, currentWorkspaceId]);

    // Always reload the LoroDoc when the workspace changes
    const doc = useMemo(() => {
        if (!currentWorkspace) return null;
        const data = currentWorkspace.data;
        if (!data || data === '' || data === '\\x') {
            // If no data, return a new LoroDoc
            return new LoroDoc();
        }
        try {
            return LoroDoc.fromSnapshot(hexToUint8Array(data));
        } catch {
            // fallback to new doc if corrupted
            return new LoroDoc();
        }
    }, [currentWorkspace]);

    // Set up UndoManager when doc changes
    useEffect(() => {
        if (!doc) return;
        const manager = new UndoManager(doc, { maxUndoSteps: 100 });
        setUndoManager(manager);
    }, [doc]);

    // Subscribe to doc changes for rerender and save
    useEffect(() => {
        if (!doc) return;
        const unsubscribe = doc.subscribe(async () => {
            const bytes = doc.export({ mode: 'snapshot' });
            const hexString = uint8ArrayToHex(bytes);
            if (currentWorkspaceId) {
                await supabase
                    .from('workspaces')
                    .update({ data: hexString })
                    .eq('id', currentWorkspaceId);
            }
        });
        return unsubscribe;
    }, [doc, currentWorkspaceId]);

    // Use a simple synchronized Loro list for todos
    const [todos, setTodos] = useState<TodoForRender[]>([]);
    useEffect(() => {
        if (!doc) {
            setTodos([]);
            return;
        }
        const todosList = doc.getList('todos') as LoroList<TodoForRender>;
        setTodos(todosList.toArray() as TodoForRender[]);
        const unsubscribe = todosList.subscribe(() => {
            setTodos(todosList.toArray() as TodoForRender[]);
        });
        return unsubscribe;
    }, [doc]);

    // Add todo
    const handleAddTodo = useCallback(() => {
        if (!newTodo || !doc) return;
        const todosList = doc.getList('todos') as LoroList<TodoForRender>;
        const todo = {
            id: crypto.randomUUID(),
            text: newTodo,
            completed: false,
        };
        todosList.push(todo);
        setNewTodo('');
        doc.commit();
    }, [newTodo, doc]);

    // Toggle todo
    const handleToggleTodo = useCallback(
        (todoId: string) => {
            if (!doc) return;
            const todosList = doc.getList('todos') as LoroList<TodoForRender>;
            const idx = (todosList.toArray() as TodoForRender[]).findIndex(
                (t) => t.id === todoId
            );
            if (idx === -1) return;
            const todo = todosList.get(idx) as TodoForRender;
            todosList.delete(idx, 1);
            todosList.insert(idx, { ...todo, completed: !todo.completed });
            doc.commit();
        },
        [doc]
    );

    // Undo/Redo
    const handleUndo = useCallback(() => {
        undoManager?.undo();
    }, [undoManager]);
    const handleRedo = useCallback(() => {
        undoManager?.redo();
    }, [undoManager]);

    // Keyboard shortcuts for undo/redo
    useEventListener('keydown', (e) => {
        if (
            (e.ctrlKey || e.metaKey) &&
            !e.shiftKey &&
            e.key.toLowerCase() === 'z'
        ) {
            e.preventDefault();
            handleUndo();
        } else if (
            (e.ctrlKey || e.metaKey) &&
            e.shiftKey &&
            e.key.toLowerCase() === 'z'
        ) {
            e.preventDefault();
            handleRedo();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            handleRedo();
        }
    });

    // Handle send code
    const handleSendCode = async () => {
        setSending(true);
        setError(null);
        try {
            await login();
            setAuthStep('code');
        } catch {
            setError('Failed to send code.');
        } finally {
            setSending(false);
        }
    };
    // Handle verify code
    const handleVerifyCode = async () => {
        setSending(true);
        setError(null);
        try {
            await verifyCode();
        } catch {
            setError('Invalid code.');
        } finally {
            setSending(false);
        }
    };

    if (loading) return <div className='p-8 text-xl'>Loading workspace...</div>;

    return (
        <DndProvider backend={HTML5Backend}>
            <div className='min-h-screen bg-gradient-to-br from-pink-200 via-purple-200 to-blue-200 text-gray-800 font-sans flex'>
                {/* Auth UI */}
                <div className='absolute top-4 right-4 flex gap-2'>
                    {isAnonymous ? (
                        <div className='flex items-center'>
                            {authStep === 'collapsed' && (
                                <Button
                                    className='bg-purple-600 hover:bg-purple-700 px-6 transition-all duration-300'
                                    onClick={() => setAuthStep('email')}>
                                    Link Email
                                </Button>
                            )}
                            {authStep === 'email' && (
                                <div className='flex items-center gap-2 bg-white/80 p-2 rounded-lg shadow-md transition-all duration-300 w-[320px]'>
                                    <Input
                                        value={email || ''}
                                        onChange={(e) =>
                                            setEmail(e.target.value)
                                        }
                                        placeholder='Enter your email'
                                        className='w-48 bg-white/80'
                                        disabled={sending}
                                    />
                                    <Button
                                        className='bg-purple-600 hover:bg-purple-700'
                                        onClick={handleSendCode}
                                        disabled={sending || !email}>
                                        {sending ? 'Sending...' : 'Send Code'}
                                    </Button>
                                </div>
                            )}
                            {authStep === 'code' && (
                                <div className='flex items-center gap-2 bg-white/80 p-2 rounded-lg shadow-md transition-all duration-300 w-[260px]'>
                                    <Input
                                        value={code || ''}
                                        onChange={(e) =>
                                            setCode(e.target.value)
                                        }
                                        placeholder='Enter code'
                                        className='w-24 bg-white/80'
                                        disabled={sending}
                                    />
                                    <Button
                                        className='bg-purple-600 hover:bg-purple-700'
                                        onClick={handleVerifyCode}
                                        disabled={sending || !code}>
                                        {sending ? 'Verifying...' : 'Verify'}
                                    </Button>
                                </div>
                            )}
                            {error && (
                                <span className='ml-2 text-red-500 text-xs'>
                                    {error}
                                </span>
                            )}
                        </div>
                    ) : (
                        <div className='flex items-center gap-2 bg-white/80 p-2 rounded-lg shadow-md'>
                            <Envelope size={20} className='text-purple-800' />
                            <span className='text-purple-800'>
                                {user?.email}
                            </span>
                            <button
                                onClick={logout}
                                title='Log out'
                                className='ml-1 p-1 rounded hover:bg-purple-100 transition-colors'>
                                <SignOut
                                    size={20}
                                    className='text-purple-800'
                                />
                            </button>
                        </div>
                    )}
                </div>

                {/* Todo List - Left */}
                <div className='w-1/2 p-4 bg-white/80 rounded-lg shadow-md overflow-y-auto'>
                    <h1 className='text-2xl font-bold mb-4 text-purple-800'>
                        ADHD Todo List
                    </h1>
                    <div className='flex gap-2 mb-4'>
                        <Input
                            value={newTodo}
                            onChange={(e) => setNewTodo(e.target.value)}
                            placeholder='Add Todo'
                            className='bg-white/80'
                        />
                        <Button
                            onClick={handleAddTodo}
                            className='bg-purple-600 hover:bg-purple-700'>
                            Add
                        </Button>
                        <Button
                            onClick={handleUndo}
                            variant='outline'
                            className='ml-2'>
                            Undo
                        </Button>
                        <Button onClick={handleRedo} variant='outline'>
                            Redo
                        </Button>
                    </div>
                    {todos.length === 0 && (
                        <div className='text-gray-400 text-center my-8'>
                            No todos yet. Add one!
                        </div>
                    )}
                    {todos.map((todo) => (
                        <div
                            key={todo.id}
                            className='p-2 bg-white/60 rounded-lg mb-2 animate-fade-in'>
                            <div className='flex items-center gap-2'>
                                <Button
                                    variant='ghost'
                                    size='sm'
                                    onClick={() => handleToggleTodo(todo.id)}>
                                    <Check
                                        size={16}
                                        className={
                                            todo.completed
                                                ? 'text-green-500'
                                                : 'text-gray-400'
                                        }
                                    />
                                </Button>
                                <span
                                    className={
                                        todo.completed
                                            ? 'line-through text-gray-500'
                                            : ''
                                    }>
                                    {todo.text}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Timer - Right */}
                <div className='w-1/2 p-4 flex justify-center items-center'>
                    <Timer workspaceId={currentWorkspaceId} />
                </div>

                {confetti && (
                    <Confetti
                        width={window.innerWidth}
                        height={window.innerHeight}
                        recycle={false}
                        onConfettiComplete={() => setConfetti(false)}
                    />
                )}
            </div>
        </DndProvider>
    );
};

export default App;
