import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertMock = vi.fn();
const fromMock = vi.fn(() => ({ insert: insertMock }));

vi.mock('./db', () => ({
    supabase: { from: (...args: unknown[]) => fromMock(...args) },
}));

vi.mock('./logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { trackUsage } from './usageTracker';

describe('trackUsage', () => {
    beforeEach(() => {
        insertMock.mockReset();
        fromMock.mockClear();
    });

    it('inserts the event into usage_events fire-and-forget', () => {
        insertMock.mockReturnValue(Promise.resolve({ error: null }));

        trackUsage({ source: 'bot', event_type: 'command:poll', guild_id: 'g1', user_id: 'u1' });

        expect(fromMock).toHaveBeenCalledWith('usage_events');
        expect(insertMock).toHaveBeenCalledWith({
            source: 'bot',
            event_type: 'command:poll',
            guild_id: 'g1',
            user_id: 'u1',
        });
    });

    it('returns synchronously and never throws on insert failure', async () => {
        insertMock.mockReturnValue(Promise.resolve({ error: { message: 'relation does not exist' } }));

        expect(() => trackUsage({ source: 'dashboard', event_type: 'poll_create' })).not.toThrow();
        // let the promise settle; nothing should escape
        await new Promise(r => setTimeout(r, 0));
    });
});
