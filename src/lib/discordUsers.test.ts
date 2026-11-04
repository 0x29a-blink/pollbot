import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    buildDiscordAvatarUrl,
    clearDiscordUserCache,
    enrichUserRows,
    fetchDiscordUserProfile,
} from './discordUsers';

describe('discordUsers', () => {
    beforeEach(() => {
        clearDiscordUserCache();
    });

    it('builds custom and default pomelo/legacy Discord avatar URLs safely', () => {
        expect(buildDiscordAvatarUrl({
            id: '160853902726660096',
            discriminator: '0',
            avatar: 'a_8a6f1b1018881230f7b69b7678b48362',
        })).toBe('https://cdn.discordapp.com/avatars/160853902726660096/a_8a6f1b1018881230f7b69b7678b48362.png');

        const pomeloDefault = buildDiscordAvatarUrl({ id: '160853902726660096', discriminator: '0', avatar: null });
        expect(pomeloDefault).toMatch(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);

        expect(buildDiscordAvatarUrl({ id: '160853902726660096', discriminator: '1234', avatar: null }))
            .toBe('https://cdn.discordapp.com/embed/avatars/4.png');

        // Non-snowflake IDs never throw in BigInt conversion.
        expect(buildDiscordAvatarUrl({ id: 'not-a-snowflake', avatar: null }))
            .toBe('https://cdn.discordapp.com/embed/avatars/0.png');
    });

    it('fetches and caches Discord user profiles via Bot REST', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
                id: '160853902726660096',
                username: 'blink.dclxvi',
                discriminator: '0',
                avatar: 'abc123',
            }),
        });

        const first = await fetchDiscordUserProfile('160853902726660096', {
            token: 'test-bot-token',
            fetchImpl: mockFetch as unknown as typeof fetch,
            nowMs: 1_000,
        });
        expect(first).toEqual({
            id: '160853902726660096',
            username: 'blink.dclxvi',
            discriminator: '0',
            avatarUrl: 'https://cdn.discordapp.com/avatars/160853902726660096/abc123.png',
        });
        expect(mockFetch).toHaveBeenCalledTimes(1);

        // Second call within TTL hits the cache without calling fetch again.
        const second = await fetchDiscordUserProfile('160853902726660096', {
            token: 'test-bot-token',
            fetchImpl: mockFetch as unknown as typeof fetch,
            nowMs: 5_000,
        });
        expect(second).toEqual(first);
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('negatively caches 404 responses and skips invalid snowflakes', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
            headers: new Headers(),
        });

        expect(await fetchDiscordUserProfile('invalid_id', {
            token: 'test-bot-token',
            fetchImpl: mockFetch as unknown as typeof fetch,
        })).toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();

        expect(await fetchDiscordUserProfile('1128270327533805638', {
            token: 'test-bot-token',
            fetchImpl: mockFetch as unknown as typeof fetch,
            nowMs: 1_000,
        })).toBeNull();
        expect(await fetchDiscordUserProfile('1128270327533805638', {
            token: 'test-bot-token',
            fetchImpl: mockFetch as unknown as typeof fetch,
            nowMs: 2_000,
        })).toBeNull();
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('enriches unknown voter rows via Discord REST while preserving known rows', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
                id: '160853902726660096',
                username: 'blink.dclxvi',
                discriminator: '0',
                avatar: 'av_hash',
            }),
        });

        const rows = [
            { id: 705, user_id: '160853902726660096', username: null, avatar_url: null },
            { id: 704, user_id: '720122763968381000', username: 'already_known', avatar_url: 'https://cdn/known.png' },
        ];

        const enriched = await enrichUserRows(rows, {
            checkUsersTable: false,
            persistToDb: false,
            token: 'test-bot-token',
            fetchImpl: mockFetch as unknown as typeof fetch,
        });

        expect(enriched[0]?.username).toBe('blink.dclxvi');
        expect(enriched[0]?.avatar_url).toBe('https://cdn.discordapp.com/avatars/160853902726660096/av_hash.png');
        expect(enriched[1]?.username).toBe('already_known');
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });
});
