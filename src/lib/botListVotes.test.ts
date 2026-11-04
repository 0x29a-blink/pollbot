import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
    classifyVoteWebhook,
    verifyTopggSignature,
    verifyDiscordForgeSignature,
    computePremiumWindow,
    computeStackedPremiumExpiry,
} from './botListVotes';

const SECRETS = {
    topggAuth: 'topgg-legacy-secret',
    topggSignatureSecret: 'whs_test_secret',
    discordForgeAuth: 'forge-secret',
    discordForgeSignatureSecret: 'forge_v2_secret_token',
};

function signTopggV1(rawBody: string, secret: string, timestamp: number): string {
    const sig = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    return `t=${timestamp},v1=${sig}`;
}

function signForgeV2(rawBody: string, secret: string): string {
    const sig = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    return `sha256=${sig}`;
}

describe('classifyVoteWebhook', () => {
    describe('Top.gg legacy v0', () => {
        const payload = { bot: '123', user: '160853902726660096', type: 'upvote', isWeekend: false, query: '?source=embed' };

        it('accepts a valid v0 vote with the shared secret', () => {
            const res = classifyVoteWebhook(
                { authorization: SECRETS.topggAuth },
                JSON.stringify(payload), payload, SECRETS
            );
            expect(res.ok).toBe(true);
            if (res.ok) {
                expect(res.event.source).toBe('topgg');
                expect(res.event.userId).toBe('160853902726660096');
                expect(res.event.weight).toBe(1);
                expect(res.event.isTest).toBe(false);
                expect(res.event.query).toEqual({ source: 'embed' });
            }
        });

        it('doubles weight on weekend votes', () => {
            const weekend = { ...payload, isWeekend: true };
            const res = classifyVoteWebhook({ authorization: SECRETS.topggAuth }, JSON.stringify(weekend), weekend, SECRETS);
            expect(res.ok && res.event.weight).toBe(2);
            expect(res.ok && res.event.isWeekend).toBe(true);
        });

        it('flags test votes', () => {
            const test = { ...payload, type: 'test' };
            const res = classifyVoteWebhook({ authorization: SECRETS.topggAuth }, JSON.stringify(test), test, SECRETS);
            expect(res.ok && res.event.isTest).toBe(true);
        });

        it('rejects a wrong secret', () => {
            const res = classifyVoteWebhook({ authorization: 'wrong' }, JSON.stringify(payload), payload, SECRETS);
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.status).toBe(403);
        });

        it('rejects the DiscordForge secret on a Top.gg-shaped payload', () => {
            const res = classifyVoteWebhook({ authorization: SECRETS.discordForgeAuth }, JSON.stringify(payload), payload, SECRETS);
            expect(res.ok).toBe(false);
        });
    });

    describe('Top.gg v1 (signed)', () => {
        const payload = {
            type: 'vote.create',
            data: {
                id: 'vote_abc',
                weight: 2,
                created_at: '2026-07-11T00:00:00Z',
                project: { id: 'p1', type: 'bot', platform: 'discord', platform_id: '123' },
                user: { id: 'u1', platform_id: '160853902726660096', name: 'blink', avatar_url: 'https://cdn/av.png' },
                query: { source: 'topgg' },
            },
        };

        it('accepts a correctly signed vote.create', () => {
            const raw = JSON.stringify(payload);
            const now = 1_700_000_000;
            const res = classifyVoteWebhook(
                { 'x-topgg-signature': signTopggV1(raw, SECRETS.topggSignatureSecret, now) },
                raw, payload, SECRETS, now
            );
            expect(res.ok).toBe(true);
            if (res.ok) {
                expect(res.event.source).toBe('topgg');
                expect(res.event.eventId).toBe('vote_abc');
                expect(res.event.userId).toBe('160853902726660096');
                expect(res.event.username).toBe('blink');
                expect(res.event.weight).toBe(2);
                expect(res.event.isWeekend).toBe(true);
                expect(res.event.query).toEqual({ source: 'topgg' });
            }
        });

        it('rejects a tampered body', () => {
            const raw = JSON.stringify(payload);
            const now = 1_700_000_000;
            const header = signTopggV1(raw, SECRETS.topggSignatureSecret, now);
            const tampered = { ...payload, data: { ...payload.data, user: { ...payload.data.user, platform_id: '999' } } };
            const res = classifyVoteWebhook({ 'x-topgg-signature': header }, JSON.stringify(tampered), tampered, SECRETS, now);
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.status).toBe(403);
        });

        it('rejects a stale timestamp (replay guard)', () => {
            const raw = JSON.stringify(payload);
            const signedAt = 1_700_000_000;
            const header = signTopggV1(raw, SECRETS.topggSignatureSecret, signedAt);
            const res = classifyVoteWebhook({ 'x-topgg-signature': header }, raw, payload, SECRETS, signedAt + 3600);
            expect(res.ok).toBe(false);
        });

        it('marks webhook.test events as test votes', () => {
            const test = { ...payload, type: 'webhook.test' };
            const raw = JSON.stringify(test);
            const now = 1_700_000_000;
            const res = classifyVoteWebhook(
                { 'x-topgg-signature': signTopggV1(raw, SECRETS.topggSignatureSecret, now) },
                raw, test, SECRETS, now
            );
            expect(res.ok && res.event.isTest).toBe(true);
            expect(res.ok && res.event.format).toBe('topgg_v1');
        });

        it('normalizes blank user.name / avatar_url to undefined and accepts username / avatar aliases', () => {
            const blankName = {
                ...payload,
                data: { ...payload.data, user: { id: 'u1', platform_id: '160853902726660096', name: '   ', avatar_url: '' } },
            };
            const rawBlank = JSON.stringify(blankName);
            const now = 1_700_000_000;
            const resBlank = classifyVoteWebhook(
                { 'x-topgg-signature': signTopggV1(rawBlank, SECRETS.topggSignatureSecret, now) },
                rawBlank, blankName, SECRETS, now
            );
            expect(resBlank.ok).toBe(true);
            if (resBlank.ok) {
                expect(resBlank.event.username).toBeUndefined();
                expect(resBlank.event.avatarUrl).toBeUndefined();
            }

            const aliased = {
                ...payload,
                data: { ...payload.data, user: { id: 'u1', platform_id: '160853902726660096', username: 'blink.dclxvi', avatar: 'https://cdn/av2.png' } },
            };
            const rawAliased = JSON.stringify(aliased);
            const resAliased = classifyVoteWebhook(
                { 'x-topgg-signature': signTopggV1(rawAliased, SECRETS.topggSignatureSecret, now) },
                rawAliased, aliased, SECRETS, now
            );
            expect(resAliased.ok).toBe(true);
            if (resAliased.ok) {
                expect(resAliased.event.username).toBe('blink.dclxvi');
                expect(resAliased.event.avatarUrl).toBe('https://cdn/av2.png');
            }
        });
    });

    describe('DiscordForge Webhooks v2 (signed)', () => {
        const envelope = {
            id: 'evt_b19d2b4d5c03427eb3994cd16a7e513b',
            type: 'vote.created',
            created_at: '2026-08-05T01:49:28.767Z',
            bot_id: '911731627498041374',
            data: {
                voter_id: '1180554986686525506',
                streak: 4,
                total_votes: 100,
                weekly_votes: 12,
            },
        };

        it('accepts a correctly signed vote.created envelope', () => {
            const raw = JSON.stringify(envelope);
            const res = classifyVoteWebhook(
                {
                    'x-forge-signature': signForgeV2(raw, SECRETS.discordForgeSignatureSecret),
                    'x-forge-event': 'vote.created',
                    'x-forge-delivery': 'del_123',
                },
                raw,
                envelope,
                SECRETS
            );
            expect(res.ok).toBe(true);
            if (res.ok) {
                expect(res.event.source).toBe('discordforge');
                expect(res.event.eventId).toBe('evt_b19d2b4d5c03427eb3994cd16a7e513b');
                expect(res.event.userId).toBe('1180554986686525506');
                expect(res.event.weight).toBe(1);
                expect(res.event.isTest).toBe(false);
                expect(res.event.streak).toBe(4);
                expect(res.event.weeklyVotes).toBe(12);
                expect(res.event.totalVotes).toBe(100);
            }
        });

        it('marks dashboard test deliveries (test: true) as isTest', () => {
            const testEnv = { ...envelope, test: true, source: 'dashboard' };
            const raw = JSON.stringify(testEnv);
            const res = classifyVoteWebhook(
                { 'x-forge-signature': signForgeV2(raw, SECRETS.discordForgeSignatureSecret) },
                raw,
                testEnv,
                SECRETS
            );
            expect(res.ok).toBe(true);
            if (res.ok) expect(res.event.isTest).toBe(true);
        });

        it('acknowledges non-vote v2 events (review.created, follower.new, etc.) with 204', () => {
            const reviewEnv = {
                id: 'evt_review_1',
                type: 'review.created',
                created_at: '2026-08-05T01:49:28.767Z',
                bot_id: '911731627498041374',
                data: { review_id: 'rev_1', reviewer_id: '123', rating: 5, snippet: 'Great!', review_count: 10 },
            };
            const raw = JSON.stringify(reviewEnv);
            const res = classifyVoteWebhook(
                { 'x-forge-signature': signForgeV2(raw, SECRETS.discordForgeSignatureSecret) },
                raw,
                reviewEnv,
                SECRETS
            );
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.status).toBe(204);
        });

        it('rejects a tampered body with 401', () => {
            const raw = JSON.stringify(envelope);
            const sig = signForgeV2(raw, SECRETS.discordForgeSignatureSecret);
            const tampered = { ...envelope, data: { ...envelope.data, voter_id: '999999999999999999' } };
            const res = classifyVoteWebhook(
                { 'x-forge-signature': sig },
                JSON.stringify(tampered),
                tampered,
                SECRETS
            );
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.status).toBe(401);
        });

        it('rejects v2 signatures when DISCORDFORGE_WEBHOOK_SECRET is unset', () => {
            const raw = JSON.stringify(envelope);
            const res = classifyVoteWebhook(
                { 'x-forge-signature': signForgeV2(raw, 'any') },
                raw,
                envelope,
                { topggAuth: 'x', discordForgeAuth: 'y' }
            );
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.status).toBe(403);
        });
    });

    describe('DiscordForge legacy v1', () => {
        const payload = { id: '160853902726660096', username: 'blink', weeklyVotes: 3, totalVotes: 42, isTest: false };

        it('accepts a valid vote with the shared secret', () => {
            const res = classifyVoteWebhook({ authorization: SECRETS.discordForgeAuth }, JSON.stringify(payload), payload, SECRETS);
            expect(res.ok).toBe(true);
            if (res.ok) {
                expect(res.event.source).toBe('discordforge');
                expect(res.event.userId).toBe('160853902726660096');
                expect(res.event.username).toBe('blink');
                expect(res.event.weeklyVotes).toBe(3);
                expect(res.event.totalVotes).toBe(42);
            }
        });

        it('flags test votes', () => {
            const test = { ...payload, isTest: true };
            const res = classifyVoteWebhook({ authorization: SECRETS.discordForgeAuth }, JSON.stringify(test), test, SECRETS);
            expect(res.ok && res.event.isTest).toBe(true);
        });

        it('rejects a wrong secret', () => {
            const res = classifyVoteWebhook({ authorization: 'nope' }, JSON.stringify(payload), payload, SECRETS);
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.status).toBe(403);
        });

        it('rejects the Top.gg secret on a DiscordForge-shaped payload', () => {
            const res = classifyVoteWebhook({ authorization: SECRETS.topggAuth }, JSON.stringify(payload), payload, SECRETS);
            expect(res.ok).toBe(false);
        });
    });

    describe('edge cases', () => {
        it('rejects requests with no Authorization and no signature', () => {
            const res = classifyVoteWebhook({}, '{}', {}, SECRETS);
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.status).toBe(401);
        });

        it('rejects unknown payload shapes', () => {
            const body = { hello: 'world' };
            const res = classifyVoteWebhook({ authorization: SECRETS.topggAuth }, JSON.stringify(body), body, SECRETS);
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.status).toBe(400);
        });

        it('rejects v1 signatures when no signing secret is configured', () => {
            const raw = '{}';
            const res = classifyVoteWebhook(
                { 'x-topgg-signature': 't=1,v1=abc' },
                raw, {}, { topggAuth: 'x', discordForgeAuth: 'y' }
            );
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.status).toBe(403);
        });
    });
});

describe('verifyTopggSignature & verifyDiscordForgeSignature', () => {
    it('accepts a valid Top.gg signature within tolerance', () => {
        const raw = '{"a":1}';
        const now = 1_700_000_000;
        expect(verifyTopggSignature(signTopggV1(raw, 'whs_k', now), raw, 'whs_k', now + 60)).toBe(true);
    });

    it('rejects malformed Top.gg headers', () => {
        expect(verifyTopggSignature('garbage', '{}', 'whs_k', 1)).toBe(false);
        expect(verifyTopggSignature('t=,v1=', '{}', 'whs_k', 1)).toBe(false);
    });

    it('verifies DiscordForge v2 sha256= signatures', () => {
        const raw = '{"id":"evt_1","type":"vote.created"}';
        expect(verifyDiscordForgeSignature(signForgeV2(raw, 'sec'), raw, 'sec')).toBe(true);
        expect(verifyDiscordForgeSignature('sha256=deadbeef', raw, 'sec')).toBe(false);
        expect(verifyDiscordForgeSignature('missingprefix', raw, 'sec')).toBe(false);
    });
});

describe('premium vote-time stacking', () => {
    const H = 60 * 60 * 1000;
    const now = Date.UTC(2026, 10, 4, 12, 0, 0);

    it('grants 13h (12h + 1h buffer) on a fresh vote and stacks +12h on a second list vote', () => {
        const firstExpiry = computeStackedPremiumExpiry(null, now);
        expect(new Date(firstExpiry).getTime() - now).toBe(13 * H);

        // User votes on DiscordForge 5 minutes after voting on Top.gg:
        // active window is preserved and extended by +12h (~25h total).
        const secondExpiry = computeStackedPremiumExpiry(
            { last_vote_at: new Date(now).toISOString(), premium_expires_at: firstExpiry },
            now + 5 * 60 * 1000
        );
        expect(new Date(secondExpiry).getTime() - now).toBe(25 * H);

        const win = computePremiumWindow({ premium_expires_at: secondExpiry }, now + 20 * H);
        expect(win.isPremium).toBe(true);
        expect(win.expiresAt).toBe(secondExpiry);
    });

    it('resets to now + 13h when previous premium window has already expired', () => {
        const expired = new Date(now - 2 * H).toISOString();
        const nextExpiry = computeStackedPremiumExpiry({ premium_expires_at: expired }, now);
        expect(new Date(nextExpiry).getTime() - now).toBe(13 * H);
    });

    it('falls back to last_vote_at + 13h when premium_expires_at is null (pre-migration rows)', () => {
        const recentVote = new Date(now - 3 * H).toISOString();
        const win = computePremiumWindow({ last_vote_at: recentVote, premium_expires_at: null }, now);
        expect(win.isPremium).toBe(true);
        expect(new Date(win.expiresAt!).getTime()).toBe(now + 10 * H);
    });
});
