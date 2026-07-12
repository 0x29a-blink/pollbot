import crypto from 'crypto';

// Classification + verification for the unified /vote webhook. One endpoint
// (https://webhook.pollbot.win/vote) receives votes from every bot list we're
// on, in three wire formats:
//
//   1. Top.gg v1        — `x-topgg-signature: t=<unix>,v1=<hmac>` header,
//                         HMAC-SHA256 of "<t>.<rawBody>" with the whs_ secret;
//                         body is { type: "vote.create"|"webhook.test", data: {...} }
//   2. Top.gg legacy v0 — `Authorization: <shared secret>` header;
//                         flat body { bot, user, type, isWeekend, query }
//   3. DiscordForge     — `Authorization: <shared secret>` header;
//                         body { id, username, weeklyVotes, totalVotes, isTest }
//
// Everything here is pure (no I/O) so it can be unit tested; the Express
// handler in webhook.ts does the DB writes.

export interface BotListVoteEvent {
    source: 'topgg' | 'discordforge';
    userId: string;
    username?: string | undefined;
    avatarUrl?: string | undefined;
    /** Vote weight — Top.gg sends 2 during weekend double-vote periods. */
    weight: number;
    isTest: boolean;
    isWeekend?: boolean | undefined;
    weeklyVotes?: number | undefined;
    totalVotes?: number | undefined;
    query?: Record<string, unknown> | null | undefined;
}

export interface VoteWebhookSecrets {
    /** Top.gg legacy v0 shared secret (Authorization header). */
    topggAuth?: string | undefined;
    /** Top.gg v1 signing secret (whs_...). */
    topggSignatureSecret?: string | undefined;
    /** DiscordForge shared secret (Authorization header). */
    discordForgeAuth?: string | undefined;
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
 * Identify which bot list sent a webhook request, verify its authenticity,
 * and normalize the payload into a BotListVoteEvent.
 */
export function classifyVoteWebhook(
    headers: { authorization?: string | undefined; 'x-topgg-signature'?: string | undefined },
    rawBody: string | Buffer,
    body: any,
    secrets: VoteWebhookSecrets,
    nowSeconds?: number
): ClassifyResult {
    // 1. Top.gg v1: signed requests carry x-topgg-signature.
    const signature = headers['x-topgg-signature'];
    if (signature) {
        if (!secrets.topggSignatureSecret) {
            return { ok: false, status: 403, reason: 'Top.gg v1 signature received but TOPGG_WEBHOOK_SECRET is not configured' };
        }
        if (!verifyTopggSignature(signature, rawBody, secrets.topggSignatureSecret, nowSeconds)) {
            return { ok: false, status: 403, reason: 'Invalid Top.gg v1 signature' };
        }
        return parseTopggV1(body);
    }

    const auth = headers.authorization;
    if (!auth) {
        return { ok: false, status: 401, reason: 'Missing Authorization header' };
    }

    // 2/3. Shared-secret formats: pick the parser by payload shape, then
    // verify the matching secret, so reused secrets can't cross wires.
    if (body && typeof body === 'object' && typeof body.user === 'string' && typeof body.bot === 'string') {
        if (!secrets.topggAuth || !timingSafeEqual(auth, secrets.topggAuth)) {
            return { ok: false, status: 403, reason: 'Invalid Authorization for Top.gg v0 payload' };
        }
        return parseTopggV0(body);
    }

    if (body && typeof body === 'object' && typeof body.id === 'string') {
        if (!secrets.discordForgeAuth || !timingSafeEqual(auth, secrets.discordForgeAuth)) {
            return { ok: false, status: 403, reason: 'Invalid Authorization for DiscordForge payload' };
        }
        return parseDiscordForge(body);
    }

    return { ok: false, status: 400, reason: 'Unrecognized vote payload shape' };
}

function parseTopggV1(body: any): ClassifyResult {
    const type = body?.type;
    if (type !== 'vote.create' && type !== 'webhook.test') {
        // Signed, authentic, but not a vote — acknowledge without recording.
        return { ok: false, status: 204, reason: `Ignoring Top.gg v1 event ${String(type)}` };
    }

    const data = body?.data ?? {};
    const userId = data?.user?.platform_id;
    if (typeof userId !== 'string' || !userId) {
        if (type === 'webhook.test') {
            return { ok: false, status: 204, reason: 'Top.gg v1 webhook.test without voter data' };
        }
        return { ok: false, status: 400, reason: 'Top.gg v1 vote.create missing data.user.platform_id' };
    }

    const weight = Number(data?.weight);
    return {
        ok: true,
        event: {
            source: 'topgg',
            userId,
            username: typeof data?.user?.name === 'string' ? data.user.name : undefined,
            avatarUrl: typeof data?.user?.avatar_url === 'string' ? data.user.avatar_url : undefined,
            weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
            isTest: type === 'webhook.test',
            isWeekend: Number.isFinite(weight) ? weight >= 2 : undefined,
            query: normalizeQuery(data?.query),
        },
    };
}

function parseTopggV0(body: any): ClassifyResult {
    if (typeof body.user !== 'string' || !body.user) {
        return { ok: false, status: 400, reason: 'Top.gg v0 payload missing user' };
    }
    const isWeekend = body.isWeekend === true;
    return {
        ok: true,
        event: {
            source: 'topgg',
            userId: body.user,
            weight: isWeekend ? 2 : 1,
            isTest: body.type === 'test',
            isWeekend,
            query: normalizeQuery(body.query),
        },
    };
}

function parseDiscordForge(body: any): ClassifyResult {
    if (typeof body.id !== 'string' || !body.id) {
        return { ok: false, status: 400, reason: 'DiscordForge payload missing id' };
    }
    return {
        ok: true,
        event: {
            source: 'discordforge',
            userId: body.id,
            username: typeof body.username === 'string' ? body.username : undefined,
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
