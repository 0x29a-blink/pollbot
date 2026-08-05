import { Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/db';

// Admin identity lives in the environment, never in the database. The `users`
// table has an `is_admin` column, but it is display metadata only — anything
// that grants access must resolve through this list.
const ADMIN_IDS = (process.env.DISCORD_ADMIN_IDS || '').split(',').map(id => id.trim()).filter(Boolean);

export function isAdminId(userId: string | null | undefined): boolean {
    return !!userId && ADMIN_IDS.includes(userId);
}

/**
 * Resolve the admin user behind a request, or null. Supports both cookie and
 * header auth like the dashboard's apiFetch.
 */
export async function getAdminUserId(req: Request): Promise<string | null> {
    const cookieSession = req.cookies?.['pollbot_session'];
    const headerSession = req.headers.authorization?.replace('Bearer ', '');
    const sessionId = cookieSession || headerSession;
    if (!sessionId) return null;

    const { data: session } = await supabase
        .from('dashboard_sessions')
        .select('user_id, expires_at')
        .eq('id', sessionId)
        .single();

    if (!session) return null;
    if (new Date(session.expires_at).getTime() < Date.now()) return null;
    if (!isAdminId(session.user_id)) return null;
    return session.user_id;
}

/**
 * Express middleware form. Stashes the resolved id on `res.locals.adminUserId`.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
    const adminUserId = await getAdminUserId(req);
    if (!adminUserId) {
        res.status(403).json({ error: 'Admin access required' });
        return;
    }
    res.locals.adminUserId = adminUserId;
    next();
}
