
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY;

console.log('--- Connection Debug ---');
console.log('URL:', url);
console.log('Key Length:', key ? key.length : 0);

if (!url || !key) {
    console.error('Missing credentials!');
    process.exit(1);
}

const supabase = createClient(url, key);

async function check() {
    console.log('Attempting to list tables (requires permission) or select from polls...');

    // Attempt 1: Check if 'polls' table exists by selecting 0 rows
    const { data, error } = await supabase.from('polls').select('*').limit(1);

    if (error) {
        console.error('ERROR Querying polls table:', error);
    } else {
        console.log('SUCCESS: Polls table found. Rows returned:', data.length);
    }
}

check();
