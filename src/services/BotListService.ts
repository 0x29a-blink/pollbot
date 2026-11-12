import { Shard, ShardingManager, REST, Routes } from 'discord.js';
import { DiscordForgeClient, DiscordForgeError } from '../lib/discordForge';
import { logger } from '../lib/logger';

// DiscordForge listing keep-alive, run from the manager process (the same
// place the Top.gg AutoPoster lives).
//
// Heartbeat and stats are intentionally decoupled:
//   1. Heartbeat runs every 60s (per DiscordForge's official setup guide) and
//      fires immediately when the first shard comes online so restarts/updates
//      never leave a 5–10m blind spot. DiscordForge deduplicates recorded
//      uptime checks to 1 per 5m window while returning 200 OK to intermediate
//      pings, so 60s pings never 429 and never miss a 5m check boundary.
//   2. Stats run every 10m (well clear of /api/v1/bots/stats's 1 req / 5m rate
//      limit) and only when all shards are ready so partial server counts are
//      never reported and stats 429s/IPC hiccups can never block heartbeats.
//   3. On startup we also mirror registered slash commands to the listing.
//
// All failures are logged and swallowed: a listing outage must never affect
// the bot.

export const HEARTBEAT_INTERVAL_MS = 60 * 1000;
export const STATS_INTERVAL_MS = 10 * 60 * 1000;

export class BotListService {
    private readonly forge: DiscordForgeClient;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private statsTimer: NodeJS.Timeout | null = null;
    private heartbeatInFlight = false;
    private statsInFlight = false;
    private initialHeartbeatTriggered = false;
    private shardCreateListener: ((shard: Shard) => void) | null = null;

    constructor(private readonly manager: ShardingManager, apiKey: string, forgeClient?: DiscordForgeClient) {
        this.forge = forgeClient ?? new DiscordForgeClient(apiKey);
    }

    start(): void {
        if (this.heartbeatTimer || this.statsTimer) return;

        // Fire an immediate heartbeat as soon as the very first shard connects
        // (typically ~3–5s into boot) rather than waiting for all shards or the
        // first interval tick — keeps routine updates/restarts from dropping checks.
        const attachShardReadyHook = (shard: Shard) => {
            if (shard.ready) {
                this.triggerInitialHeartbeat();
                return;
            }
            shard.once('ready', () => this.triggerInitialHeartbeat());
        };

        this.shardCreateListener = attachShardReadyHook;
        this.manager.on('shardCreate', attachShardReadyHook);
        for (const shard of this.manager.shards.values()) {
            attachShardReadyHook(shard);
        }

        this.heartbeatTimer = setInterval(() => void this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
        this.heartbeatTimer.unref();

        this.statsTimer = setInterval(() => void this.postStats(), STATS_INTERVAL_MS);
        this.statsTimer.unref();

        void this.syncCommands();

        logger.info('[BotList] DiscordForge poster started (heartbeat every 60s, stats every 10m).');
    }

    /**
     * Called by the manager once `manager.spawn()` resolves and all shards are ready.
     * Immediately publishes full cluster stats and ensures a heartbeat has gone out.
     */
    onShardsSpawned(): void {
        void this.sendHeartbeat();
        void this.postStats();
    }

    stop(): void {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.statsTimer) clearInterval(this.statsTimer);
        this.heartbeatTimer = null;
        this.statsTimer = null;

        if (this.shardCreateListener) {
            this.manager.off('shardCreate', this.shardCreateListener);
            this.shardCreateListener = null;
        }
    }

    private triggerInitialHeartbeat(): void {
        if (this.initialHeartbeatTriggered) return;
        this.initialHeartbeatTriggered = true;
        void this.sendHeartbeat();
    }

    async sendHeartbeat(): Promise<void> {
        if (this.heartbeatInFlight) return;
        const readyShards = Array.from(this.manager.shards.values()).filter(s => s.ready);
        if (readyShards.length === 0) return;

        this.heartbeatInFlight = true;
        try {
            // Check each ready shard individually so a single reconnecting shard
            // never rejects the whole check and blocks our online heartbeat.
            const checks = await Promise.allSettled(
                readyShards.map(s => s.eval(c => c.isReady()))
            );
            const anyConnected = checks.some(r => r.status === 'fulfilled' && r.value === true);
            if (!anyConnected) return;

            const res = await this.forge.heartbeat('online');
            const suffix = res?.uptimeChecks !== undefined
                ? ` (${res.uptimeOnline}/${res.uptimeChecks}${res.message ? ` — ${res.message}` : ''})`
                : '';
            logger.debug(`[BotList] Sent heartbeat to DiscordForge${suffix}.`);
        } catch (err) {
            logger.error('[BotList] Failed to send heartbeat to DiscordForge:', err);
        } finally {
            this.heartbeatInFlight = false;
        }
    }

    async postStats(): Promise<void> {
        if (this.statsInFlight) return;

        const shards = Array.from(this.manager.shards.values());
        if (shards.length === 0 || !shards.every(s => s.ready)) return;
        if (typeof this.manager.totalShards === 'number' && shards.length < this.manager.totalShards) {
            return;
        }

        this.statsInFlight = true;
        try {
            const shardStats = await this.manager.broadcastEval(c => ({
                guilds: c.guilds.cache.size,
                members: c.guilds.cache.reduce((acc, g) => acc + (g.memberCount ?? 0), 0),
            })) as Array<{ guilds: number; members: number }>;

            const serverCount = shardStats.reduce((acc, s) => acc + s.guilds, 0);
            if (serverCount === 0) return;
            const userCount = shardStats.reduce((acc, s) => acc + s.members, 0);

            await this.forge.postStats({
                server_count: serverCount,
                shard_count: shards.length,
                user_count: userCount,
            });
            logger.debug(`[BotList] Posted stats to DiscordForge (${serverCount} servers, ${shards.length} shards).`);
        } catch (err) {
            if (err instanceof DiscordForgeError && err.status === 429) {
                logger.debug('[BotList] DiscordForge stats post skipped (rate-limited; next scheduled post in 10m).');
            } else {
                logger.error('[BotList] Failed to post stats to DiscordForge:', err);
            }
        } finally {
            this.statsInFlight = false;
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
            const rest = new REST({ makeRequest: globalThis.fetch as any }).setToken(token);
            const isDev = process.env.DEV_ONLY_MODE === 'true';
            const devGuildId = process.env.DEV_GUILD_ID;

            const route = isDev && devGuildId
                ? Routes.applicationGuildCommands(clientId, devGuildId)
                : Routes.applicationCommands(clientId);

            const commands = await rest.get(route) as any[];
            if (!Array.isArray(commands) || commands.length === 0) {
                logger.warn('[BotList] No registered commands found to sync to DiscordForge.');
                return;
            }

            // DiscordForge rejects commands without a description, which is
            // exactly what context-menu commands (type 2/3) are. Only slash
            // commands (type 1 / CHAT_INPUT) belong on the listing.
            const syncable = commands.filter(c =>
                (c?.type ?? 1) === 1 && typeof c?.description === 'string' && c.description.length > 0
            );
            if (syncable.length === 0) {
                logger.warn('[BotList] No slash commands with descriptions found to sync to DiscordForge.');
                return;
            }

            await this.forge.syncCommands(syncable);
            logger.info(`[BotList] Synced ${syncable.length}/${commands.length} commands to DiscordForge.`);
        } catch (err) {
            logger.error('[BotList] Failed to sync commands to DiscordForge:', err);
        }
    }
}
