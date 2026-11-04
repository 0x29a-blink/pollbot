import { supabase } from './db';
import { logger } from './logger';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const POSITIVE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const NEGATIVE_TTL_MS = 60 * 60 * 1000; // 1 hour (404 / deleted user)
const TRANSIENT_TTL_MS = 60 * 1000; // 1 minute (rate limit / network hiccup)
const MAX_CACHE_ENTRIES = 2000;
const DEFAULT_TIMEOUT_MS = 1500;
const SNOWFLAKE_RE = /^\d{15,22}$/;

export interface DiscordUserProfile {
    id: string;
    username: string;
    discriminator: string;
    avatarUrl: string;
}

interface CacheEntry {
    profile: DiscordUserProfile | null;
    expiresAt: number;
}

const profileCache = new Map<string, CacheEntry>();

export function clearDiscordUserCache(): void {
    profileCache.clear();
}

/**
 * Construct a Discord CDN avatar URL (falling back to the deterministic default
 * embed avatar when a user has no custom avatar hash).
 */
export function buildDiscordAvatarUrl(user: {
    id: string;
    discriminator?: string | null | undefined;
    avatar?: string | null | undefined;
}): string {
    if (user.avatar && user.avatar.trim()) {
        return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar.trim()}.png`;
    }
    let defaultIndex = 0;
    if (!user.discriminator || user.discriminator === '0') {
        if (SNOWFLAKE_RE.test(user.id)) {
            defaultIndex = Number((BigInt(user.id) >> 22n) % 6n);
        }
    } else {
        const parsed = parseInt(user.discriminator, 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
            defaultIndex = parsed % 5;
        }
    }
    return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
}

function setCached(userId: string, profile: DiscordUserProfile | null, ttlMs: number, nowMs: number): void {
    if (profileCache.size >= MAX_CACHE_ENTRIES && !profileCache.has(userId)) {
        const oldestKey = profileCache.keys().next().value;
        if (oldestKey) profileCache.delete(oldestKey);
    }
    profileCache.set(userId, { profile, expiresAt: nowMs + ttlMs });
}

export interface FetchDiscordUserOptions {
    token?: string | undefined;
    timeoutMs?: number | undefined;
    nowMs?: number | undefined;
    fetchImpl?: typeof fetch | undefined;
}

/**
 * Resolve a Discord user's public profile (`username`, `avatarUrl`) by snowflake
 * ID using the bot token (`GET /api/v10/users/:id`). Works for any Discord user
 * globally, even if they don't share a server with the bot or haven't signed into
 * the dashboard.
 */
export async function fetchDiscordUserProfile(
    userId: string,
    opts: FetchDiscordUserOptions = {}
): Promise<DiscordUserProfile | null> {
    if (!SNOWFLAKE_RE.test(userId)) return null;

    const token = (opts.token ?? process.env.DISCORD_TOKEN ?? '').trim();
    if (!token) return null;

    const nowMs = opts.nowMs ?? Date.now();
    const cached = profileCache.get(userId);
    if (cached && cached.expiresAt > nowMs) {
        return cached.profile;
    }

    const fetchFn = opts.fetchImpl ?? fetch;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    try {
        const res = await fetchFn(`${DISCORD_API_BASE}/users/${userId}`, {
            headers: { Authorization: `Bot ${token}` },
            signal: AbortSignal.timeout(timeoutMs),
        });

        if (res.status === 404) {
            setCached(userId, null, NEGATIVE_TTL_MS, nowMs);
            return null;
        }

        if (!res.ok) {
            const retryHeader = Number(res.headers.get('retry-after'));
            const backoffMs = Number.isFinite(retryHeader) && retryHeader > 0
                ? Math.min(retryHeader * 1000, 10 * 60 * 1000)
                : TRANSIENT_TTL_MS;
            setCached(userId, null, backoffMs, nowMs);
            return null;
        }

        const raw = await res.json() as {
            id?: string;
            username?: string;
            discriminator?: string | null;
            avatar?: string | null;
        };

        const username = typeof raw.username === 'string' ? raw.username.trim() : '';
        if (!username) {
            setCached(userId, null, NEGATIVE_TTL_MS, nowMs);
            return null;
        }

        const profile: DiscordUserProfile = {
            id: userId,
            username,
            discriminator: typeof raw.discriminator === 'string' && raw.discriminator ? raw.discriminator : '0',
            avatarUrl: buildDiscordAvatarUrl({
                id: userId,
                discriminator: raw.discriminator,
                avatar: raw.avatar,
            }),
        };
        setCached(userId, profile, POSITIVE_TTL_MS, nowMs);
        return profile;
    } catch {
        setCached(userId, null, TRANSIENT_TTL_MS, nowMs);
        return null;
    }
}

/**
 * Fill missing `username` / `avatarUrl` on an incoming bot-list vote event
 * (needed for Top.gg legacy v0 and DiscordForge Webhooks v2, which only send
 * the voter's Discord snowflake ID). Checks `public.users` first and falls back
 * to Discord REST.
 */
export async function resolveVoteUserIdentity(
    vote: { userId: string; username?: string | undefined; avatarUrl?: string | undefined },
    opts: FetchDiscordUserOptions = {}
): Promise<{ username?: string | undefined; avatarUrl?: string | undefined }> {
    let username = vote.username?.trim() || undefined;
    let avatarUrl = vote.avatarUrl?.trim() || undefined;
    if (username && avatarUrl) {
        return { username, avatarUrl };
    }

    if (process.env.SUPABASE_URL) {
        try {
            const { data } = await supabase
                .from('users')
                .select('username, avatar_url')
                .eq('id', vote.userId)
                .maybeSingle();
            if (!username && data?.username) username = data.username;
            if (!avatarUrl && data?.avatar_url) avatarUrl = data.avatar_url;
        } catch (err) {
            logger.warn(`[DiscordUsers] users lookup failed for ${vote.userId}:`, err);
        }
    }

    if (!username || !avatarUrl) {
        const fetched = await fetchDiscordUserProfile(vote.userId, opts);
        if (fetched) {
            if (!username) username = fetched.username;
            if (!avatarUrl) avatarUrl = fetched.avatarUrl;
        }
    }

    return { username, avatarUrl };
}

export interface EnrichUserRowsOptions extends FetchDiscordUserOptions {
    /** Cap on live Discord API lookups per call so admin views always stay snappy. */
    maxDiscordLookups?: number | undefined;
    /** Whether `rows` may lack `users` table fields (true for raw `botlist_votes` selects). */
    checkUsersTable?: boolean | undefined;
    /** Persist newly resolved Discord profiles into `public.users` + `public.botlist_votes`. */
    persistToDb?: boolean | undefined;
}

/**
 * Enrich admin voter/supporter rows so known Discord accounts never render as
 * "Unknown user":
 *   1. Optionally merges `username` / `avatar_url` from `public.users`.
 *   2. Resolves remaining unknown snowflakes via Discord Bot REST (capped per call)
 *      and persists them back to `public.users` + `public.botlist_votes` so future
 *      reads hit Postgres directly.
 */
export async function enrichUserRows<
    T extends { user_id: string; username?: string | null; avatar_url?: string | null }
>(rows: T[], opts: EnrichUserRowsOptions = {}): Promise<T[]> {
    if (rows.length === 0) return rows;

    const byId = new Map<string, { username: string | null; avatar_url: string | null }>();

    if (opts.checkUsersTable !== false && process.env.SUPABASE_URL) {
        const distinctIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
        if (distinctIds.length > 0) {
            try {
                const { data } = await supabase
                    .from('users')
                    .select('id, username, avatar_url')
                    .in('id', distinctIds);
                for (const u of data ?? []) {
                    byId.set(u.id, {
                        username: u.username ?? null,
                        avatar_url: u.avatar_url ?? null,
                    });
                }
            } catch (err) {
                logger.warn('[DiscordUsers] Batch users lookup failed:', err);
            }
        }
    }

    const merged = rows.map(row => {
        const db = byId.get(row.user_id);
        return {
            ...row,
            username: db?.username || row.username || null,
            avatar_url: db?.avatar_url || row.avatar_url || null,
        };
    });

    const maxLookups = opts.maxDiscordLookups ?? 10;
    if (maxLookups <= 0) return merged;

    const missingIds = [...new Set(
        merged
            .filter(r => !r.username && SNOWFLAKE_RE.test(r.user_id))
            .map(r => r.user_id)
    )].slice(0, maxLookups);

    if (missingIds.length === 0) return merged;

    const resolved = new Map<string, DiscordUserProfile>();
    const CONCURRENCY = 3;
    for (let i = 0; i < missingIds.length; i += CONCURRENCY) {
        const batch = missingIds.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map(id => fetchDiscordUserProfile(id, opts)));
        for (const profile of results) {
            if (profile) resolved.set(profile.id, profile);
        }
    }

    if (resolved.size === 0) return merged;

    if (opts.persistToDb !== false && process.env.SUPABASE_URL) {
        const upsertRows = [...resolved.values()].map(p => ({
            id: p.id,
            username: p.username,
            discriminator: p.discriminator,
            avatar_url: p.avatarUrl,
        }));
        void supabase
            .from('users')
            .upsert(upsertRows, { onConflict: 'id' })
            .then(({ error }) => {
                if (error) logger.warn('[DiscordUsers] Failed to cache resolved Discord users:', error);
            });

        for (const p of resolved.values()) {
            void supabase
                .from('botlist_votes')
                .update({ username: p.username, avatar_url: p.avatarUrl })
                .eq('user_id', p.id)
                .is('username', null)
                .then(({ error }) => {
                    if (error) logger.warn(`[DiscordUsers] Failed to backfill botlist_votes for ${p.id}:`, error);
                });
        }
    }

    return merged.map(row => {
        const p = resolved.get(row.user_id);
        if (!p) return row;
        return {
            ...row,
            username: row.username || p.username,
            avatar_url: row.avatar_url || p.avatarUrl,
        };
    });
}
