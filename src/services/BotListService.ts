import { ShardingManager, REST, Routes } from 'discord.js';
import { DiscordForgeClient } from '../lib/discordForge';
import { logger } from '../lib/logger';

// DiscordForge listing keep-alive, run from the manager process (the same
// place the Top.gg AutoPoster lives). Every 5 minutes — the API's stats rate
// limit and the expected heartbeat cadence — it posts server/shard/user
// counts and a heartbeat. On startup it also mirrors the bot's registered
// slash commands to the listing.
//
// All failures are logged and swallowed: a listing outage must never affect
// the bot.

const POST_INTERVAL_MS = 5 * 60 * 1000;

export class BotListService {
    private readonly forge: DiscordForgeClient;
    private timer: NodeJS.Timeout | null = null;

    constructor(private readonly manager: ShardingManager, apiKey: string) {
        this.forge = new DiscordForgeClient(apiKey);
    }

    start(): void {
        this.timer = setInterval(() => void this.postStats(), POST_INTERVAL_MS);
        this.timer.unref();

        // First stats post happens one interval in — shards are still spawning
        // at startup. Command sync can go out as soon as Discord answers.
        void this.syncCommands();

        logger.info('[BotList] DiscordForge poster started (stats + heartbeat every 5 minutes).');
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    private async postStats(): Promise<void> {
        try {
            const guildCounts = await this.manager.fetchClientValues('guilds.cache.size') as number[];
            const serverCount = guildCounts.reduce((acc, c) => acc + c, 0);
            if (serverCount === 0) return; // shards not ready yet

            const memberCounts = await this.manager.broadcastEval(c =>
                c.guilds.cache.reduce((acc, g) => acc + (g.memberCount ?? 0), 0)
            ) as number[];

            await this.forge.postStats({
                server_count: serverCount,
                shard_count: this.manager.shards.size,
                user_count: memberCounts.reduce((acc, c) => acc + c, 0),
            });
            await this.forge.heartbeat('online');
            logger.debug(`[BotList] Posted stats to DiscordForge (${serverCount} servers).`);
        } catch (err) {
            logger.error('[BotList] Failed to post stats/heartbeat to DiscordForge:', err);
        }
    }

    /**
     * Mirror the commands already registered with Discord to the listing.
     * Reading them back from Discord's API (rather than requiring the command
     * modules) keeps the manager process light and guarantees the listing
     * matches what users actually see.
     */
    private async syncCommands(): Promise<void> {
        const token = process.env.DISCORD_TOKEN;
        const clientId = process.env.DISCORD_CLIENT_ID;
        if (!token || !clientId) return;

        try {
            const rest = new REST().setToken(token);
            const isDev = process.env.DEV_ONLY_MODE === 'true';
            const devGuildId = process.env.DEV_GUILD_ID;

            const route = isDev && devGuildId
                ? Routes.applicationGuildCommands(clientId, devGuildId)
                : Routes.applicationCommands(clientId);

            const commands = await rest.get(route) as unknown[];
            if (!Array.isArray(commands) || commands.length === 0) {
                logger.warn('[BotList] No registered commands found to sync to DiscordForge.');
                return;
            }

            await this.forge.syncCommands(commands);
            logger.info(`[BotList] Synced ${commands.length} commands to DiscordForge.`);
        } catch (err) {
            logger.error('[BotList] Failed to sync commands to DiscordForge:', err);
        }
    }
}
