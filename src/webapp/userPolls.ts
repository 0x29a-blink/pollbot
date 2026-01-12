import { Router, Request, Response } from 'express';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';

const router = Router();

// Cookie name must match dashboardAuth.ts
const COOKIE_NAME = 'pollbot_session';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const MANAGE_GUILD = 0x20; // 32
const PERMISSION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface DiscordGuild {
    id: string;
    name: string;
    icon: string | null;
    owner: boolean;
    permissions: string;
}

// Cache for permission verification to avoid hitting Discord API rate limits
// Key: `${userId}:${guildId}`, Value: { hasPermission: boolean, timestamp: number }
const permissionCache = new Map<string, { hasPermission: boolean; timestamp: number }>();

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

export const userPollsRouter = router;
