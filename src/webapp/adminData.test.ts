import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

/**
 * The admin data proxy queries upstream with the service key, so its allowlist
 * is a security boundary: anything reachable through it is readable by an
 * authenticated admin, and nothing else must be reachable at all.
 *
 * requireAdmin is stubbed to pass here so these cases exercise the allowlist
 * itself. The auth leg is covered separately in adminAuth.test.ts.
 */
vi.mock('./adminAuth', () => ({
    requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
    getAdminUserId: async () => 'admin-1',
    isAdminId: () => true,
}));

vi.mock('../lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// The proxy calls global fetch; the tests themselves must not go through the stub.
const realFetch = globalThis.fetch;

let upstreamCalls: { url: string; init: RequestInit }[] = [];
let server: Server;
let baseUrl: string;

beforeAll(async () => {
    process.env.SUPABASE_URL = 'https://upstream.test';
    process.env.SUPABASE_KEY = 'service-key';

    vi.stubGlobal('fetch', async (url: string | URL, init: RequestInit) => {
        upstreamCalls.push({ url: String(url), init });
        return new Response(JSON.stringify([{ ok: true }]), {
            status: 200,
            headers: { 'content-type': 'application/json', 'content-range': '0-0/1' },
        });
    });

    const { adminDataRouter } = await import('./adminData');

    const app = express();
    app.use(express.json());
    app.use('/api/admin/db', adminDataRouter);

    await new Promise<void>(resolve => {
        server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/db`;
});

afterAll(async () => {
    vi.unstubAllGlobals();
    await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
    upstreamCalls = [];
});

describe('admin data proxy', () => {
    it('forwards an allowlisted table read with the service key', async () => {
        const res = await realFetch(`${baseUrl}/rest/v1/polls?select=*&limit=2`);

        expect(res.status).toBe(200);
        expect(upstreamCalls).toHaveLength(1);
        expect(upstreamCalls[0]!.url).toBe('https://upstream.test/rest/v1/polls?select=*&limit=2');

        const headers = upstreamCalls[0]!.init.headers as Record<string, string>;
        expect(headers.apikey).toBe('service-key');
        expect(headers.Authorization).toBe('Bearer service-key');
    });

    it('passes back content-range so row counts still work', async () => {
        const res = await realFetch(`${baseUrl}/rest/v1/guilds?select=*`);
        expect(res.headers.get('content-range')).toBe('0-0/1');
    });

    it('forwards Prefer and Range so pagination behaves', async () => {
        await realFetch(`${baseUrl}/rest/v1/polls?select=*`, {
            headers: { Prefer: 'count=exact', Range: '0-24' },
        });

        const headers = upstreamCalls[0]!.init.headers as Record<string, string>;
        expect(headers.prefer).toBe('count=exact');
        expect(headers.range).toBe('0-24');
    });

    it('forwards an allowlisted RPC as POST with its body', async () => {
        await realFetch(`${baseUrl}/rest/v1/rpc/get_top_creators`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ p_limit: 5 }),
        });

        expect(upstreamCalls[0]!.url).toBe('https://upstream.test/rest/v1/rpc/get_top_creators');
        expect(upstreamCalls[0]!.init.body).toBe(JSON.stringify({ p_limit: 5 }));
    });

    it('rejects a table that is not on the allowlist', async () => {
        const res = await realFetch(`${baseUrl}/rest/v1/users?select=*`);

        expect(res.status).toBe(404);
        expect(upstreamCalls).toHaveLength(0);
    });

    it('rejects an RPC that is not on the allowlist', async () => {
        const res = await realFetch(`${baseUrl}/rest/v1/rpc/get_top_botlist_voters`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
        });

        expect(res.status).toBe(404);
        expect(upstreamCalls).toHaveLength(0);
    });

    it('rejects writes to an allowlisted table', async () => {
        for (const method of ['POST', 'PATCH', 'DELETE']) {
            const res = await realFetch(`${baseUrl}/rest/v1/polls`, {
                method,
                headers: { 'content-type': 'application/json' },
                body: '{}',
            });
            expect(res.status).toBe(405);
        }
        expect(upstreamCalls).toHaveLength(0);
    });

    it('does not let a nested path smuggle in another resource', async () => {
        const res = await realFetch(`${baseUrl}/rest/v1/polls/../users?select=*`);

        expect(res.status).toBe(404);
        expect(upstreamCalls).toHaveLength(0);
    });
});
