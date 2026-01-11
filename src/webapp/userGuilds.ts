import { Router, Request, Response } from 'express';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';

const router = Router();

const DISCORD_API_BASE = 'https://discord.com/api/v10';

// Discord permission flags
const MANAGE_GUILD = 0x20; // 32

// Cache TTL: 30 minutes
const CACHE_TTL_MS = 30 * 60 * 1000;
// Manual refresh cooldown: 5 minutes
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

interface DiscordGuild {
    id: string;
    name: string;
    icon: string | null;
    owner: boolean;
    permissions: string; // Bitfield as string
}

interface CachedGuildData {
    id: string;
    name: string;
    icon: string | null;
    owner: boolean;
    permissions: string;
}

interface GuildWithBotStatus {
    id: string;
    name: string;
    icon_url: string | null;
    member_count?: number;
    poll_count?: number;
    has_bot: boolean;
}

/**
 * Helper: Fetch guilds from Discord API and cache them
 */
async function fetchAndCacheGuilds(sessionId: string, accessToken: string): Promise<DiscordGuild[] | null> {
    const discordResponse = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!discordResponse.ok) {
        const errorText = await discordResponse.text();
        logger.error(`[UserGuilds] Failed to fetch guilds from Discord: ${errorText}`);
        return null;
    }

    const userGuilds: DiscordGuild[] = await discordResponse.json();

    // Cache the guilds
    await supabase
        .from('dashboard_sessions')
        .update({
            cached_guilds: userGuilds,
            guilds_cached_at: new Date().toISOString(),
        })
        .eq('id', sessionId);

    logger.info(`[UserGuilds] Cached ${userGuilds.length} guilds for session ${sessionId.substring(0, 8)}...`);

    return userGuilds;
}

/**
 * Helper: Process guild list into categorized response
 */
async function processGuilds(userGuilds: DiscordGuild[], userId: string): Promise<{ withBot: GuildWithBotStatus[], withoutBot: GuildWithBotStatus[] }> {
    // Filter to guilds where user has MANAGE_GUILD permission
    const manageableGuilds = userGuilds.filter(guild => {
        const permissions = BigInt(guild.permissions);
        return (permissions & BigInt(MANAGE_GUILD)) !== BigInt(0) || guild.owner;
    });

    logger.info(`[UserGuilds] User ${userId} has ${manageableGuilds.length} manageable guilds out of ${userGuilds.length}`);

    if (manageableGuilds.length === 0) {
        return { withBot: [], withoutBot: [] };
    }

    // Get all bot's guilds from database
    const guildIds = manageableGuilds.map(g => g.id);
    const { data: botGuilds } = await supabase
        .from('guilds')
        .select('id, name, icon_url, member_count')
        .in('id', guildIds);

    const botGuildIds = new Set(botGuilds?.map(g => g.id) || []);

    // Get poll counts per guild
    const pollCountMap: Record<string, number> = {};
    if (botGuilds && botGuilds.length > 0) {
        const { data: pollData } = await supabase
            .from('polls')
            .select('guild_id')
            .in('guild_id', botGuilds.map(g => g.id));

        if (pollData) {
            for (const poll of pollData) {
                pollCountMap[poll.guild_id] = (pollCountMap[poll.guild_id] || 0) + 1;
            }
        }
    }

    // Split into two categories
    const withBot: GuildWithBotStatus[] = [];
    const withoutBot: GuildWithBotStatus[] = [];

    for (const guild of manageableGuilds) {
        const iconUrl = guild.icon
            ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
            : null;

        if (botGuildIds.has(guild.id)) {
            // Bot is in this guild - get extra info from our DB
            const dbGuild = botGuilds?.find(g => g.id === guild.id);
            withBot.push({
                id: guild.id,
                name: dbGuild?.name || guild.name,
                icon_url: dbGuild?.icon_url || iconUrl,
                member_count: dbGuild?.member_count,
                poll_count: pollCountMap[guild.id] || 0,
                has_bot: true,
            });
        } else {
            // Bot is NOT in this guild - user can add it
            withoutBot.push({
                id: guild.id,
                name: guild.name,
                icon_url: iconUrl,
                has_bot: false,
            });
        }
    }

    // Sort withBot by poll count (descending), then by name
    withBot.sort((a, b) => {
        const pollDiff = (b.poll_count || 0) - (a.poll_count || 0);
        if (pollDiff !== 0) return pollDiff;
        return a.name.localeCompare(b.name);
    });
    // Sort withoutBot by name
    withoutBot.sort((a, b) => a.name.localeCompare(b.name));

    return { withBot, withoutBot };
}

/**
 * GET /api/user/guilds
 * Returns guilds where the user has Manage Guild permission,
 * split into two categories: with bot and without bot
 * Uses cached data if available and not stale (30 min TTL)
 */
router.get('/guilds', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const sessionId = authHeader?.replace('Bearer ', '');

    if (!sessionId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // Get session with access token and cache data
        const { data: session, error: sessionError } = await supabase
            .from('dashboard_sessions')
            .select('user_id, access_token, expires_at, cached_guilds, guilds_cached_at')
            .eq('id', sessionId)
            .single();

        if (sessionError || !session) {
            return res.status(401).json({ error: 'Invalid session' });
        }

        if (new Date(session.expires_at).getTime() < Date.now()) {
            return res.status(401).json({ error: 'Session expired' });
        }

        let userGuilds: DiscordGuild[];
        let lastRefreshed: string;

        // Check if we have valid cached data
        const cacheAge = session.guilds_cached_at
            ? Date.now() - new Date(session.guilds_cached_at).getTime()
            : Infinity;

        if (session.cached_guilds && cacheAge < CACHE_TTL_MS) {
            // Use cached data
            userGuilds = session.cached_guilds as DiscordGuild[];
            lastRefreshed = session.guilds_cached_at;
            logger.info(`[UserGuilds] Using cached guilds for user ${session.user_id} (age: ${Math.round(cacheAge / 1000)}s)`);
        } else {
            // Cache is stale or missing - fetch fresh data
            logger.info(`[UserGuilds] Cache stale/missing for user ${session.user_id}, fetching from Discord`);
            const freshGuilds = await fetchAndCacheGuilds(sessionId, session.access_token);

            if (!freshGuilds) {
                // Discord API error
                if (session.cached_guilds) {
                    // Return stale cache as fallback
                    userGuilds = session.cached_guilds as DiscordGuild[];
                    lastRefreshed = session.guilds_cached_at || new Date().toISOString();
                    logger.warn(`[UserGuilds] Discord API failed, returning stale cache`);
                } else {
                    return res.status(502).json({ error: 'Failed to fetch guilds from Discord' });
                }
            } else {
                userGuilds = freshGuilds;
                lastRefreshed = new Date().toISOString();
            }
        }

        const { withBot, withoutBot } = await processGuilds(userGuilds, session.user_id);

        return res.json({
            withBot,
            withoutBot,
            lastRefreshed,
            cacheMaxAge: CACHE_TTL_MS,
        });
    } catch (error) {
        logger.error('[UserGuilds] Error fetching user guilds:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/user/guilds/refresh
 * Force refresh guilds from Discord API
 * Rate limited to once per 5 minutes
 */
router.post('/guilds/refresh', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const sessionId = authHeader?.replace('Bearer ', '');

    if (!sessionId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // Get session with cache data
        const { data: session, error: sessionError } = await supabase
            .from('dashboard_sessions')
            .select('user_id, access_token, expires_at, guilds_cached_at')
            .eq('id', sessionId)
            .single();

        if (sessionError || !session) {
            return res.status(401).json({ error: 'Invalid session' });
        }

        if (new Date(session.expires_at).getTime() < Date.now()) {
            return res.status(401).json({ error: 'Session expired' });
        }

        // Check rate limit
        if (session.guilds_cached_at) {
            const timeSinceLastRefresh = Date.now() - new Date(session.guilds_cached_at).getTime();
            if (timeSinceLastRefresh < REFRESH_COOLDOWN_MS) {
                const retryAfter = Math.ceil((REFRESH_COOLDOWN_MS - timeSinceLastRefresh) / 1000);
                return res.status(429).json({
                    error: 'Rate limited',
                    retryAfter,
                    message: `Please wait ${retryAfter} seconds before refreshing again`,
                });
            }
        }

        // Fetch fresh data from Discord
        logger.info(`[UserGuilds] Manual refresh requested by user ${session.user_id}`);
        const freshGuilds = await fetchAndCacheGuilds(sessionId, session.access_token);

        if (!freshGuilds) {
            return res.status(502).json({ error: 'Failed to fetch guilds from Discord' });
        }

        const { withBot, withoutBot } = await processGuilds(freshGuilds, session.user_id);

        return res.json({
            withBot,
            withoutBot,
            lastRefreshed: new Date().toISOString(),
            cacheMaxAge: CACHE_TTL_MS,
        });
    } catch (error) {
        logger.error('[UserGuilds] Error refreshing guilds:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export const userGuildsRouter = router;
