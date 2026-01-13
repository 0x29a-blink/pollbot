import { Router, Request, Response } from 'express';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';

const router = Router();

// Cookie name must match dashboardAuth.ts
const COOKIE_NAME = 'pollbot_session';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const BOT_TOKEN = process.env.DISCORD_TOKEN;
const MANAGE_GUILD = 0x20; // 32
const PERMISSION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const VOTER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for voter data
const PREMIUM_HOURS = 13; // Vote valid for 13 hours (per view.ts line 35)
const TOPGG_VOTE_URL = 'https://top.gg/bot/911731627498041374/vote';

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

// Cache for permission verification to avoid hitting Discord API rate limits
// Key: `${userId}:${guildId}`, Value: { hasPermission: boolean, timestamp: number }
const permissionCache = new Map<string, { hasPermission: boolean; timestamp: number }>();

// Legacy voter cache (kept for backward compatibility but no longer used for caching)
const voterCache = new Map<string, CachedVoterData>();

// Cleanup stale cache entries periodically (every 10 minutes)
setInterval(() => {
    const now = Date.now();
    // Clean up member cache
    for (const [key, data] of memberCache) {
        if (now - data.timestamp > MEMBER_CACHE_TTL * 2) {
            memberCache.delete(key);
        }
    }
    // Clean up legacy voter cache
    for (const [key, data] of voterCache) {
        if (now - data.timestamp > VOTER_CACHE_TTL * 2) {
            voterCache.delete(key);
        }
    }
}, 10 * 60 * 1000);

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

function getCachedPermission(userId: string, guildId: string): boolean | null {
    const key = `${userId}:${guildId}`;
    const cached = permissionCache.get(key);
    if (cached && Date.now() - cached.timestamp < PERMISSION_CACHE_TTL) {
        return cached.hasPermission;
    }
    return null;
}

function setCachedPermission(userId: string, guildId: string, hasPermission: boolean): void {
    const key = `${userId}:${guildId}`;
    permissionCache.set(key, { hasPermission, timestamp: Date.now() });
}

/**
 * Helper: Get session data from cookie/header
 */
async function getSession(req: Request): Promise<{ user_id: string; access_token: string } | null> {
    const cookieSession = req.cookies?.[COOKIE_NAME];
    const authHeader = req.headers.authorization;
    const headerSession = authHeader?.replace('Bearer ', '');
    const sessionId = cookieSession || headerSession;

    if (!sessionId) return null;

    const { data: session, error } = await supabase
        .from('dashboard_sessions')
        .select('user_id, access_token, expires_at')
        .eq('id', sessionId)
        .single();

    if (error || !session) return null;
    if (new Date(session.expires_at).getTime() < Date.now()) return null;

    return session;
}

/**
 * Helper: Check if user has premium status (voted within 13 hours)
 */
async function checkPremiumStatus(userId: string): Promise<{ isPremium: boolean; expiresAt?: string }> {
    const { data: userData } = await supabase
        .from('users')
        .select('last_vote_at')
        .eq('id', userId)
        .single();

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
 * Helper: Fetch voter data with Discord member enrichment
 * Vote data is ALWAYS fetched fresh from the database.
 * Discord member info is cached per-user for 30 minutes to avoid redundant API calls.
 * @param forceRefreshMembers - If true, bypass member cache (refreshes Discord data)
 */
async function fetchVoterData(pollId: string, optionIndex: number, guildId: string, forceRefreshMembers = false): Promise<VoterInfo[]> {
    // ALWAYS fetch votes fresh from database (this is the source of truth)
    const { data: votes, error: votesError } = await supabase
        .from('votes')
        .select('user_id, created_at')
        .eq('poll_id', pollId)
        .eq('option_index', optionIndex);

    if (votesError || !votes || votes.length === 0) {
        return [];
    }

    const userIds = votes.map(v => v.user_id);
    const voters: VoterInfo[] = [];

    // Separate users into cached and uncached
    const uncachedUserIds: string[] = [];
    const cachedVoters: VoterInfo[] = [];

    for (const userId of userIds) {
        if (!forceRefreshMembers) {
            const cached = getCachedMember(guildId, userId);
            if (cached) {
                cachedVoters.push(cached);
                continue;
            }
        }
        uncachedUserIds.push(userId);
    }

    // Add cached users to result
    voters.push(...cachedVoters);

    // Fetch Discord member data only for uncached users
    if (BOT_TOKEN && uncachedUserIds.length > 0) {
        logger.info(`[Voters] Fetching ${uncachedUserIds.length} uncached members (${cachedVoters.length} from cache)`);

        try {
            // Fetch members in batches of 100 (Discord API limit)
            for (let i = 0; i < uncachedUserIds.length; i += 100) {
                const batchIds = uncachedUserIds.slice(i, i + 100);

                // Fetch each member individually (Discord doesn't have batch member fetch via REST)
                const memberPromises = batchIds.map(async (userId) => {
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
                voters.push(...batchResults);

                // Rate limit protection: small delay between batches
                if (i + 100 < uncachedUserIds.length) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        } catch (err) {
            logger.error('[Voters] Error fetching member data:', err);
            // Fall back to just user IDs for uncached users
            uncachedUserIds.forEach(userId => {
                voters.push({
                    user_id: userId,
                    username: 'Unknown',
                    display_name: 'Unknown',
                    nickname: null,
                    avatar_url: null,
                });
            });
        }
    } else if (!BOT_TOKEN) {
        // No bot token, just return user IDs for uncached users
        uncachedUserIds.forEach(userId => {
            voters.push({
                user_id: userId,
                username: 'Unknown',
                display_name: 'Unknown',
                nickname: null,
                avatar_url: null,
            });
        });
    }

    return voters;
}

/**
 * GET /api/user/polls/:guildId
 * Returns all polls in a server (requires Manage Guild permission)
 */
router.get('/polls/:guildId', async (req: Request, res: Response) => {
    const { guildId } = req.params;
    // Support both cookie and header auth
    const cookieSession = req.cookies?.[COOKIE_NAME];
    const authHeader = req.headers.authorization;
    const headerSession = authHeader?.replace('Bearer ', '');
    const sessionId = cookieSession || headerSession;

    if (!guildId) {
        return res.status(400).json({ error: 'Guild ID is required' });
    }

    if (!sessionId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // Get session with access token
        const { data: session, error: sessionError } = await supabase
            .from('dashboard_sessions')
            .select('user_id, access_token, expires_at')
            .eq('id', sessionId)
            .single();

        if (sessionError || !session) {
            return res.status(401).json({ error: 'Invalid session' });
        }

        if (new Date(session.expires_at).getTime() < Date.now()) {
            return res.status(401).json({ error: 'Session expired' });
        }

        // Check cached permission first to avoid Discord API rate limits
        const cachedPermission = getCachedPermission(session.user_id, guildId);

        if (cachedPermission === false) {
            return res.status(403).json({ error: 'You need Manage Server permission' });
        }

        // If not cached or cache says true, verify with Discord (but only if not cached)
        if (cachedPermission === null) {
            const discordResponse = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
                headers: {
                    Authorization: `Bearer ${session.access_token}`,
                },
            });

            if (!discordResponse.ok) {
                // On Discord API failure, don't show error if we have existing data
                // Just log and return 503 (Service Unavailable) which frontend can handle gracefully
                logger.error(`[UserPolls] Failed to fetch guilds from Discord (status: ${discordResponse.status})`);
                if (discordResponse.status === 401) {
                    return res.status(401).json({ error: 'Discord token expired, please re-login' });
                }
                // Return 503 instead of 502 to indicate temporary unavailability
                return res.status(503).json({ error: 'Discord API temporarily unavailable, please try again' });
            }

            const userGuilds: DiscordGuild[] = await discordResponse.json();

            // Find the specific guild and check permissions
            const targetGuild = userGuilds.find(g => g.id === guildId);
            if (!targetGuild) {
                setCachedPermission(session.user_id, guildId, false);
                return res.status(403).json({ error: 'You are not a member of this server' });
            }

            const permissions = BigInt(targetGuild.permissions);
            const hasManageGuild = (permissions & BigInt(MANAGE_GUILD)) !== BigInt(0) || targetGuild.owner;

            // Cache the result
            setCachedPermission(session.user_id, guildId, hasManageGuild);

            if (!hasManageGuild) {
                return res.status(403).json({ error: 'You need Manage Server permission' });
            }
        }

        // Verify bot is in this guild
        const { data: botGuild } = await supabase
            .from('guilds')
            .select('id, name, icon_url, member_count')
            .eq('id', guildId)
            .single();

        if (!botGuild) {
            return res.status(404).json({ error: 'Bot is not in this server' });
        }

        // Parse query parameters for filtering/pagination
        const search = (req.query.search as string || '').trim().toLowerCase();
        const status = req.query.status as string; // 'active' | 'closed' | undefined
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
        const offset = parseInt(req.query.offset as string) || 0;

        // Build query with filters
        let query = supabase
            .from('polls')
            .select('*')
            .eq('guild_id', guildId);

        // Apply status filter
        if (status === 'active') {
            query = query.eq('active', true);
        } else if (status === 'closed') {
            query = query.eq('active', false);
        }

        // Apply pagination and ordering
        query = query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        const { data: polls, error: pollsError, count } = await query;

        if (pollsError) {
            logger.error(`[UserPolls] Failed to fetch polls:`, pollsError);
            return res.status(500).json({ error: 'Failed to fetch polls' });
        }

        // Get vote counts for each poll
        const pollsWithVotes = await Promise.all((polls || []).map(async (poll) => {
            // Get votes grouped by option (including weight for weighted votes)
            const { data: votes } = await supabase
                .from('votes')
                .select('option_index, weight')
                .eq('poll_id', poll.message_id);

            const voteCounts: Record<number, number> = {};
            let totalWeight = 0;
            (votes || []).forEach(vote => {
                const weight = vote.weight || 1;
                voteCounts[vote.option_index] = (voteCounts[vote.option_index] || 0) + weight;
                totalWeight += weight;
            });

            return {
                ...poll,
                vote_counts: voteCounts,
                total_votes: totalWeight,
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
    const { pollId } = req.params;
    const optionIndex = parseInt(req.query.option as string);
    const forceRefresh = req.query.refresh === 'true';

    if (!pollId) {
        return res.status(400).json({ error: 'Poll ID is required' });
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
            .single();

        if (pollError || !poll) {
            return res.status(404).json({ error: 'Poll not found' });
        }

        // Verify option index is valid
        if (optionIndex >= (poll.options as string[]).length) {
            return res.status(400).json({ error: 'Invalid option index' });
        }

        // Check permission on the guild (poll creator always has access)
        const isCreator = poll.creator_id === session.user_id;
        if (!isCreator) {
            const cachedPerm = getCachedPermission(session.user_id, poll.guild_id as string);
            if (cachedPerm === false) {
                return res.status(403).json({ error: 'You need Manage Server permission' });
            }

            // If no cached permission, verify with Discord API
            if (cachedPerm === null) {
                const discordResponse = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
                    headers: { Authorization: `Bearer ${session.access_token}` },
                });

                if (!discordResponse.ok) {
                    return res.status(503).json({ error: 'Discord API temporarily unavailable' });
                }

                const userGuilds: DiscordGuild[] = await discordResponse.json();
                const targetGuild = userGuilds.find(g => g.id === poll.guild_id);

                if (!targetGuild) {
                    setCachedPermission(session.user_id, poll.guild_id as string, false);
                    return res.status(403).json({ error: 'You are not a member of this server' });
                }

                const permissions = BigInt(targetGuild.permissions);
                const hasManageGuild = (permissions & BigInt(MANAGE_GUILD)) !== BigInt(0) || targetGuild.owner;
                setCachedPermission(session.user_id, poll.guild_id as string, hasManageGuild);

                if (!hasManageGuild) {
                    return res.status(403).json({ error: 'You need Manage Server permission' });
                }
            }
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
    const { pollId } = req.params;
    const forceRefresh = req.query.refresh === 'true';

    if (!pollId) {
        return res.status(400).json({ error: 'Poll ID is required' });
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
            .single();

        if (pollError || !poll) {
            return res.status(404).json({ error: 'Poll not found' });
        }

        // Check permission on the guild (poll creator always has access)
        const isCreator = poll.creator_id === session.user_id;
        if (!isCreator) {
            const cachedPerm = getCachedPermission(session.user_id, poll.guild_id as string);
            if (cachedPerm === false) {
                return res.status(403).json({ error: 'You need Manage Server permission' });
            }

            // If no cached permission, verify with Discord API
            if (cachedPerm === null) {
                const discordResponse = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
                    headers: { Authorization: `Bearer ${session.access_token}` },
                });

                if (!discordResponse.ok) {
                    return res.status(503).json({ error: 'Discord API temporarily unavailable' });
                }

                const userGuilds: DiscordGuild[] = await discordResponse.json();
                const targetGuild = userGuilds.find(g => g.id === poll.guild_id);

                if (!targetGuild) {
                    setCachedPermission(session.user_id, poll.guild_id as string, false);
                    return res.status(403).json({ error: 'You are not a member of this server' });
                }

                const permissions = BigInt(targetGuild.permissions);
                const hasManageGuild = (permissions & BigInt(MANAGE_GUILD)) !== BigInt(0) || targetGuild.owner;
                setCachedPermission(session.user_id, poll.guild_id as string, hasManageGuild);

                if (!hasManageGuild) {
                    return res.status(403).json({ error: 'You need Manage Server permission' });
                }
            }
        }

        // Get all vote data
        const { data: votes, error: votesError } = await supabase
            .from('votes')
            .select('user_id, option_index, created_at')
            .eq('poll_id', pollId);

        if (votesError) {
            return res.status(500).json({ error: 'Failed to fetch votes' });
        }

        if (!votes || votes.length === 0) {
            return res.json({
                csv: 'No votes found for this poll.',
                filename: `poll_${pollId}_export.csv`,
                total_votes: 0,
            });
        }

        // Enrich with voter data (use cached data if available)
        const options = poll.options as string[];
        const voterDataMap = new Map<string, VoterInfo>();

        // Get unique option indices that have votes
        const optionIndices = [...new Set(votes.map(v => v.option_index).filter((i): i is number => i !== null && i !== undefined))];

        for (const optIndex of optionIndices) {
            const guildId = poll.guild_id as string;
            const voters = await fetchVoterData(pollId, optIndex, guildId, forceRefresh);
            voters.forEach(v => voterDataMap.set(v.user_id, v));
        }

        // Build CSV
        const headers = ['User ID', 'Username', 'Display Name', 'Nickname', 'Option Index', 'Option Label', 'Timestamp (ISO)'];
        const rows = votes.map(vote => {
            const voterInfo = voterDataMap.get(vote.user_id);
            const username = voterInfo?.username || 'Unknown';
            const displayName = voterInfo?.display_name || 'Unknown';
            const nickname = voterInfo?.nickname || 'N/A';
            const optionLabel = options[vote.option_index] || 'Unknown Option';

            // Escape double quotes for CSV
            const safe = (str: string | null | undefined) => {
                if (!str) return '';
                return `"${str.replace(/"/g, '""')}"`;
            };

            return [
                safe(vote.user_id),
                safe(username),
                safe(displayName),
                safe(nickname),
                vote.option_index,
                safe(optionLabel),
                safe(vote.created_at),
            ].join(',');
        });

        const csv = [headers.join(','), ...rows].join('\n');

        logger.info(`[Export] User ${session.user_id} exported poll ${pollId} (${votes.length} votes)`);

        return res.json({
            csv,
            filename: `poll_${pollId}_export.csv`,
            total_votes: votes.length,
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

