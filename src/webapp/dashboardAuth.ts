import { Router, Request, Response } from 'express';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';
import crypto from 'crypto';

const router = Router();

// Discord OAuth2 configuration
const DISCORD_API_BASE = 'https://discord.com/api/v10';
const CLIENT_ID = process.env.DISCORD_CLIENT_ID!;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET!;
const REDIRECT_URI = process.env.DISCORD_OAUTH_REDIRECT_URI || 'http://localhost:7500/api/auth/callback';

// Admin user IDs from environment
const ADMIN_IDS = (process.env.DISCORD_ADMIN_IDS || '').split(',').map(id => id.trim()).filter(Boolean);

// In-memory session store (for simplicity - in production use Redis or DB)
const sessions = new Map<string, { userId: string; expiresAt: number }>();

// State tokens for CSRF protection (short-lived)
const pendingStates = new Map<string, number>();

// Clean up expired sessions and states periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, session] of sessions) {
        if (session.expiresAt < now) {
            sessions.delete(key);
        }
    }
    for (const [state, expiry] of pendingStates) {
        if (expiry < now) {
            pendingStates.delete(state);
        }
    }
}, 60000); // Every minute

/**
 * GET /api/auth/discord
 * Redirect user to Discord OAuth authorization page
 */
router.get('/discord', (req: Request, res: Response) => {
    // Generate a state token for CSRF protection
    const state = crypto.randomBytes(16).toString('hex');
    pendingStates.set(state, Date.now() + 300000); // 5 minutes expiry

    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'identify guilds',
        state: state,
    });

    const authUrl = `https://discord.com/oauth2/authorize?${params.toString()}`;
    logger.info(`[Dashboard Auth] Redirecting to Discord OAuth`);
    res.redirect(authUrl);
});

/**
 * GET /api/auth/callback
 * Handle Discord OAuth callback, exchange code for tokens, create session
 */
router.get('/callback', async (req: Request, res: Response) => {
    const { code, state, error } = req.query;

    // Handle OAuth errors
    if (error) {
        logger.warn(`[Dashboard Auth] OAuth error: ${error}`);
        return res.redirect('/login?error=oauth_denied');
    }

    // Validate state for CSRF protection
    if (!state || typeof state !== 'string' || !pendingStates.has(state)) {
        logger.warn(`[Dashboard Auth] Invalid state token`);
        return res.redirect('/login?error=invalid_state');
    }
    pendingStates.delete(state);

    if (!code || typeof code !== 'string') {
        logger.warn(`[Dashboard Auth] No authorization code provided`);
        return res.redirect('/login?error=no_code');
    }

    try {
        // Exchange code for tokens
        const tokenResponse = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI,
            }),
        });

        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.text();
            logger.error(`[Dashboard Auth] Token exchange failed: ${errorData}`);
            return res.redirect('/login?error=token_exchange_failed');
        }

        const tokens = await tokenResponse.json() as {
            access_token: string;
            refresh_token: string;
            expires_in: number;
            token_type: string;
        };

        // Fetch user info from Discord
        const userResponse = await fetch(`${DISCORD_API_BASE}/users/@me`, {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`,
            },
        });

        if (!userResponse.ok) {
            logger.error(`[Dashboard Auth] Failed to fetch user info`);
            return res.redirect('/login?error=user_fetch_failed');
        }

        const discordUser = await userResponse.json() as {
            id: string;
            username: string;
            discriminator: string;
            avatar: string | null;
            global_name: string | null;
        };

        // Build avatar URL
        const avatarUrl = discordUser.avatar
            ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/${parseInt(discordUser.discriminator || '0') % 5}.png`;

        // Check if user is admin
        const isAdmin = ADMIN_IDS.includes(discordUser.id);

        // Upsert user in database
        const { error: dbError } = await supabase
            .from('users')
            .upsert({
                id: discordUser.id,
                username: discordUser.username,
                discriminator: discordUser.discriminator || '0',
                avatar_url: avatarUrl,
                is_admin: isAdmin,
            }, {
                onConflict: 'id',
            });

        if (dbError) {
            logger.error(`[Dashboard Auth] Failed to upsert user: ${dbError.message}`);
            // Continue anyway - user can still log in
        }

        // Create session token
        const sessionId = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days

        sessions.set(sessionId, {
            userId: discordUser.id,
            expiresAt,
        });

        // Store session in database for persistence across restarts
        await supabase.from('dashboard_sessions').upsert({
            id: sessionId,
            user_id: discordUser.id,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || null,
            expires_at: new Date(expiresAt).toISOString(),
        }, {
            onConflict: 'id',
        });

        logger.info(`[Dashboard Auth] User ${discordUser.username} (${discordUser.id}) logged in, admin: ${isAdmin}`);

        // Redirect to frontend with session token
        // The frontend will store this in localStorage
        res.redirect(`/auth/callback?session=${sessionId}`);
    } catch (err) {
        logger.error(`[Dashboard Auth] Unexpected error:`, err);
        return res.redirect('/login?error=unexpected');
    }
});

/**
 * GET /api/auth/me
 * Return current user info from session
 */
router.get('/me', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const sessionId = authHeader?.replace('Bearer ', '');

    if (!sessionId) {
        return res.status(401).json({ error: 'No session token provided' });
    }

    // Check in-memory cache first
    let session = sessions.get(sessionId);

    // If not in memory, check database
    if (!session) {
        const { data: dbSession } = await supabase
            .from('dashboard_sessions')
            .select('user_id, expires_at')
            .eq('id', sessionId)
            .single();

        if (dbSession && new Date(dbSession.expires_at).getTime() > Date.now()) {
            session = {
                userId: dbSession.user_id,
                expiresAt: new Date(dbSession.expires_at).getTime(),
            };
            // Cache it in memory
            sessions.set(sessionId, session);
        }
    }

    if (!session || session.expiresAt < Date.now()) {
        sessions.delete(sessionId);
        return res.status(401).json({ error: 'Session expired or invalid' });
    }

    // Fetch user from database
    const { data: user, error } = await supabase
        .from('users')
        .select('id, username, discriminator, avatar_url, is_admin')
        .eq('id', session.userId)
        .single();

    if (error || !user) {
        return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
        id: user.id,
        username: user.username,
        discriminator: user.discriminator,
        avatar_url: user.avatar_url,
        is_admin: user.is_admin || ADMIN_IDS.includes(user.id),
    });
});

/**
 * POST /api/auth/logout
 * Clear session
 */
router.post('/logout', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const sessionId = authHeader?.replace('Bearer ', '');

    if (sessionId) {
        sessions.delete(sessionId);
        await supabase.from('dashboard_sessions').delete().eq('id', sessionId);
        logger.info(`[Dashboard Auth] Session ${sessionId.substring(0, 8)}... logged out`);
    }

    return res.json({ success: true });
});

export const dashboardAuthRouter = router;
