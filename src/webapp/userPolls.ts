import { Router, Request, Response } from 'express';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';
import { aggregateVoteRows, fetchAllPollVotes, getVoteCountsForPoll } from '../lib/voteUtils';
import { groupVoteRows, MyVoteRow } from './voteGrouping';
import { trackUsage } from '../lib/usageTracker';
import { formatCsvCell } from '../lib/guildUtils';
import { DashboardSessionRecord, getValidDashboardSession, refreshAccessToken } from './dashboardAuth';

const router = Router();

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const BOT_TOKEN = process.env.DISCORD_TOKEN;
const MANAGE_GUILD = 0x20; // 32
const SNOWFLAKE_RE = /^\d{17,20}$/;
const PERMISSION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const VOTER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for voter data
const PREMIUM_HOURS = 13; // Vote valid for 13 hours (per view.ts line 35)
const TOPGG_VOTE_URL = 'https://top.gg/bot/911731627498041374/vote';
/** PostgREST's default max rows per request; loops page by this size. */
const DB_PAGE_SIZE = 1000;
/** Safety cap for the /votes distinct-poll index scan (100k vote rows). */
const MY_VOTES_MAX_SCAN_PAGES = 100;

/** Guild-wide poll counts returned as `summary` by GET /api/user/polls/:guildId. */
interface GuildPollSummary {
    total: number;
    active: number;
    closed: number;
    channels: { channel_id: string; count: number; open: number }[];
}

interface DiscordGuild {
    id: string;
    name: string;
    icon: string | null;
    owner: boolean;
    permissions: string;
}

interface VoterInfo {
    user_id: string;
    username: string;
    display_name: string;
    nickname: string | null;
    avatar_url: string | null;
}

interface CachedVoterData {
    voters: VoterInfo[];
    timestamp: number;
}

// Cached Discord member data (username, display_name, nickname, avatar)
// Key: `${guildId}:${userId}`, Value: { info: VoterInfo, timestamp: number }
interface CachedMemberInfo {
    info: VoterInfo;
    timestamp: number;
}
const memberCache = new Map<string, CachedMemberInfo>();
const MEMBER_CACHE_TTL = 30 * 60 * 1000; // 30 minutes for member data (rarely changes)

// Cache for guild membership + permission verification to avoid hitting Discord API rate limits
// Key: `${userId}:${guildId}`, Value: { isMember, hasManageGuild, timestamp }
interface CachedGuildMembership {
    isMember: boolean;
    hasManageGuild: boolean;
    timestamp: number;
}
const permissionCache = new Map<string, CachedGuildMembership>();

// Legacy voter cache (kept for backward compatibility but no longer used for caching)
const voterCache = new Map<string, CachedVoterData>();

// Cleanup stale cache entries periodically (every 10 minutes)
const cacheCleanupTimer = setInterval(() => {
    const now = Date.now();
    // Clean up member cache
    for (const [key, data] of memberCache) {
        if (now - data.timestamp > MEMBER_CACHE_TTL * 2) {
            memberCache.delete(key);
        }
    }
    // Clean up permission cache
    for (const [key, data] of permissionCache) {
        if (now - data.timestamp > PERMISSION_CACHE_TTL * 2) {
            permissionCache.delete(key);
        }
    }
    // Clean up legacy voter cache
    for (const [key, data] of voterCache) {
        if (now - data.timestamp > VOTER_CACHE_TTL * 2) {
            voterCache.delete(key);
        }
    }
}, 10 * 60 * 1000);
cacheCleanupTimer.unref();

/**
 * Get cached member info or null if not cached/expired
 */
function getCachedMember(guildId: string, userId: string): VoterInfo | null {
    const key = `${guildId}:${userId}`;
    const cached = memberCache.get(key);
    if (cached && Date.now() - cached.timestamp < MEMBER_CACHE_TTL) {
        return cached.info;
    }
    return null;
}

/**
 * Cache member info
 */
function setCachedMember(guildId: string, userId: string, info: VoterInfo): void {
    const key = `${guildId}:${userId}`;
    memberCache.set(key, { info, timestamp: Date.now() });
}

function getCachedMembership(userId: string, guildId: string): CachedGuildMembership | null {
    const key = `${userId}:${guildId}`;
    const cached = permissionCache.get(key);
    if (cached && Date.now() - cached.timestamp < PERMISSION_CACHE_TTL) {
        return cached;
    }
    return null;
}

function setCachedMembership(userId: string, guildId: string, isMember: boolean, hasManageGuild: boolean): void {
    const key = `${userId}:${guildId}`;
    permissionCache.set(key, { isMember, hasManageGuild, timestamp: Date.now() });
}

/**
 * Helper: Get session data from cookie/header (proactively refreshes expiring OAuth tokens)
 */
async function getSession(req: Request): Promise<DashboardSessionRecord | null> {
    return getValidDashboardSession(req);
}

async function getGuildMembershipForSession(
    session: DashboardSessionRecord,
    guildId: string
): Promise<{ ok: true; isMember: boolean; hasManageGuild: boolean } | { ok: false; status: number; error: string }> {
    const cached = getCachedMembership(session.user_id, guildId);
    if (cached) {
        return { ok: true, isMember: cached.isMember, hasManageGuild: cached.hasManageGuild };
    }

    let discordResponse = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (discordResponse.status === 401) {
        const newToken = await refreshAccessToken(session.id);
        if (newToken) {
            session.access_token = newToken;
            discordResponse = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
                headers: { Authorization: `Bearer ${newToken}` },
            });
        }
    }

    if (!discordResponse.ok) {
        logger.error(`[UserPolls] Failed to fetch guilds from Discord (status: ${discordResponse.status})`);
        if (discordResponse.status === 401) {
            return { ok: false, status: 401, error: 'Discord token expired, please re-login' };
        }
        return { ok: false, status: 503, error: 'Discord API temporarily unavailable, please try again' };
    }

    const userGuilds: DiscordGuild[] = await discordResponse.json();
    const targetGuild = userGuilds.find(g => g.id === guildId);
    if (!targetGuild) {
        setCachedMembership(session.user_id, guildId, false, false);
        return { ok: true, isMember: false, hasManageGuild: false };
    }

    const permissions = BigInt(targetGuild.permissions);
    const hasManageGuild = (permissions & BigInt(MANAGE_GUILD)) !== BigInt(0) || targetGuild.owner;
    setCachedMembership(session.user_id, guildId, true, hasManageGuild);

    return { ok: true, isMember: true, hasManageGuild };
}

async function verifyManageGuildForSession(
    session: DashboardSessionRecord,
    guildId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    const membership = await getGuildMembershipForSession(session, guildId);
    if (!membership.ok) {
        return membership;
    }
    if (!membership.isMember) {
        return { ok: false, status: 403, error: 'You are not a member of this server' };
    }
    if (!membership.hasManageGuild) {
        return { ok: false, status: 403, error: 'You need Manage Server permission' };
    }
    return { ok: true };
}

/**
 * Verifies the user may read voter/export data for a poll:
 * - User MUST currently be a member of `guildId` (blocks kicked/banned ex-creators)
 * - User must have Manage Server OR be the poll creator
 */
async function verifyPollReadAccessForSession(
    session: DashboardSessionRecord,
    guildId: string,
    creatorId: string | null | undefined
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    const membership = await getGuildMembershipForSession(session, guildId);
    if (!membership.ok) {
        return membership;
    }
    if (!membership.isMember) {
        return { ok: false, status: 403, error: 'You are not a member of this server' };
    }
    if (!membership.hasManageGuild && session.user_id !== creatorId) {
        return { ok: false, status: 403, error: 'You need Manage Server permission' };
    }
    return { ok: true };
}

/**
 * Helper: Check if user has premium status (voted within 13 hours)
 */
async function checkPremiumStatus(userId: string): Promise<{ isPremium: boolean; expiresAt?: string }> {
    const { data: userData } = await supabase
        .from('users')
        .select('last_vote_at')
        .eq('id', userId)
        .maybeSingle();

    if (!userData?.last_vote_at) {
        return { isPremium: false };
    }

    const lastVote = new Date(userData.last_vote_at);
    const now = new Date();
    const premiumCutoff = new Date(now.getTime() - PREMIUM_HOURS * 60 * 60 * 1000);

    if (lastVote > premiumCutoff) {
        // Calculate when premium expires
        const expiresAt = new Date(lastVote.getTime() + PREMIUM_HOURS * 60 * 60 * 1000);
        return { isPremium: true, expiresAt: expiresAt.toISOString() };
    }

    return { isPremium: false };
}

/**
 * Enriches unique Discord user IDs with guild member profile data (cached for 30 minutes).
 */
async function enrichUserIdsWithMemberInfo(
    userIds: string[],
    guildId: string,
    forceRefreshMembers = false
): Promise<Map<string, VoterInfo>> {
    const uniqueIds = [...new Set(userIds)];
    const resultMap = new Map<string, VoterInfo>();
    const uncachedUserIds: string[] = [];

    for (const userId of uniqueIds) {
        if (!forceRefreshMembers) {
            const cached = getCachedMember(guildId, userId);
            if (cached) {
                resultMap.set(userId, cached);
                continue;
            }
        }
        uncachedUserIds.push(userId);
    }

    if (BOT_TOKEN && uncachedUserIds.length > 0 && SNOWFLAKE_RE.test(guildId)) {
        logger.info(`[Voters] Fetching ${uncachedUserIds.length} uncached members (${resultMap.size} from cache)`);

        try {
            // Fetch members in batches of 100 (Discord API rate-limit friendly)
            for (let i = 0; i < uncachedUserIds.length; i += 100) {
                const batchIds = uncachedUserIds.slice(i, i + 100);

                // Fetch each member individually (Discord doesn't have batch member fetch via REST)
                const memberPromises = batchIds.map(async (userId) => {
                    if (!SNOWFLAKE_RE.test(userId)) {
                        return {
                            user_id: userId,
                            username: 'Unknown',
                            display_name: 'Unknown',
                            nickname: null,
                            avatar_url: null,
                        };
                    }
                    try {
                        const memberRes = await fetch(
                            `${DISCORD_API_BASE}/guilds/${guildId}/members/${userId}`,
                            { headers: { Authorization: `Bot ${BOT_TOKEN}` } }
                        );

                        let voterInfo: VoterInfo;
                        if (memberRes.ok) {
                            const member = await memberRes.json();
                            voterInfo = {
                                user_id: userId,
                                username: member.user?.username || 'Unknown',
                                display_name: member.user?.global_name || member.user?.username || 'Unknown',
                                nickname: member.nick || null,
                                avatar_url: member.user?.avatar
                                    ? `https://cdn.discordapp.com/avatars/${userId}/${member.user.avatar}.png`
                                    : null,
                            };
                        } else if (memberRes.status === 404) {
                            // Member left the guild
                            voterInfo = {
                                user_id: userId,
                                username: 'Left Server',
                                display_name: 'Left Server',
                                nickname: null,
                                avatar_url: null,
                            };
                        } else {
                            voterInfo = {
                                user_id: userId,
                                username: 'Unknown',
                                display_name: 'Unknown',
                                nickname: null,
                                avatar_url: null,
                            };
                        }

                        // Cache the result
                        setCachedMember(guildId, userId, voterInfo);
                        return voterInfo;
                    } catch (err) {
                        logger.warn(`[Voters] Failed to fetch member ${userId}:`, err);
                        const fallback: VoterInfo = {
                            user_id: userId,
                            username: 'Unknown',
                            display_name: 'Unknown',
                            nickname: null,
                            avatar_url: null,
                        };
                        // Still cache failures to prevent repeated requests
                        setCachedMember(guildId, userId, fallback);
                        return fallback;
                    }
                });

                const batchResults = await Promise.all(memberPromises);
                for (const info of batchResults) {
                    resultMap.set(info.user_id, info);
                }

                // Rate limit protection: small delay between batches
                if (i + 100 < uncachedUserIds.length) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        } catch (err) {
            logger.error('[Voters] Error fetching member data:', err);
        }
    }

    for (const userId of uncachedUserIds) {
        if (!resultMap.has(userId)) {
            resultMap.set(userId, {
                user_id: userId,
                username: 'Unknown',
                display_name: 'Unknown',
                nickname: null,
                avatar_url: null,
            });
        }
    }

    return resultMap;
}

/**
 * Helper: Fetch voter data with Discord member enrichment
 * Vote data is ALWAYS fetched fresh from the database (paginated past 1,000 rows).
 * Discord member info is cached per-user for 30 minutes to avoid redundant API calls.
 * @param forceRefreshMembers - If true, bypass member cache (refreshes Discord data)
 */
async function fetchVoterData(pollId: string, optionIndex: number, guildId: string, forceRefreshMembers = false): Promise<VoterInfo[]> {
    const { data: votes, error: votesError } = await fetchAllPollVotes(pollId, { optionIndex });

    if (votesError || !votes || votes.length === 0) {
        return [];
    }

    const userIds = votes.map(v => v.user_id);
    const enrichedMap = await enrichUserIdsWithMemberInfo(userIds, guildId, forceRefreshMembers);

    return userIds.map(userId => enrichedMap.get(userId) || {
        user_id: userId,
        username: 'Unknown',
        display_name: 'Unknown',
        nickname: null,
        avatar_url: null,
    });
}

/**
 * GET /api/user/votes
 * All polls the authenticated user has voted in, across servers.
 * Paginated by DISTINCT poll (newest vote first): `total` is the number of
 * distinct polls voted in, and each page carries every chosen option for the
 * polls on it, so multi-select votes never split across pages. No guild
 * permission check needed: users read only their own votes.
 */
router.get('/votes', async (req: Request, res: Response) => {
    const session = await getSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const limitRaw = parseInt((req.query.limit as string) ?? '25', 10);
    const offsetRaw = parseInt((req.query.offset as string) ?? '0', 10);
    if (Number.isNaN(limitRaw) || Number.isNaN(offsetRaw)) {
        return res.status(400).json({ error: 'limit and offset must be numbers' });
    }
    const limit = Math.min(Math.max(limitRaw, 1), 100);
    const offset = Math.max(offsetRaw, 0);

    try {
        // 1. Distinct poll ids ordered by the user's latest vote on each.
        //    Only lightweight columns are scanned (idx_votes_user_created),
        //    paginated past the 1,000-row cap. The inner joins mirror the
        //    detail query below so `total` only counts polls it can return.
        const orderedPollIds: string[] = [];
        const seen = new Set<string>();
        for (let page = 0; page < MY_VOTES_MAX_SCAN_PAGES; page++) {
            const from = page * DB_PAGE_SIZE;
            const { data, error } = await supabase
                .from('votes')
                .select('poll_id, created_at, polls!inner(message_id, guilds!inner(id))')
                .eq('user_id', session.user_id)
                .order('created_at', { ascending: false })
                .order('poll_id', { ascending: false })
                .order('option_index', { ascending: true })
                .range(from, from + DB_PAGE_SIZE - 1);

            if (error) {
                logger.error('[UserPolls] Failed to fetch user vote index:', error);
                return res.status(500).json({ error: 'Failed to fetch votes' });
            }

            const batch = (data ?? []) as { poll_id: string }[];
            for (const row of batch) {
                if (!seen.has(row.poll_id)) {
                    seen.add(row.poll_id);
                    orderedPollIds.push(row.poll_id);
                }
            }
            if (batch.length < DB_PAGE_SIZE) break;
            if (page === MY_VOTES_MAX_SCAN_PAGES - 1) {
                logger.warn(`[UserPolls] Vote index scan for user ${session.user_id} hit the ${MY_VOTES_MAX_SCAN_PAGES * DB_PAGE_SIZE}-row cap; total may be understated`);
            }
        }

        const total = orderedPollIds.length;
        const pagePollIds = orderedPollIds.slice(offset, offset + limit);
        if (pagePollIds.length === 0) {
            return res.json({ votes: [], total, limit, offset });
        }

        // 2. Every row the user has for the polls on this page (up to 100
        //    multi-select polls can exceed 1,000 rows, so paginate).
        const rows: MyVoteRow[] = [];
        for (let from = 0; ; from += DB_PAGE_SIZE) {
            const { data, error } = await supabase
                .from('votes')
                .select('poll_id, option_index, weight, created_at, polls!inner(message_id, title, guild_id, channel_id, active, ends_at, discord_deleted, options, guilds!inner(name, icon_url))')
                .eq('user_id', session.user_id)
                .in('poll_id', pagePollIds)
                .order('created_at', { ascending: false })
                .order('poll_id', { ascending: false })
                .order('option_index', { ascending: true })
                .range(from, from + DB_PAGE_SIZE - 1);

            if (error) {
                logger.error('[UserPolls] Failed to fetch user votes:', error);
                return res.status(500).json({ error: 'Failed to fetch votes' });
            }

            const batch = (data ?? []) as unknown as MyVoteRow[];
            rows.push(...batch);
            if (batch.length < DB_PAGE_SIZE) break;
        }

        // 3. One entry per poll, in distinct-poll page order.
        const grouped = groupVoteRows(rows);
        const byPoll = new Map(grouped.map(v => [v.poll_id, v]));
        const votes = pagePollIds
            .map(id => byPoll.get(id))
            .filter((v): v is NonNullable<typeof v> => v !== undefined);

        return res.json({ votes, total, limit, offset });
    } catch (err) {
        logger.error('[UserPolls] Unexpected error fetching user votes:', err);
        return res.status(500).json({ error: 'Failed to fetch votes' });
    }
});

/**
 * Guild-wide poll summary for the dashboard header/channel filter: totals and
 * per-channel counts over ALL polls in the guild (ignores search/status/channel
 * filters). Pages through `(channel_id, active)` past PostgREST's 1,000-row
 * cap so guilds with thousands of polls are counted correctly.
 * Returns null on query failure (callers must not show zeros as data).
 */
async function fetchGuildPollSummary(guildId: string): Promise<GuildPollSummary | null> {
    let total = 0;
    let active = 0;
    const channels = new Map<string, GuildPollSummary['channels'][number]>();

    for (let from = 0; ; from += DB_PAGE_SIZE) {
        const { data, error } = await supabase
            .from('polls')
            .select('channel_id, active')
            .eq('guild_id', guildId)
            .order('message_id', { ascending: true })
            .range(from, from + DB_PAGE_SIZE - 1);

        if (error) {
            logger.error(`[UserPolls] Failed to build poll summary for guild ${guildId}:`, error);
            return null;
        }

        const batch = (data ?? []) as { channel_id: string; active: boolean }[];
        for (const row of batch) {
            total++;
            if (row.active) active++;
            let entry = channels.get(row.channel_id);
            if (!entry) {
                entry = { channel_id: row.channel_id, count: 0, open: 0 };
                channels.set(row.channel_id, entry);
            }
            entry.count++;
            if (row.active) entry.open++;
        }

        if (batch.length < DB_PAGE_SIZE) break;
    }

    return {
        total,
        active,
        closed: total - active,
        channels: [...channels.values()].sort((a, b) =>
            b.count - a.count || a.channel_id.localeCompare(b.channel_id)
        ),
    };
}

/**
 * GET /api/user/guilds/:guildId/analytics
 * Premium-gated per-guild vote analytics (activity per day, peak hours,
 * top voters). Data flows through service_role RPCs — the anon key cannot
 * call them (repo rule: users/votes reads go through the authenticated API).
 */
router.get('/guilds/:guildId/analytics', async (req: Request, res: Response) => {
    const guildId = req.params.guildId as string;
    if (!guildId || !SNOWFLAKE_RE.test(guildId)) {
        return res.status(400).json({ error: 'Valid guild ID is required' });
    }

    const session = await getSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const daysRaw = parseInt((req.query.days as string) ?? '30', 10);
    const days = Number.isNaN(daysRaw) ? 30 : Math.min(Math.max(daysRaw, 1), 365);

    try {
        // Premium gate — same status/body shape as the voter-breakdown route
        const premiumStatus = await checkPremiumStatus(session.user_id);
        if (!premiumStatus.isPremium) {
            return res.status(403).json({
                error: 'Premium feature',
                message: 'Vote on top.gg to unlock this feature',
                voteUrl: TOPGG_VOTE_URL,
            });
        }

        // Manage Server permission check (cached, then Discord with token auto-refresh)
        const perm = await verifyManageGuildForSession(session, guildId);
        if (!perm.ok) {
            return res.status(perm.status).json({ error: perm.error });
        }

        // Fetch the three aggregates in parallel (service-role client)
        const [activityRes, peakRes, topRes] = await Promise.all([
            supabase.rpc('get_guild_vote_activity', { p_guild_id: guildId, p_days: days }),
            supabase.rpc('get_guild_peak_hours', { p_guild_id: guildId, p_days: days }),
            supabase.rpc('get_guild_top_voters', { p_guild_id: guildId, p_days: days, p_limit: 10 }),
        ]);

        if (activityRes.error || peakRes.error || topRes.error) {
            logger.error('[Analytics] RPC failure:', activityRes.error || peakRes.error || topRes.error);
            return res.status(500).json({ error: 'Failed to load analytics' });
        }

        // Enrich top voters with Discord usernames via the shared member cache
        const topVoterRows = (topRes.data ?? []) as { user_id: string; votes: number | string }[];
        const enrichedTopMap = await enrichUserIdsWithMemberInfo(
            topVoterRows.map(r => r.user_id),
            guildId
        );
        const topVoters = topVoterRows.map((row) => {
            const info = enrichedTopMap.get(row.user_id);
            return {
                user_id: row.user_id,
                username: info?.display_name ?? null,
                avatar_url: info?.avatar_url ?? null,
                votes: Number(row.votes),
            };
        });

        return res.json({
            days,
            activity: (activityRes.data ?? []).map((r: any) => ({ day: r.day, votes: Number(r.votes), unique_voters: Number(r.unique_voters) })),
            peakHours: (peakRes.data ?? []).map((r: any) => ({ hour: Number(r.hour), votes: Number(r.votes) })),
            topVoters,
        });
    } catch (err) {
        logger.error('[Analytics] Unexpected error:', err);
        return res.status(500).json({ error: 'Failed to load analytics' });
    }
});

/**
 * GET /api/user/polls/:guildId
 * Returns all polls in a server (requires Manage Guild permission)
 */
router.get('/polls/:guildId', async (req: Request, res: Response) => {
    const guildId = req.params.guildId as string;

    if (!guildId || !SNOWFLAKE_RE.test(guildId)) {
        return res.status(400).json({ error: 'Valid guild ID is required' });
    }

    try {
        const session = await getSession(req);
        if (!session) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const perm = await verifyManageGuildForSession(session, guildId);
        if (!perm.ok) {
            return res.status(perm.status).json({ error: perm.error });
        }

        // Verify bot is actively in this guild
        const { data: botGuild } = await supabase
            .from('guilds')
            .select('id, name, icon_url, member_count')
            .eq('id', guildId)
            .is('left_at', null)
            .maybeSingle();

        if (!botGuild) {
            return res.status(404).json({ error: 'Bot is not in this server' });
        }

        // Parse query parameters for filtering/pagination
        const search = ((req.query.search as string) || '').trim();
        const status = req.query.status as string; // 'active' | 'closed' | undefined
        const channelRaw = typeof req.query.channel === 'string' ? req.query.channel.trim() : '';
        if (channelRaw && !SNOWFLAKE_RE.test(channelRaw)) {
            return res.status(400).json({ error: 'channel must be a valid channel ID' });
        }
        const channel = channelRaw || null;
        const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 50, 1), 100);
        const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);

        // Build query with filters (count: 'exact' → total after filters)
        let query = supabase
            .from('polls')
            .select('*', { count: 'exact' })
            .eq('guild_id', guildId);

        if (search) {
            const escapedSearch = search.replace(/[\\%_]/g, '\\$&');
            query = query.ilike('title', `%${escapedSearch}%`);
        }

        // Apply status filter
        if (status === 'active') {
            query = query.eq('active', true);
        } else if (status === 'closed') {
            query = query.eq('active', false);
        }

        if (channel) {
            query = query.eq('channel_id', channel);
        }

        // Apply pagination and ordering
        query = query
            .order('created_at', { ascending: false })
            .order('message_id', { ascending: false })
            .range(offset, offset + limit - 1);

        // Guild-wide summary (ignores search/status/channel filters) runs in
        // parallel with the page query.
        const [pageResult, summary] = await Promise.all([query, fetchGuildPollSummary(guildId)]);
        const { data: polls, error: pollsError, count } = pageResult;

        if (pollsError) {
            logger.error(`[UserPolls] Failed to fetch polls:`, pollsError);
            return res.status(500).json({ error: 'Failed to fetch polls' });
        }

        // Get vote counts for each poll using centralized utility. A failed
        // count query yields nulls + counts_error so the dashboard can render a
        // dash instead of a misleading zero.
        const pollsWithVotes = await Promise.all((polls || []).map(async (poll) => {
            const { voteCounts, totalVotes, uniqueVoters, error: countsError } = await getVoteCountsForPoll(
                poll.message_id,
                poll.options as string[]
            );

            if (countsError) {
                return {
                    ...poll,
                    vote_counts: null,
                    total_votes: null,
                    unique_voters: null,
                    counts_error: true,
                };
            }

            return {
                ...poll,
                vote_counts: voteCounts,
                total_votes: totalVotes,
                unique_voters: uniqueVoters,
                counts_error: false,
            };
        }));

        logger.info(`[UserPolls] User ${session.user_id} fetched ${pollsWithVotes.length} polls from guild ${guildId} (has Manage Guild permission)`);

        return res.json({
            guild: {
                id: botGuild.id,
                name: botGuild.name,
                icon_url: botGuild.icon_url,
                member_count: botGuild.member_count,
            },
            polls: pollsWithVotes,
            total: count ?? pollsWithVotes.length,
            limit,
            offset,
            summary,
        });
    } catch (error) {
        logger.error('[UserPolls] Error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// VOTER & EXPORT ENDPOINTS
// ============================================================================

/**
 * GET /api/user/polls/:pollId/voters
 * Returns enriched voter data for a specific poll option (Premium feature)
 * Query params: option (required) - the option index to get voters for
 */
router.get('/polls/:pollId/voters', async (req: Request, res: Response) => {
    const pollId = req.params.pollId as string;
    const optionIndex = parseInt(req.query.option as string, 10);
    const forceRefresh = req.query.refresh === 'true';

    if (!pollId || !SNOWFLAKE_RE.test(pollId)) {
        return res.status(400).json({ error: 'Valid poll ID is required' });
    }

    if (isNaN(optionIndex) || optionIndex < 0) {
        return res.status(400).json({ error: 'Valid option index is required' });
    }

    const session = await getSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // Check premium status
        const premiumStatus = await checkPremiumStatus(session.user_id);
        if (!premiumStatus.isPremium) {
            return res.status(403).json({
                error: 'Premium feature',
                message: 'Vote on top.gg to unlock this feature',
                voteUrl: TOPGG_VOTE_URL,
            });
        }

        // Fetch poll to verify access and get guild ID
        const { data: poll, error: pollError } = await supabase
            .from('polls')
            .select('guild_id, options, settings, creator_id')
            .eq('message_id', pollId)
            .maybeSingle();

        if (pollError || !poll) {
            return res.status(404).json({ error: 'Poll not found' });
        }

        // Verify option index is valid
        if (optionIndex >= (poll.options as string[]).length) {
            return res.status(400).json({ error: 'Invalid option index' });
        }

        // Verify user is a current member of the guild and either has Manage Server or created the poll
        const perm = await verifyPollReadAccessForSession(
            session,
            poll.guild_id as string,
            poll.creator_id as string | null
        );
        if (!perm.ok) {
            return res.status(perm.status).json({ error: perm.error });
        }

        // Fetch voters with enrichment
        const voters = await fetchVoterData(pollId, optionIndex, poll.guild_id as string, forceRefresh);
        const optionName = (poll.options as string[])[optionIndex];

        logger.info(`[Voters] User ${session.user_id} fetched ${voters.length} voters for poll ${pollId} option ${optionIndex}`);

        return res.json({
            option_index: optionIndex,
            option_name: optionName,
            total_voters: voters.length,
            voters,
        });
    } catch (error) {
        logger.error('[Voters] Error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/user/polls/:pollId/export
 * Returns CSV data for the entire poll (Free feature)
 */
router.get('/polls/:pollId/export', async (req: Request, res: Response) => {
    const pollId = req.params.pollId as string;
    const forceRefresh = req.query.refresh === 'true';

    if (!pollId || !SNOWFLAKE_RE.test(pollId)) {
        return res.status(400).json({ error: 'Valid poll ID is required' });
    }

    const session = await getSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // Fetch poll to verify access
        const { data: poll, error: pollError } = await supabase
            .from('polls')
            .select('guild_id, options, title, settings, creator_id')
            .eq('message_id', pollId)
            .maybeSingle();

        if (pollError || !poll) {
            return res.status(404).json({ error: 'Poll not found' });
        }

        // Verify user is a current member of the guild and either has Manage Server or created the poll
        const perm = await verifyPollReadAccessForSession(
            session,
            poll.guild_id as string,
            poll.creator_id as string | null
        );
        if (!perm.ok) {
            return res.status(perm.status).json({ error: perm.error });
        }

        // Get all vote data (paginated past PostgREST 1,000-row cap)
        const { data: votes, error: votesError } = await fetchAllPollVotes(pollId);

        if (votesError) {
            return res.status(500).json({ error: 'Failed to fetch votes' });
        }

        if (!votes || votes.length === 0) {
            return res.json({
                csv: 'No votes found for this poll.',
                filename: `poll_${pollId}_export.csv`,
                total_votes: 0,
                unique_voters: 0,
                weighted_total: 0,
            });
        }

        // Enrich unique voters once via the shared member cache
        const options = poll.options as string[];
        const aggregation = aggregateVoteRows(votes, options.length);
        const voterDataMap = await enrichUserIdsWithMemberInfo(
            votes.map(v => v.user_id),
            poll.guild_id as string,
            forceRefresh
        );

        // Build CSV (formula-injection safe)
        const headers = ['User ID', 'Username', 'Display Name', 'Nickname', 'Option Index', 'Option Label', 'Weight', 'Timestamp (ISO)'];
        const rows = votes.map(vote => {
            const voterInfo = voterDataMap.get(vote.user_id);
            const username = voterInfo?.username || 'Unknown';
            const displayName = voterInfo?.display_name || 'Unknown';
            const nickname = voterInfo?.nickname || 'N/A';
            const optIdx = vote.option_index ?? -1;
            const optionLabel = (optIdx >= 0 && optIdx < options.length)
                ? options[optIdx]
                : 'Unknown Option';
            const weight = vote.weight || 1; // same default as aggregateVoteRows

            return [
                formatCsvCell(vote.user_id),
                formatCsvCell(username),
                formatCsvCell(displayName),
                formatCsvCell(nickname),
                optIdx,
                formatCsvCell(optionLabel),
                weight,
                formatCsvCell(vote.created_at),
            ].join(',');
        });

        const csv = [headers.join(','), ...rows].join('\n');

        logger.info(`[Export] User ${session.user_id} exported poll ${pollId} (${votes.length} votes)`);
        trackUsage({ source: 'dashboard', event_type: 'export', guild_id: poll.guild_id as string, user_id: session.user_id });

        return res.json({
            csv,
            filename: `poll_${pollId}_export.csv`,
            // Vote rows (one per chosen option); kept for compatibility.
            total_votes: votes.length,
            unique_voters: aggregation.uniqueVoters,
            weighted_total: aggregation.totalWeight,
        });
    } catch (error) {
        logger.error('[Export] Error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// PREMIUM STATUS ENDPOINTS
// ============================================================================

/**
 * GET /api/user/premium/status
 * Returns current user's premium status
 */
router.get('/premium/status', async (req: Request, res: Response) => {
    const session = await getSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const premiumStatus = await checkPremiumStatus(session.user_id);

        return res.json({
            isPremium: premiumStatus.isPremium,
            expiresAt: premiumStatus.expiresAt,
            voteUrl: TOPGG_VOTE_URL,
        });
    } catch (error) {
        logger.error('[Premium] Error checking status:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/user/premium/refresh
 * Re-check premium status (for after user votes)
 * Note: This doesn't actually query top.gg - the vote webhook updates last_vote_at.
 * This just returns the current status which may have been updated by the webhook.
 */
router.post('/premium/refresh', async (req: Request, res: Response) => {
    const session = await getSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // Simply re-check the status from the database
        // The top.gg webhook handler updates last_vote_at when a user votes
        const premiumStatus = await checkPremiumStatus(session.user_id);

        logger.info(`[Premium] User ${session.user_id} refreshed premium status: ${premiumStatus.isPremium}`);

        return res.json({
            isPremium: premiumStatus.isPremium,
            expiresAt: premiumStatus.expiresAt,
            voteUrl: TOPGG_VOTE_URL,
        });
    } catch (error) {
        logger.error('[Premium] Error refreshing status:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export const userPollsRouter = router;
