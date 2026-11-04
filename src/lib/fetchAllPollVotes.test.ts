import { describe, it, expect, vi, beforeEach } from 'vitest';

const rangeMock = vi.fn();

vi.mock('./db', () => ({
    supabase: {
        from: () => ({
            select: () => {
                const chain: Record<string, unknown> = {};
                chain.eq = () => chain;
                chain.order = () => chain;
                chain.range = rangeMock;
                return chain;
            },
        }),
    },
}));

const { fetchAllPollVotes, aggregateVotes } = await import('./voteUtils');

beforeEach(() => {
    rangeMock.mockReset();
});

describe('fetchAllPollVotes pagination', () => {
    it('paginates past PostgREST 1,000-row cap and aggregates all rows', async () => {
        const firstPage = Array.from({ length: 1000 }, (_, i) => ({
            user_id: `user-${i}`,
            option_index: 0,
            weight: 1,
            created_at: '2026-11-01T00:00:00.000Z',
        }));
        const secondPage = Array.from({ length: 250 }, (_, i) => ({
            user_id: `user-${1000 + i}`,
            option_index: 1,
            weight: 2,
            created_at: '2026-11-01T00:01:00.000Z',
        }));

        rangeMock
            .mockResolvedValueOnce({ data: firstPage, error: null })
            .mockResolvedValueOnce({ data: secondPage, error: null });

        const fetched = await fetchAllPollVotes('123456789012345678');
        expect(fetched.error).toBeNull();
        expect(fetched.data).toHaveLength(1250);
        expect(rangeMock).toHaveBeenCalledTimes(2);
        expect(rangeMock).toHaveBeenNthCalledWith(1, 0, 999);
        expect(rangeMock).toHaveBeenNthCalledWith(2, 1000, 1999);

        rangeMock
            .mockResolvedValueOnce({ data: firstPage, error: null })
            .mockResolvedValueOnce({ data: secondPage, error: null });

        const agg = await aggregateVotes('123456789012345678', 2);
        expect(agg.error).toBe(false);
        expect(agg.counts).toEqual([1000, 500]);
        expect(agg.totalWeight).toBe(1500);
        expect(agg.uniqueVoters).toBe(1250);
    });
});
