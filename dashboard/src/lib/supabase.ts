import { createClient } from '@supabase/supabase-js';
import { getCsrfToken } from '../utils/api';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Missing Supabase URL or Anon Key in environment variables.');
}

/**
 * Public client. The anon key is shipped in this bundle, so it can only reach
 * what an anonymous stranger is allowed to see — currently the aggregate
 * `global_stats` row and its realtime channel. Do not use it for polls, votes,
 * users or guilds; those are admin-only and go through `adminSupabase`.
 */
export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

/**
 * Admin client. Same query API, but pointed at the backend's admin proxy
 * (`/api/admin/db`) instead of Supabase directly. The proxy authenticates the
 * session cookie as an admin before replaying the query upstream, so these
 * reads are enforced server-side rather than by hiding UI.
 */
export const adminSupabase = createClient(
    `${window.location.origin}/api/admin/db`,
    // The proxy authenticates by session cookie; supabase-js still requires a
    // non-empty key, and this placeholder is never trusted by the backend.
    'proxy-authenticated-by-session-cookie',
    {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
            fetch: (input, init) => {
                const headers = new Headers(init?.headers);
                // supabase-js sends RPCs as POST, and the backend enforces the
                // double-submit CSRF token on every mutating method.
                const csrfToken = getCsrfToken();
                if (csrfToken) headers.set('x-csrf-token', csrfToken);

                return fetch(input, { ...init, headers, credentials: 'include' });
            },
        },
    },
);
