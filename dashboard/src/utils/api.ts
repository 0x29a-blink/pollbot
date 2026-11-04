/**
 * API utility for making authenticated requests with CSRF protection
 */

// Cookie name for CSRF token (must match backend)
const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

let inflightCsrfFetch: Promise<string | null> | null = null;

/**
 * Get CSRF token from cookie
 */
export function getCsrfToken(): string | null {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
        const trimmed = cookie.trim();
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const name = trimmed.slice(0, eqIdx);
        const value = trimmed.slice(eqIdx + 1);
        if (name === CSRF_COOKIE_NAME) {
            return value;
        }
    }
    return null;
}

/**
 * Ensures a CSRF token cookie is present, fetching `/api/auth/csrf` once if missing.
 */
export async function ensureCsrfTokenClient(): Promise<string | null> {
    const existing = getCsrfToken();
    if (existing) {
        return existing;
    }

    if (!inflightCsrfFetch) {
        inflightCsrfFetch = fetch('/api/auth/csrf', { credentials: 'include' })
            .then(async (res) => {
                if (!res.ok) return getCsrfToken();
                const data = (await res.json().catch(() => null)) as { csrfToken?: string } | null;
                return data?.csrfToken || getCsrfToken();
            })
            .catch(() => getCsrfToken())
            .finally(() => {
                inflightCsrfFetch = null;
            });
    }

    return inflightCsrfFetch;
}

/**
 * Fetch wrapper that automatically includes credentials and CSRF token
 * Use this for all API requests to ensure proper auth and CSRF protection
 */
export async function apiFetch(
    url: string,
    options: RequestInit = {}
): Promise<Response> {
    const headers = new Headers(options.headers);

    // Add CSRF token for mutation requests
    const method = (options.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const csrfToken = await ensureCsrfTokenClient();
        if (csrfToken) {
            headers.set(CSRF_HEADER_NAME, csrfToken);
        }
    }

    // Ensure Content-Type is set for JSON bodies
    if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    return fetch(url, {
        ...options,
        headers,
        credentials: 'include', // Always send cookies
    });
}

/**
 * Convenience methods for common API operations
 */
export const api = {
    get: (url: string) => apiFetch(url),

    post: (url: string, body?: unknown) => apiFetch(url, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
    }),

    patch: (url: string, body?: unknown) => apiFetch(url, {
        method: 'PATCH',
        body: body ? JSON.stringify(body) : undefined,
    }),

    delete: (url: string) => apiFetch(url, {
        method: 'DELETE',
    }),
};
