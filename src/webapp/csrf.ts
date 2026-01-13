import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// CSRF Token Configuration
const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Cookie options for CSRF token (readable by JavaScript, unlike session cookie)
const CSRF_COOKIE_OPTIONS = {
    httpOnly: false, // Must be readable by JavaScript
    secure: IS_PRODUCTION,
    sameSite: 'lax' as const,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/',
};

/**
 * Generate a new CSRF token
 */
export function generateCsrfToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Middleware to set CSRF token cookie if not present
 * Should be applied to all routes that might need CSRF protection
 */
export function ensureCsrfToken(req: Request, res: Response, next: NextFunction): void {
    // If no CSRF token exists, generate one
    if (!req.cookies?.[CSRF_COOKIE_NAME]) {
        const token = generateCsrfToken();
        res.cookie(CSRF_COOKIE_NAME, token, CSRF_COOKIE_OPTIONS);
    }
    next();
}

/**
 * Middleware to validate CSRF token on mutation requests (POST, PUT, PATCH, DELETE)
 * Uses the double-submit cookie pattern:
 * - Token is stored in a readable cookie
 * - Client reads cookie and sends token in header
 * - Server validates header matches cookie
 */
export function validateCsrfToken(req: Request, res: Response, next: NextFunction): void {
    // Only validate mutation methods
    const mutationMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
    if (!mutationMethods.includes(req.method.toUpperCase())) {
        return next();
    }

    // Skip CSRF validation for OAuth endpoints (they use separate state tokens)
    if (req.path.includes('/auth/discord') || req.path.includes('/auth/callback') || req.path.includes('/auth/logout')) {
        return next();
    }

    // Skip CSRF validation for external webhooks (e.g., Top.gg vote webhook)
    // These endpoints use their own authentication (Authorization header with webhook secret)
    if (req.path === '/vote') {
        return next();
    }

    const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
    const headerToken = req.headers[CSRF_HEADER_NAME] as string | undefined;

    // Both tokens must exist and match
    if (!cookieToken || !headerToken) {
        res.status(403).json({
            error: 'CSRF token missing',
            message: 'Missing CSRF token. Please refresh the page and try again.'
        });
        return;
    }

    if (cookieToken !== headerToken) {
        res.status(403).json({
            error: 'CSRF token invalid',
            message: 'Invalid CSRF token. Please refresh the page and try again.'
        });
        return;
    }

    next();
}

/**
 * Endpoint to get current CSRF token (useful for SPA initialization)
 * GET /api/auth/csrf - Returns current CSRF token
 */
export function getCsrfTokenHandler(req: Request, res: Response): void {
    let token = req.cookies?.[CSRF_COOKIE_NAME];

    // Generate new token if none exists
    if (!token) {
        token = generateCsrfToken();
        res.cookie(CSRF_COOKIE_NAME, token, CSRF_COOKIE_OPTIONS);
    }

    res.json({ csrfToken: token });
}
