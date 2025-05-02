import React, { createContext, useContext, useEffect, useState } from 'react';
import { type User } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';

interface UserContextType {
    user: User | null;
    isAnonymous: boolean;
    email: string | null;
    code: string | null;
    setEmail: (val: string) => void;
    setCode: (val: string) => void;
    login: () => Promise<void>;
    verifyCode: () => Promise<void>;
    logout: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    const [user, setUser] = useState<User | null>(null);
    const [isAnonymous, setIsAnonymous] = useState(true);
    const [email, setEmail] = useState<string | null>(null);
    const [code, setCode] = useState<string | null>(null);

    useEffect(() => {
        const init = async () => {
            const { data } = await supabase.auth.getSession();
            let currentUser = data.session?.user;

            if (!currentUser) {
                const { data: anon } = await supabase.auth.signInAnonymously();
                currentUser = anon.user!;
            }

            setUser(currentUser);
            setIsAnonymous(currentUser.is_anonymous ?? false);
            setEmail(currentUser.email ?? null);
        };
        init();
    }, []);

    const login = async () => {
        await supabase.auth.signInWithOtp({ email: email! });
    };

    const verifyCode = async () => {
        const { data } = await supabase.auth.verifyOtp({
            email: email!,
            token: code!,
            type: 'email',
        });
        if (data.user) {
            await supabase.auth.updateUser({ email: email! });
            setUser(data.user);
            setIsAnonymous(false);
        }
    };

    const logout = async () => {
        await supabase.auth.signOut();
        setUser(null);
        setIsAnonymous(true);
        setEmail(null);
        setCode(null);
    };

    return (
        <UserContext.Provider
            value={{
                user,
                isAnonymous,
                email,
                code,
                setEmail,
                setCode,
                login,
                verifyCode,
                logout,
            }}>
            {children}
        </UserContext.Provider>
    );
};

export const useUser = () => {
    const context = useContext(UserContext);
    if (!context) throw new Error('useUser must be used within a UserProvider');
    return context;
};
