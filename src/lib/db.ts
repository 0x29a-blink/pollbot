import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    // It's okay to fail hard here if we can't connect to DB, but for now we'll just warn
    // so development without DB is partially possible if desired (though pollbot needs it)
    console.warn('Supabase URL or Key not provided in environment variables.');
}

export const supabase = createClient(supabaseUrl || '', supabaseKey || '');

// Helper to check connection (optional utility)
export async function checkDbConnection() {
    const { count, error } = await supabase.from('polls').select('*', { count: 'exact', head: true });
    if (error) {
        console.error('Database connection failed:', error.message);
        return false;
    }
    return true;
}
