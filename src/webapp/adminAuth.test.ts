import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request } from 'express';

const single = vi.fn();

vi.mock('../lib/db', () => ({
    supabase: {
        from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
    },
}));

process.env.DISCORD_ADMIN_IDS = 'admin-1, admin-2';

const { getAdminUserId, isAdminId } = await import('./adminAuth');

/** Minimal request stand-in; only cookies and headers are read. */
function req(cookies: Record<string, string> = {}, headers: Record<string, string> = {}): Request {
    return { cookies, headers } as unknown as Request;
}

beforeEach(() => {
    single.mockReset();
});

describe('isAdminId', () => {
    it('accepts ids in DISCORD_ADMIN_IDS, trimming whitespace', () => {
        expect(isAdminId('admin-1')).toBe(true);
        expect(isAdminId('admin-2')).toBe(true);
    });

    it('rejects everything else', () => {
        expect(isAdminId('someone-else')).toBe(false);
        expect(isAdminId('')).toBe(false);
        expect(isAdminId(null)).toBe(false);
        expect(isAdminId(undefined)).toBe(false);
    });
});

describe('getAdminUserId', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();

    it('returns null when no session is presented', async () => {
        expect(await getAdminUserId(req())).toBeNull();
        expect(single).not.toHaveBeenCalled();
    });

    it('resolves a live session belonging to an admin', async () => {
        single.mockResolvedValue({ data: { user_id: 'admin-1', expires_at: future } });
        expect(await getAdminUserId(req({ pollbot_session: 'abc' }))).toBe('admin-1');
    });

    it('accepts the session from an Authorization header too', async () => {
        single.mockResolvedValue({ data: { user_id: 'admin-2', expires_at: future } });
        expect(await getAdminUserId(req({}, { authorization: 'Bearer abc' }))).toBe('admin-2');
    });

    it('rejects a valid session belonging to a non-admin', async () => {
        single.mockResolvedValue({ data: { user_id: 'someone-else', expires_at: future } });
        expect(await getAdminUserId(req({ pollbot_session: 'abc' }))).toBeNull();
    });

    it('rejects an expired admin session', async () => {
        single.mockResolvedValue({ data: { user_id: 'admin-1', expires_at: past } });
        expect(await getAdminUserId(req({ pollbot_session: 'abc' }))).toBeNull();
    });

    it('rejects an unknown session id', async () => {
        single.mockResolvedValue({ data: null });
        expect(await getAdminUserId(req({ pollbot_session: 'nope' }))).toBeNull();
    });
});
