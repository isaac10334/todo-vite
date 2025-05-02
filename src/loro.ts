import { supabase } from './lib/supabase';
import { LoroDoc } from 'loro-crdt';

// 1. Create a doc and add a todo
const doc = new LoroDoc();
const todos = doc.getList('todos');
todos.push({ id: '1', text: 'Test Loro', completed: false });

// 2. Serialize to bytes
const originalBytes = doc.export({ mode: 'snapshot' });
console.log('Original bytes length:', originalBytes.length);
console.log('First few bytes:', originalBytes.slice(0, 10));

// Convert to hex string for PostgreSQL bytea
const hexString =
    '\\x' +
    Array.from(originalBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

// 3. Store in Supabase (bytea column)
const { error: storeError, data } = await supabase
    .from('loro_docs')
    .upsert({
        data: hexString,
    })
    .select();

const originalRowId = data?.[0]?.id;

if (storeError) {
    console.error('Error storing doc:', storeError);
    throw storeError;
}

// 4. Retrieve from Supabase
const { data: storedDoc, error: retrieveError } = await supabase
    .from('loro_docs')
    .select('data')
    .eq('id', originalRowId)
    .single();

if (retrieveError) {
    console.error('Error retrieving doc:', retrieveError);
    throw retrieveError;
}

console.log('Original data length:', originalBytes.length);
console.log('Retrieved data length:', storedDoc.data.length);

// Convert hex string back to Uint8Array - seriously annoying issue, WOW.
const hexData = storedDoc.data.slice(2); // Remove '\x' prefix
const retrievedBytes = new Uint8Array(hexData.length / 2);
for (let i = 0; i < hexData.length; i += 2) {
    retrievedBytes[i / 2] = parseInt(hexData.slice(i, i + 2), 16);
}

try {
    // 5. Load the doc from the retrieved bytes
    const loadedDoc = LoroDoc.fromSnapshot(retrievedBytes);

    // 6. Read the todos from both docs
    const originalTodos = todos.toArray();
    const loadedTodos = loadedDoc.getList('todos').toArray();

    console.log('Original todos:', originalTodos);
    console.log('Loaded todos:', loadedTodos);
    console.log(
        'Docs are identical:',
        JSON.stringify(originalTodos) === JSON.stringify(loadedTodos)
    );
} catch (error) {
    console.error('Error loading doc:', error);
    console.error('Error details:', {
        originalBytesLength: originalBytes.length,
        retrievedBytesLength: retrievedBytes.length,
        hexStringLength: hexString.length,
        storedDataLength: storedDoc.data.length,
    });
    throw error;
}
