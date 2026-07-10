import { describe, it, expect } from 'vitest';
import { groupVoteRows, MyVoteRow } from './voteGrouping';

const makeRow = (over: Partial<MyVoteRow> & { poll_id: string; option_index: number }): MyVoteRow => ({
    weight: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
    polls: {
        message_id: over.poll_id,
        title: 'Test Poll',
        guild_id: 'g1',
        channel_id: 'c1',
        active: true,
        options: ['Red', 'Green', 'Blue'],
        guilds: { name: 'Test Guild', icon_url: null },
        ...(over.polls ?? {}),
    },
});

describe('groupVoteRows', () => {
    it('maps a single-option vote to one entry with the option label', () => {
        const result = groupVoteRows([makeRow({ poll_id: 'p1', option_index: 1 })]);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            poll_id: 'p1',
            title: 'Test Poll',
            guild_name: 'Test Guild',
            chosen_options: ['Green'],
            weight: 1,
        });
    });

    it('groups multi-select rows for the same poll into one entry', () => {
        const result = groupVoteRows([
            makeRow({ poll_id: 'p1', option_index: 0 }),
            makeRow({ poll_id: 'p1', option_index: 2 }),
            makeRow({ poll_id: 'p2', option_index: 1 }),
        ]);
        expect(result).toHaveLength(2);
        expect(result[0]!.chosen_options).toEqual(['Red', 'Blue']);
        expect(result[1]!.chosen_options).toEqual(['Green']);
    });

    it('falls back to "Option N" for out-of-range indices', () => {
        const result = groupVoteRows([makeRow({ poll_id: 'p1', option_index: 9 })]);
        expect(result[0]!.chosen_options).toEqual(['Option 10']);
    });

    it('returns an empty array for empty input', () => {
        expect(groupVoteRows([])).toEqual([]);
    });

    it('keeps the newest timestamp across grouped rows', () => {
        const result = groupVoteRows([
            makeRow({ poll_id: 'p1', option_index: 0, created_at: '2026-02-01T00:00:00.000Z' }),
            makeRow({ poll_id: 'p1', option_index: 1, created_at: '2026-01-15T00:00:00.000Z' }),
        ]);
        expect(result[0]!.voted_at).toBe('2026-02-01T00:00:00.000Z');
    });
});
