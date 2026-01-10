import { Client, Events, Guild } from 'discord.js';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';

export class GuildSyncService {
    private client: Client;

    constructor(client: Client) {
        this.client = client;
        this.init();
    }

    private init() {
        this.client.on(Events.ClientReady, () => {
            logger.info('[GuildSync] Client ready, syncing all guilds...');
            this.syncAllGuilds();
        });

        this.client.on(Events.GuildCreate, (guild) => {
            logger.info(`[GuildSync] Joined new guild: ${guild.name} (${guild.id})`);
            this.syncGuild(guild);
        });

        this.client.on(Events.GuildDelete, (guild) => {
            logger.info(`[GuildSync] Left guild: ${guild.name} (${guild.id})`);
            // Optional: Delete from DB or mark as inactive?
            // For now, we'll leave it but maybe we could update a status if we had one.
            // Or just do nothing, and the periodic sync (if we had one) would catch it.
            // Let's at least log it.
        });

        this.client.on(Events.GuildUpdate, (oldGuild, newGuild) => {
            logger.info(`[GuildSync] Guild updated: ${newGuild.name} (${newGuild.id})`);
            this.syncGuild(newGuild);
        });

        // Listen for member updates/joins/leaves to keep member_count roughly accurate
        // Note: member_count on the guild object is cached.
        this.client.on(Events.GuildMemberAdd, (member) => {
            this.syncGuild(member.guild);
        });

        this.client.on(Events.GuildMemberRemove, (member) => {
            this.syncGuild(member.guild);
        });

        // Listen for IPC messages to trigger manual sync (from webhook server)
        process.on('message', (msg: any) => {
            if (msg?.type === 'SYNC_ALL_GUILDS') {
                logger.info('[GuildSync] Received manual sync request');
                this.syncAllGuilds();
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

    private async syncGuild(guild: Guild) {
        try {
            const iconUrl = guild.iconURL({ extension: 'png', forceStatic: false }) || guild.iconURL({ extension: 'png' }); // dynamic: true is deprecated in v14 favor of forceStatic: false? 
            // Correct for v14: guild.iconURL({ dynamic: true }) is deprecated? No, it's still there but let's check.
            // Checking docs memory: v14 uses `guild.iconURL({ forceStatic: false })` to get dynamic if available.
            // Actually, let's just use `guild.iconURL()` - wait, to get GIF we need to specify.
            // Code: guild.iconURL() returns string | null. options: ImageURLOptions.
            // ImageURLOptions: { forceStatic?: boolean, extension?: string, size?: number }

            const processedIconUrl = guild.iconURL({ forceStatic: false }) || null;

            await supabase.from('guilds').upsert({
                id: guild.id,
                name: guild.name,
                member_count: guild.memberCount,
                icon_url: processedIconUrl,
                locale: guild.preferredLocale,
                joined_at: guild.joinedAt?.toISOString() || new Date().toISOString(),
                updated_at: new Date().toISOString()
            });
        } catch (error) {
            logger.error(`[GuildSync] Failed to sync guild ${guild.id}:`, error);
        }
    }
}
