import { Client, Events, Guild } from 'discord.js';
import { logger } from '../lib/logger';
import { upsertGuildRow, guildToRow } from '../lib/guildUtils';
import { shardIdForGuild } from '../lib/shardUtils';
import { supabase } from '../lib/db';

const PERIODIC_SYNC_MS = 60 * 60 * 1000; // hourly

export class GuildSyncService {
    private client: Client;

    constructor(client: Client) {
        this.client = client;
        this.init();
    }

    private init() {
        this.client.on(Events.ClientReady, () => {
            logger.info('[GuildSync] Client ready, syncing all guilds...');
            this.syncAllGuilds().then(() => this.reconcileLeftGuilds());

            // Member counts only refresh via these periodic syncs — the
            // privileged GuildMembers intent is not requested, so member
            // add/remove events never arrive.
            const timer = setInterval(() => {
                this.syncAllGuilds().then(() => this.reconcileLeftGuilds());
            }, PERIODIC_SYNC_MS);
            timer.unref();
        });

        this.client.on(Events.GuildCreate, (guild) => {
            logger.info(`[GuildSync] Joined new guild: ${guild.name} (${guild.id})`);
            this.syncGuild(guild);
        });

        // Guild-leave cleanup (polls delete + left_at marker) lives in
        // src/events/guildDelete.ts — the single GuildDelete handler.

        this.client.on(Events.GuildUpdate, (oldGuild, newGuild) => {
            logger.info(`[GuildSync] Guild updated: ${newGuild.name} (${newGuild.id})`);
            this.syncGuild(newGuild);
        });

        // Listen for IPC messages to trigger manual sync (from webhook server)
        process.on('message', (msg: any) => {
            if (msg?.type === 'SYNC_ALL_GUILDS') {
                logger.info('[GuildSync] Received manual sync request');
                this.syncAllGuilds().then(() => this.reconcileLeftGuilds());
            }
        });
    }

    // Make this public so it can be called externally
    public async syncAllGuilds() {
        const guilds = this.client.guilds.cache;
        for (const [id, guild] of guilds) {
            await this.syncGuild(guild);
        }
        logger.info(`[GuildSync] Synced ${guilds.size} guilds.`);
    }

    /**
     * Marks guilds this shard owns but is no longer in as left. Each shard
     * only touches rows whose snowflake maps to it, so shards never fight
     * over rows and never mark guilds that simply live on another shard.
     */
    private async reconcileLeftGuilds() {
        const shard = this.client.shard;
        const shardIds = shard?.ids ?? [0];
        const shardCount = shard?.count ?? 1;

        const { data: rows, error } = await supabase
            .from('guilds')
            .select('id')
            .is('left_at', null);
        if (error || !rows) {
            logger.error('[GuildSync] Reconcile query failed:', error);
            return;
        }

        const stale = rows.filter(r =>
            shardIds.includes(shardIdForGuild(r.id, shardCount)) &&
            !this.client.guilds.cache.has(r.id)
        );
        if (stale.length === 0) return;

        const { error: updErr } = await supabase
            .from('guilds')
            .update({ left_at: new Date().toISOString() })
            .in('id', stale.map(r => r.id));
        if (updErr) {
            logger.error('[GuildSync] Failed to mark left guilds:', updErr);
        } else {
            logger.info(`[GuildSync] Marked ${stale.length} guild(s) as left during reconcile.`);
        }
    }

    private async syncGuild(guild: Guild) {
        try {
            await upsertGuildRow(guildToRow(guild));
        } catch (error) {
            logger.error(`[GuildSync] Failed to sync guild ${guild.id}:`, error);
        }
    }
}
