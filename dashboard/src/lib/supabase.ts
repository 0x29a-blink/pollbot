import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Missing Supabase URL or Anon Key in environment variables.');
}

// Use relative path for Supabase URL to leverage Vite Proxy (avoids Mixed Content)
// If VITE_SUPABASE_URL is local, we override it to use the proxy path.
// Note: clientUrl must be a full URL for supabase-js validation, even if proxied.
const isLocal = supabaseUrl?.includes('127.0.0.1') || supabaseUrl?.includes('localhost');
const clientUrl = isLocal ? `${window.location.origin}/supabase` : (supabaseUrl || '');

export const supabase = createClient(clientUrl, supabaseAnonKey || '');
