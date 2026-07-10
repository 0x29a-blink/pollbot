import { describe, it, expect } from 'vitest';
import { aggregateVoteRows, type VoteRow } from './voteUtils';

describe('aggregateVoteRows', () => {
    it('returns all-zero counts for no votes', () => {
        const result = aggregateVoteRows([], 3);
        expect(result.counts).toEqual([0, 0, 0]);
        expect(result.totalWeight).toBe(0);
        expect(result.uniqueVoters).toBe(0);
    });

    it('counts unweighted votes (default weight 1)', () => {
        const votes: VoteRow[] = [
            { option_index: 0, weight: null, user_id: 'a' },
            { option_index: 0, weight: null, user_id: 'b' },
            { option_index: 1, weight: null, user_id: 'c' },
        ];
        const result = aggregateVoteRows(votes, 2);
        expect(result.counts).toEqual([2, 1]);
        expect(result.totalWeight).toBe(3);
        expect(result.uniqueVoters).toBe(3);
    });

    it('applies weights when present', () => {
        // One admin (weight 5) and two regular voters (weight 1) on option 0.
        const votes: VoteRow[] = [
            { option_index: 0, weight: 5, user_id: 'admin' },
            { option_index: 0, weight: 1, user_id: 'x' },
            { option_index: 1, weight: 1, user_id: 'y' },
        ];
        const result = aggregateVoteRows(votes, 2);
        expect(result.counts).toEqual([6, 1]);
        expect(result.totalWeight).toBe(7);
    });

    it('defaults falsy weights (0/null/undefined) to 1', () => {
        const votes: VoteRow[] = [
            { option_index: 0, weight: 0, user_id: 'a' },
            { option_index: 0, weight: undefined, user_id: 'b' },
            { option_index: 0, weight: null, user_id: 'c' },
        ];
        const result = aggregateVoteRows(votes, 1);
        expect(result.counts).toEqual([3]);
        expect(result.totalWeight).toBe(3);
    });

    it('excludes out-of-range option indices from counts and totalWeight', () => {
        const votes: VoteRow[] = [
            { option_index: 0, weight: 1, user_id: 'a' },
            { option_index: 5, weight: 3, user_id: 'b' }, // out of range for a 2-option poll
            { option_index: -1, weight: 2, user_id: 'c' }, // negative, also excluded
        ];
        const result = aggregateVoteRows(votes, 2);
        expect(result.counts).toEqual([1, 0]);
        expect(result.totalWeight).toBe(1);
        // Out-of-range voters still count as unique voters.
        expect(result.uniqueVoters).toBe(3);
    });

    it('counts a multi-select voter once toward uniqueVoters but once per option toward counts', () => {
        const votes: VoteRow[] = [
            { option_index: 0, weight: 2, user_id: 'multi' },
            { option_index: 1, weight: 2, user_id: 'multi' },
        ];
        const result = aggregateVoteRows(votes, 2);
        expect(result.counts).toEqual([2, 2]);
        expect(result.totalWeight).toBe(4);
        expect(result.uniqueVoters).toBe(1);
    });

    it('tolerates null option_index rows', () => {
        const votes: VoteRow[] = [
            { option_index: null, weight: 1, user_id: 'a' },
            { option_index: 0, weight: 1, user_id: 'b' },
        ];
        const result = aggregateVoteRows(votes, 1);
        expect(result.counts).toEqual([1]);
        expect(result.totalWeight).toBe(1);
        expect(result.uniqueVoters).toBe(2);
    });
});
