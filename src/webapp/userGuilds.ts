import { Router, Request, Response } from 'express';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';

const router = Router();

const DISCORD_API_BASE = 'https://discord.com/api/v10';

// Discord permission flags
const MANAGE_GUILD = 0x20; // 32

interface DiscordGuild {
    id: string;
    name: string;
    icon: string | null;
    owner: boolean;
    permissions: string; // Bitfield as string
}

interface GuildWithBotStatus {
    id: string;
    name: string;
    icon_url: string | null;
    member_count?: number;
    has_bot: boolean;
}

/**
 * GET /api/user/guilds
 * Returns guilds where the user has Manage Guild permission,
 * split into two categories: with bot and without bot
 */
router.get('/guilds', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const sessionId = authHeader?.replace('Bearer ', '');

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

        // Fetch user's guilds from Discord API
        const discordResponse = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
            headers: {
                Authorization: `Bearer ${session.access_token}`,
            },
        });

        if (!discordResponse.ok) {
            const errorText = await discordResponse.text();
            logger.error(`[UserGuilds] Failed to fetch guilds from Discord: ${errorText}`);

            if (discordResponse.status === 401) {
                return res.status(401).json({ error: 'Discord token expired, please re-login' });
            }
            return res.status(502).json({ error: 'Failed to fetch guilds from Discord' });
        }

        const userGuilds: DiscordGuild[] = await discordResponse.json();
        logger.info(`[UserGuilds] Discord returned ${userGuilds.length} guilds for user ${session.user_id}`);

        // Filter to guilds where user has MANAGE_GUILD permission
        const manageableGuilds = userGuilds.filter(guild => {
            const permissions = BigInt(guild.permissions);
            return (permissions & BigInt(MANAGE_GUILD)) !== BigInt(0) || guild.owner;
        });

        logger.info(`[UserGuilds] User has ${manageableGuilds.length} manageable guilds`);

        if (manageableGuilds.length === 0) {
            return res.json({ withBot: [], withoutBot: [] });
        }

        // Get all bot's guilds from database
        const guildIds = manageableGuilds.map(g => g.id);
        const { data: botGuilds } = await supabase
            .from('guilds')
            .select('id, name, icon_url, member_count')
            .in('id', guildIds);

        const botGuildIds = new Set(botGuilds?.map(g => g.id) || []);

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

        // Sort by name
        withBot.sort((a, b) => a.name.localeCompare(b.name));
        withoutBot.sort((a, b) => a.name.localeCompare(b.name));

        logger.info(`[UserGuilds] User ${session.user_id} has ${withBot.length} servers with bot, ${withoutBot.length} without`);

        return res.json({ withBot, withoutBot });
    } catch (error) {
        logger.error('[UserGuilds] Error fetching user guilds:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export const userGuildsRouter = router;
