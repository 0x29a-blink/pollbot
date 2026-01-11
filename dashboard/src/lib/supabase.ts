import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Missing Supabase URL or Anon Key in environment variables.');
}

// Connect directly to Supabase (proxy doesn't work well for WebSocket/Realtime)
export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');
