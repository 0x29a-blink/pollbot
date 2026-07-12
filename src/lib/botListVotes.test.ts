import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { classifyVoteWebhook, verifyTopggSignature } from './botListVotes';

const SECRETS = {
    topggAuth: 'topgg-legacy-secret',
    topggSignatureSecret: 'whs_test_secret',
    discordForgeAuth: 'forge-secret',
};

function signTopggV1(rawBody: string, secret: string, timestamp: number): string {
    const sig = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    return `t=${timestamp},v1=${sig}`;
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
        });
    });

    describe('DiscordForge', () => {
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

describe('verifyTopggSignature', () => {
    it('accepts a valid signature within tolerance', () => {
        const raw = '{"a":1}';
        const now = 1_700_000_000;
        expect(verifyTopggSignature(signTopggV1(raw, 'whs_k', now), raw, 'whs_k', now + 60)).toBe(true);
    });

    it('rejects malformed headers', () => {
        expect(verifyTopggSignature('garbage', '{}', 'whs_k', 1)).toBe(false);
        expect(verifyTopggSignature('t=,v1=', '{}', 'whs_k', 1)).toBe(false);
    });
});
