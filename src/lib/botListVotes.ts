import crypto from 'crypto';

// Classification + verification for the unified /vote webhook. One endpoint
// (https://webhook.pollbot.win/vote) receives events from every bot list we're
// on, in four wire formats:
//
//   1. Top.gg v1            — `x-topgg-signature: t=<unix>,v1=<hmac>` header,
//                             HMAC-SHA256 of "<t>.<rawBody>" with the whs_ secret;
//                             body is { type: "vote.create"|"webhook.test", data: {...} }
//   2. DiscordForge v2      — `x-forge-signature: sha256=<hmac>` header,
//                             HMAC-SHA256 of <rawBody> with DISCORDFORGE_WEBHOOK_SECRET;
//                             envelope { id, type: "vote.created"|..., created_at, bot_id, data: {...} }
//   3. Top.gg legacy v0     — `Authorization: <shared secret>` header;
//                             flat body { bot, user, type, isWeekend, query }
//   4. DiscordForge legacy  — `Authorization: <shared secret>` header;
//                             body { id, username, weeklyVotes, totalVotes, isTest }
//
// Everything here is pure (no I/O) so it can be unit tested; the Express
// handler in webhook.ts does the DB writes.

export const TOPGG_VOTE_URL = 'https://top.gg/bot/911731627498041374/vote';
export const DISCORDFORGE_VOTE_URL = 'https://discordforge.org/bot/911731627498041374#vote';
export const DASHBOARD_URL = 'https://pollbot.win';

/** First vote grants 12h + 1h grace buffer (13h total). */
export const PREMIUM_BASE_HOURS = 13;
/** Voting on a second list (or again while active) stacks +12h onto the active expiry. */
export const PREMIUM_STACK_HOURS = 12;

export interface BotListVoteEvent {
    source: 'topgg' | 'discordforge';
    /** Wire format matched during classification (for diagnostics). */
    format?: 'topgg_v1' | 'topgg_v0' | 'discordforge_v2' | 'discordforge_v1' | undefined;
    /** Stable provider event/delivery ID when supplied (used for idempotency). */
    eventId?: string | undefined;
    userId: string;
    username?: string | undefined;
    avatarUrl?: string | undefined;
    /** Vote weight — Top.gg sends 2 during weekend double-vote periods. */
    weight: number;
    isTest: boolean;
    isWeekend?: boolean | undefined;
    weeklyVotes?: number | undefined;
    totalVotes?: number | undefined;
    streak?: number | undefined;
    query?: Record<string, unknown> | null | undefined;
}

export interface VoteWebhookSecrets {
    /** Top.gg legacy v0 shared secret (Authorization header). */
    topggAuth?: string | undefined;
    /** Top.gg v1 signing secret (whs_...). */
    topggSignatureSecret?: string | undefined;
    /** DiscordForge legacy shared secret (Authorization header). */
    discordForgeAuth?: string | undefined;
    /** DiscordForge Webhooks v2 endpoint signing secret (X-Forge-Signature HMAC-SHA256). */
    discordForgeSignatureSecret?: string | undefined;
}

export interface VoteWebhookHeaders {
    authorization?: string | undefined;
    'x-topgg-signature'?: string | undefined;
    'x-topgg-trace'?: string | undefined;
    'x-forge-signature'?: string | undefined;
    'x-forge-event'?: string | undefined;
    'x-forge-delivery'?: string | undefined;
}

export type ClassifyResult =
    | { ok: true; event: BotListVoteEvent }
    | { ok: false; status: number; reason: string };

/** Max accepted clock skew for Top.gg v1 signed timestamps (replay guard). */
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

function timingSafeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Evaluate whether a user is currently inside an active vote-unlocked premium window.
 * Supports stacked `premium_expires_at` and falls back to `last_vote_at + 13h` for
 * rows created before migration 32.
 */
export function computePremiumWindow(
    user: { last_vote_at?: string | null | undefined; premium_expires_at?: string | null | undefined } | null | undefined,
    nowMs: number = Date.now()
): { isPremium: boolean; expiresAt?: string } {
    if (!user) return { isPremium: false };

    let expiresMs = NaN;
    if (user.premium_expires_at) {
        expiresMs = new Date(user.premium_expires_at).getTime();
    } else if (user.last_vote_at) {
        const lastMs = new Date(user.last_vote_at).getTime();
        if (Number.isFinite(lastMs)) {
            expiresMs = lastMs + PREMIUM_BASE_HOURS * 60 * 60 * 1000;
        }
    }

    if (Number.isFinite(expiresMs) && expiresMs > nowMs) {
        return { isPremium: true, expiresAt: new Date(expiresMs).toISOString() };
    }
    return { isPremium: false };
}

/**
 * Compute the next stacked `premium_expires_at` ISO timestamp when a real vote lands.
 * - Expired / first-time voter: `now + 13h` (12h + 1h grace buffer).
 * - Active voter (e.g. voting on Top.gg then DiscordForge): `currentExpiry + 12h`.
 */
export function computeStackedPremiumExpiry(
    user: { last_vote_at?: string | null | undefined; premium_expires_at?: string | null | undefined } | null | undefined,
    nowMs: number = Date.now()
): string {
    const graceFloorMs = nowMs + (PREMIUM_BASE_HOURS - PREMIUM_STACK_HOURS) * 60 * 60 * 1000; // now + 1h
    const active = computePremiumWindow(user, nowMs);
    const currentExpiresMs = active.expiresAt ? new Date(active.expiresAt).getTime() : 0;
    const baseMs = Math.max(Number.isFinite(currentExpiresMs) ? currentExpiresMs : 0, graceFloorMs);
    return new Date(baseMs + PREMIUM_STACK_HOURS * 60 * 60 * 1000).toISOString();
}

/**
 * Verify a Top.gg v1 `x-topgg-signature` header ("t=<unix>,v1=<hex>") against
 * the raw request body.
 */
export function verifyTopggSignature(
    header: string,
    rawBody: string | Buffer,
    secret: string,
    nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
    const parts = new Map<string, string>();
    for (const piece of header.split(',')) {
        const idx = piece.indexOf('=');
        if (idx > 0) parts.set(piece.slice(0, idx).trim(), piece.slice(idx + 1).trim());
    }

    const timestamp = parts.get('t');
    const signature = parts.get('v1');
    if (!timestamp || !signature) return false;

    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > SIGNATURE_TOLERANCE_SECONDS) return false;

    const body = typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody;
    const expected = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.`)
        .update(body)
        .digest('hex');

    return timingSafeEqual(signature, expected);
}

/**
 * Verify a DiscordForge Webhooks v2 `X-Forge-Signature` header ("sha256=<hex>")
 * against the raw request body using timing-safe comparison.
 */
export function verifyDiscordForgeSignature(
    header: string,
    rawBody: string | Buffer,
    secret: string
): boolean {
    const trimmed = header.trim();
    if (!trimmed.startsWith('sha256=')) return false;

    const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
    const expected = 'sha256=' + crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');

    return timingSafeEqual(trimmed, expected);
}

/**
 * Identify which bot list sent a webhook request, verify its authenticity,
 * and normalize the payload into a BotListVoteEvent.
 */
export function classifyVoteWebhook(
    headers: VoteWebhookHeaders,
    rawBody: string | Buffer,
    body: any,
    secrets: VoteWebhookSecrets,
    nowSeconds?: number
): ClassifyResult {
    // 1. Top.gg v1: signed requests carry x-topgg-signature.
    const topggSignature = headers['x-topgg-signature'];
    if (topggSignature) {
        if (!secrets.topggSignatureSecret) {
            return { ok: false, status: 403, reason: 'Top.gg v1 signature received but TOPGG_WEBHOOK_SECRET is not configured' };
        }
        if (!verifyTopggSignature(topggSignature, rawBody, secrets.topggSignatureSecret, nowSeconds)) {
            return { ok: false, status: 403, reason: 'Invalid Top.gg v1 signature' };
        }
        return parseTopggV1(body);
    }

    // 2. DiscordForge Webhooks v2: signed requests carry X-Forge-Signature.
    const forgeSignature = headers['x-forge-signature'];
    if (forgeSignature) {
        if (!secrets.discordForgeSignatureSecret) {
            return { ok: false, status: 403, reason: 'DiscordForge v2 signature received but DISCORDFORGE_WEBHOOK_SECRET is not configured' };
        }
        if (!verifyDiscordForgeSignature(forgeSignature, rawBody, secrets.discordForgeSignatureSecret)) {
            return { ok: false, status: 401, reason: 'Invalid DiscordForge v2 signature' };
        }
        return parseDiscordForgeV2(body, headers['x-forge-event'], headers['x-forge-delivery']);
    }

    const auth = headers.authorization;
    if (!auth) {
        return { ok: false, status: 401, reason: 'Missing Authorization or webhook signature header' };
    }

    // 3/4. Legacy shared-secret formats: pick the parser by payload shape, then
    // verify the matching secret, so reused secrets can't cross wires.
    if (body && typeof body === 'object' && typeof body.user === 'string' && typeof body.bot === 'string') {
        if (!secrets.topggAuth || !timingSafeEqual(auth, secrets.topggAuth)) {
            return { ok: false, status: 403, reason: 'Invalid Authorization for Top.gg v0 payload' };
        }
        return parseTopggV0(body);
    }

    if (body && typeof body === 'object' && typeof body.id === 'string' && !('data' in body && 'bot_id' in body)) {
        if (!secrets.discordForgeAuth || !timingSafeEqual(auth, secrets.discordForgeAuth)) {
            return { ok: false, status: 403, reason: 'Invalid Authorization for DiscordForge payload' };
        }
        return parseDiscordForgeLegacy(body);
    }

    return { ok: false, status: 400, reason: 'Unrecognized vote payload shape' };
}

function nonEmptyString(val: unknown): string | undefined {
    if (typeof val !== 'string') return undefined;
    const trimmed = val.trim();
    return trimmed ? trimmed : undefined;
}

function parseTopggV1(body: any): ClassifyResult {
    const type = body?.type;
    if (type !== 'vote.create' && type !== 'webhook.test') {
        // Signed, authentic, but not a vote — acknowledge without recording.
        return { ok: false, status: 204, reason: `Ignoring Top.gg v1 event ${String(type)}` };
    }

    const data = body?.data ?? {};
    const userId = nonEmptyString(data?.user?.platform_id);
    if (!userId) {
        if (type === 'webhook.test') {
            return { ok: false, status: 204, reason: 'Top.gg v1 webhook.test without voter data' };
        }
        return { ok: false, status: 400, reason: 'Top.gg v1 vote.create missing data.user.platform_id' };
    }

    const weight = Number(data?.weight);
    const eventId = nonEmptyString(data?.id);
    const username = nonEmptyString(data?.user?.name) ?? nonEmptyString(data?.user?.username);
    const avatarUrl = nonEmptyString(data?.user?.avatar_url) ?? nonEmptyString(data?.user?.avatar);

    return {
        ok: true,
        event: {
            source: 'topgg',
            format: 'topgg_v1',
            eventId,
            userId,
            username,
            avatarUrl,
            weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
            isTest: type === 'webhook.test',
            isWeekend: Number.isFinite(weight) ? weight >= 2 : undefined,
            query: normalizeQuery(data?.query),
        },
    };
}

function parseDiscordForgeV2(
    body: any,
    eventHeader?: string | undefined,
    deliveryHeader?: string | undefined
): ClassifyResult {
    const type = typeof body?.type === 'string' ? body.type : eventHeader;
    if (type !== 'vote.created') {
        // Authentic signed DiscordForge v2 event for another subscription
        // (e.g. review.created, milestone.votes, follower.new, boost.expiring).
        // Acknowledge with 204 so DiscordForge marks delivery successful without retrying.
        return { ok: false, status: 204, reason: `Ignoring DiscordForge v2 event ${String(type ?? 'unknown')}` };
    }

    const data = body?.data ?? {};
    const isTest = body?.test === true || data?.test === true || body?.isTest === true;
    const userId = typeof data?.voter_id === 'string' ? data.voter_id.trim() : '';

    if (!userId) {
        if (isTest) {
            return { ok: false, status: 204, reason: 'DiscordForge v2 test vote.created without voter_id' };
        }
        return { ok: false, status: 400, reason: 'DiscordForge v2 vote.created missing data.voter_id' };
    }

    const eventId = nonEmptyString(body?.id) ?? nonEmptyString(deliveryHeader);

    const streakNum = Number(data?.streak);
    const weeklyNum = Number(data?.weekly_votes);
    const totalNum = Number(data?.total_votes);

    return {
        ok: true,
        event: {
            source: 'discordforge',
            format: 'discordforge_v2',
            eventId,
            userId,
            username: nonEmptyString(data?.username),
            avatarUrl: nonEmptyString(data?.avatar_url),
            weight: 1,
            isTest,
            streak: Number.isFinite(streakNum) ? streakNum : undefined,
            weeklyVotes: Number.isFinite(weeklyNum) ? weeklyNum : undefined,
            totalVotes: Number.isFinite(totalNum) ? totalNum : undefined,
        },
    };
}

function parseTopggV0(body: any): ClassifyResult {
    const userId = nonEmptyString(body.user);
    if (!userId) {
        return { ok: false, status: 400, reason: 'Top.gg v0 payload missing user' };
    }
    const isWeekend = body.isWeekend === true;
    return {
        ok: true,
        event: {
            source: 'topgg',
            format: 'topgg_v0',
            userId,
            weight: isWeekend ? 2 : 1,
            isTest: body.type === 'test',
            isWeekend,
            query: normalizeQuery(body.query),
        },
    };
}

function parseDiscordForgeLegacy(body: any): ClassifyResult {
    const userId = nonEmptyString(body.id);
    if (!userId) {
        return { ok: false, status: 400, reason: 'DiscordForge payload missing id' };
    }
    return {
        ok: true,
        event: {
            source: 'discordforge',
            format: 'discordforge_v1',
            userId,
            username: nonEmptyString(body.username),
            weight: 1,
            isTest: body.isTest === true,
            weeklyVotes: Number.isFinite(Number(body.weeklyVotes)) ? Number(body.weeklyVotes) : undefined,
            totalVotes: Number.isFinite(Number(body.totalVotes)) ? Number(body.totalVotes) : undefined,
        },
    };
}

/**
 * Top.gg sends query params as "?a=b" strings in v0 and as an object in v1;
 * normalize both to a plain object (or null).
 */
function normalizeQuery(query: unknown): Record<string, unknown> | null {
    if (query == null) return null;
    if (typeof query === 'object' && !Array.isArray(query)) {
        return Object.keys(query as object).length ? query as Record<string, unknown> : null;
    }
    if (typeof query === 'string' && query.length) {
        try {
            const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
            const obj: Record<string, unknown> = {};
            for (const [k, v] of params) obj[k] = v;
            return Object.keys(obj).length ? obj : null;
        } catch {
            return null;
        }
    }
    return null;
}
