import { describe, it, expect } from 'vitest';
import { validateCreatePoll, validateUpdatePollSettings } from './validation';

const GUILD_ID = '123456789012345678';
const CHANNEL_ID = '234567890123456789';
const ROLE_ID = '345678901234567890';

describe('validateCreatePoll', () => {
    it('preserves intentional newlines in descriptions while stripping control characters', () => {
        const res = validateCreatePoll({
            guild_id: GUILD_ID,
            channel_id: CHANNEL_ID,
            title: '  Weekly   Game Night  ',
            description: 'Line 1\r\nLine 2\n\x00Line 3',
            options: ['Option A', 'Option B'],
        });
        expect(res.success).toBe(true);
        expect(res.data?.title).toBe('Weekly Game Night');
        expect(res.data?.description).toBe('Line 1\nLine 2\nLine 3');
    });

    it('filters whitespace-only options before checking minimum option count', () => {
        const res = validateCreatePoll({
            guild_id: GUILD_ID,
            channel_id: CHANNEL_ID,
            title: 'Test Poll',
            options: ['Valid 1', '   ', '\t\n'],
        });
        expect(res.success).toBe(false);
        expect(res.errors?.some(e => e.field === 'options')).toBe(true);
    });

    it('enforces min_votes <= max_votes and max_votes <= options.length', () => {
        const minGtMax = validateCreatePoll({
            guild_id: GUILD_ID,
            channel_id: CHANNEL_ID,
            title: 'Test Poll',
            options: ['A', 'B', 'C'],
            settings: { min_votes: 3, max_votes: 2 },
        });
        expect(minGtMax.success).toBe(false);
        expect(minGtMax.errors?.some(e => e.field === 'settings.min_votes')).toBe(true);

        const maxGtOptions = validateCreatePoll({
            guild_id: GUILD_ID,
            channel_id: CHANNEL_ID,
            title: 'Test Poll',
            options: ['A', 'B'],
            settings: { min_votes: 1, max_votes: 3 },
        });
        expect(maxGtOptions.success).toBe(false);
        expect(maxGtOptions.errors?.some(e => e.field === 'settings.max_votes')).toBe(true);
    });
});

describe('validateUpdatePollSettings', () => {
    it('whitelists known fields, deduplicates allowed_roles, and validates role_metadata & weights', () => {
        const res = validateUpdatePollSettings({
            public: false,
            allow_close: true,
            allowed_roles: [ROLE_ID, ROLE_ID],
            vote_weights: { [ROLE_ID]: 5 },
            role_metadata: { [ROLE_ID]: { name: 'Moderators', color: 0x5865f2 } },
            injected_extra_key: 'dropped',
        });

        expect(res.success).toBe(true);
        expect(res.data).toEqual({
            public: false,
            allow_close: true,
            allowed_roles: [ROLE_ID],
            vote_weights: { [ROLE_ID]: 5 },
            role_metadata: { [ROLE_ID]: { name: 'Moderators', color: 0x5865f2 } },
        });
        expect('injected_extra_key' in (res.data as Record<string, unknown>)).toBe(false);
    });

    it('rejects non-snowflake role IDs, out-of-range weights, and non-boolean flags', () => {
        const bad = validateUpdatePollSettings({
            public: 'yes',
            allowed_roles: ['not-a-snowflake'],
            vote_weights: { [ROLE_ID]: 999 },
        });
        expect(bad.success).toBe(false);
        expect(bad.errors?.map(e => e.field)).toEqual(
            expect.arrayContaining(['public', 'allowed_roles', 'vote_weights'])
        );
    });
});
