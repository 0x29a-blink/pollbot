import { DMChannel, Events, NonThreadGuildBasedChannel } from 'discord.js';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';
import { cancelPendingRender } from '../lib/renderQueue';

export default {
    name: Events.ChannelDelete,
    async execute(channel: DMChannel | NonThreadGuildBasedChannel) {
        if (!('guildId' in channel) || !channel.guildId) return;
        if (!process.env.SUPABASE_URL) return;

        const { data, error } = await supabase
            .from('polls')
            .update({ discord_deleted: true, active: false })
            .eq('guild_id', channel.guildId)
            .eq('channel_id', channel.id)
            .select('message_id');

        if (error) {
            logger.error(`[Persistence] Failed to mark polls as deleted for channel ${channel.id}:`, error);
            return;
        }

        if (data && data.length > 0) {
            for (const row of data) {
                cancelPendingRender(row.message_id);
            }
            logger.info(`[Persistence] Marked ${data.length} poll(s) in deleted channel ${channel.id} as discord_deleted`);
        }
    },
};
