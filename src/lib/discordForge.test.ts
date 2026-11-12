import { describe, it, expect, vi, afterEach } from 'vitest';
import { DiscordForgeClient, DiscordForgeError } from './discordForge';

describe('DiscordForgeClient', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('uses v1 endpoints with Bearer auth for stats, heartbeat, and commands', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
            new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        );

        const client = new DiscordForgeClient('df_secret_key_123', { retries: 1 });
        await client.postStats({ server_count: 42, shard_count: 2 });
        await client.heartbeat('online');
        await client.syncCommands([{ name: 'poll', description: 'Create a poll' }]);

        expect(fetchSpy).toHaveBeenCalledTimes(3);
        expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://discordforge.org/api/v1/bots/stats');
        expect((fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>)['Authorization']).toBe('Bearer df_secret_key_123');

        expect(fetchSpy.mock.calls[1]?.[0]).toBe('https://discordforge.org/api/v1/bots/heartbeat');
        expect((fetchSpy.mock.calls[1]?.[1]?.headers as Record<string, string>)['Authorization']).toBe('Bearer df_secret_key_123');

        expect(fetchSpy.mock.calls[2]?.[0]).toBe('https://discordforge.org/api/v1/bots/commands');
        expect((fetchSpy.mock.calls[2]?.[1]?.headers as Record<string, string>)['Authorization']).toBe('Bearer df_secret_key_123');
    });

    it('uses raw API key header on legacy checkVote route', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ hasVoted: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        );

        const client = new DiscordForgeClient('df_secret_key_123', { retries: 1 });
        const result = await client.checkVote('911731627498041374', '123456789012345678');

        expect(result.hasVoted).toBe(true);
        expect(fetchSpy.mock.calls[0]?.[0]).toBe(
            'https://discordforge.org/api/bots/911731627498041374/votes/check?userId=123456789012345678'
        );
        expect((fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>)['Authorization']).toBe('df_secret_key_123');
    });

    it('redacts the API key if echoed in an upstream error response', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
            new Response('Invalid token df_secret_key_123 provided', { status: 401 })
        );

        const client = new DiscordForgeClient('df_secret_key_123', { retries: 1 });
        await expect(client.postStats({ server_count: 1 })).rejects.toThrow('[REDACTED]');
        await expect(client.postStats({ server_count: 1 })).rejects.not.toThrow('df_secret_key_123');
    });

    it('returns parsed uptime counters from heartbeat()', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(
                JSON.stringify({
                    success: true,
                    message: 'Heartbeat recorded successfully',
                    status: 'online',
                    uptimeChecks: 4823,
                    uptimeOnline: 2594,
                }),
                { status: 200, headers: { 'content-type': 'application/json' } }
            )
        );

        const client = new DiscordForgeClient('df_secret_key_123', { retries: 1 });
        const res = await client.heartbeat('online');
        expect(res).toEqual({
            success: true,
            message: 'Heartbeat recorded successfully',
            status: 'online',
            uptimeChecks: 4823,
            uptimeOnline: 2594,
        });
    });

    it('throws immediately on long 429 retry-after instead of stalling for 5 minutes', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('Too Many Requests', {
                status: 429,
                headers: { 'retry-after': '300' },
            })
        );

        const client = new DiscordForgeClient('df_secret_key_123', {
            retries: 3,
            maxRetryAfterSeconds: 15,
        });

        await expect(client.postStats({ server_count: 100 })).rejects.toMatchObject({
            name: 'DiscordForgeError',
            status: 429,
            retryAfter: 300,
        } satisfies Partial<DiscordForgeError>);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('auto-retries short 429 retry-after within maxRetryAfterSeconds', async () => {
        let calls = 0;
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
            calls++;
            if (calls === 1) {
                return new Response('Too Many Requests', {
                    status: 429,
                    headers: { 'retry-after': '0.01' },
                });
            }
            return new Response(JSON.stringify({ hasVoted: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        });

        const client = new DiscordForgeClient('df_secret_key_123', {
            retries: 2,
            maxRetryAfterSeconds: 15,
        });

        const res = await client.checkVote('911731627498041374', '123456789012345678');
        expect(res.hasVoted).toBe(true);
        expect(calls).toBe(2);
    });
});
