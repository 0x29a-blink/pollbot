import { Client, Events, Guild } from 'discord.js';
import { logger } from '../lib/logger';
import { upsertGuildRow, upsertGuildRows, guildToRow } from '../lib/guildUtils';
import { shardIdForGuild } from '../lib/shardUtils';
import { supabase } from '../lib/db';

const PERIODIC_SYNC_MS = 60 * 60 * 1000; // hourly
const RECONCILE_PAGE_SIZE = 1000; // PostgREST max rows per response
const RECONCILE_UPDATE_CHUNK = 200; // ids per UPDATE ... WHERE id IN (...)

export class GuildSyncService {
    private client: Client;

    constructor(client: Client) {
        this.client = client;
        this.init();
    }

    private init() {
        const onReady = () => {
            logger.info('[GuildSync] Client ready, syncing all guilds...');
            this.syncAllGuilds().then(() => this.reconcileLeftGuilds());

            // Member counts only refresh via these periodic syncs — the
            // privileged GuildMembers intent is not requested, so member
            // add/remove events never arrive.
            const timer = setInterval(() => {
                this.syncAllGuilds().then(() => this.reconcileLeftGuilds());
            }, PERIODIC_SYNC_MS);
            timer.unref();
        };

        if (this.client.isReady()) {
            onReady();
        } else {
            this.client.once(Events.ClientReady, onReady);
        }

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
        // Batched, not one request per guild — see UPSERT_CHUNK_SIZE.
        const ok = await upsertGuildRows(guilds.map(guildToRow));
        if (ok) {
            logger.info(`[GuildSync] Synced ${guilds.size} guilds.`);
        } else {
            logger.error(`[GuildSync] Sync of ${guilds.size} guilds completed with errors.`);
        }
    }

    /**
     * Marks guilds this shard owns but is no longer in as left. Each shard
     * only touches rows whose snowflake maps to it, so shards never fight
     * over rows and never mark guilds that simply live on another shard.
     */
    private async reconcileLeftGuilds() {
        if (process.env.DEV_ONLY_MODE === 'true') {
            return;
        }

        const shard = this.client.shard;
        const shardIds = shard?.ids ?? [0];
        const shardCount = shard?.count ?? 1;

        // Page through every not-yet-left guild (PostgREST caps a single
        // response at 1,000 rows; there are far more guilds than that).
        // Deterministic id ordering keeps pages stable; rows marked left by
        // this pass are only written after the full scan completes.
        const rows: { id: string }[] = [];
        for (let from = 0; ; from += RECONCILE_PAGE_SIZE) {
            const { data, error } = await supabase
                .from('guilds')
                .select('id')
                .is('left_at', null)
                .order('id', { ascending: true })
                .range(from, from + RECONCILE_PAGE_SIZE - 1);
            if (error || !data) {
                logger.error('[GuildSync] Reconcile query failed:', error);
                return;
            }
            rows.push(...(data as { id: string }[]));
            if (data.length < RECONCILE_PAGE_SIZE) break;
        }

        const stale = rows.filter(r =>
            shardIds.includes(shardIdForGuild(r.id, shardCount)) &&
            !this.client.guilds.cache.has(r.id)
        );
        if (stale.length === 0) return;

        // Chunk the update so a large backlog doesn't overflow the URL
        // (.in() is encoded into the query string).
        const leftAt = new Date().toISOString();
        let marked = 0;
        for (let i = 0; i < stale.length; i += RECONCILE_UPDATE_CHUNK) {
            const ids = stale.slice(i, i + RECONCILE_UPDATE_CHUNK).map(r => r.id);
            const { error: updErr } = await supabase
                .from('guilds')
                .update({ left_at: leftAt })
                .in('id', ids);
            if (updErr) {
                logger.error('[GuildSync] Failed to mark left guilds:', updErr);
            } else {
                marked += ids.length;
            }
        }
        if (marked > 0) {
            logger.info(`[GuildSync] Marked ${marked} guild(s) as left during reconcile.`);
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
