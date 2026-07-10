import { describe, it, expect } from 'vitest';
import { shardIdForGuild } from './shardUtils';

describe('shardIdForGuild', () => {
    it('always maps to shard 0 when there is a single shard', () => {
        expect(shardIdForGuild('175928847299117063', 1)).toBe(0);
        expect(shardIdForGuild('81384788765712384', 1)).toBe(0);
    });

    it('matches Discord\'s documented formula (id >> 22) % count', () => {
        // 175928847299117063n >> 22n = 41944705796n; 41944705796 % 2 = 0
        expect(shardIdForGuild('175928847299117063', 2)).toBe(0);
        // 81384788765712384n >> 22n = 19405878182n; 19405878182 % 2 = 0
        expect(shardIdForGuild('81384788765712384', 2)).toBe(0);
        // Odd bucket example: (id >> 22) ends in 5 → 5 % 2 = 1
        expect(shardIdForGuild((5n << 22n).toString(), 2)).toBe(1);
    });

    it('stays within [0, shardCount) for various counts', () => {
        const ids = ['175928847299117063', '81384788765712384', '1453207963144687808'];
        for (const count of [2, 3, 16]) {
            for (const id of ids) {
                const shard = shardIdForGuild(id, count);
                expect(shard).toBeGreaterThanOrEqual(0);
                expect(shard).toBeLessThan(count);
            }
        }
    });

    it('is deterministic for the same input', () => {
        expect(shardIdForGuild('175928847299117063', 16)).toBe(shardIdForGuild('175928847299117063', 16));
    });
});
