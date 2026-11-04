import { Events, Message, PartialMessage, ReadonlyCollection, Snowflake } from 'discord.js';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';
import { cancelPendingRender } from '../lib/renderQueue';

export default {
    name: Events.MessageBulkDelete,
    async execute(messages: ReadonlyCollection<Snowflake, Message | PartialMessage>) {
        const messageIds = [...messages.keys()];
        if (messageIds.length === 0) return;

        for (const id of messageIds) {
            cancelPendingRender(id);
        }

        if (!process.env.SUPABASE_URL) return;

        const { data, error } = await supabase
            .from('polls')
            .update({ discord_deleted: true, active: false })
            .in('message_id', messageIds)
            .select('message_id');

        if (error) {
            logger.error(`[Persistence] Failed to mark bulk-deleted polls (${messageIds.length} messages):`, error);
        } else if (data && data.length > 0) {
            logger.info(`[Persistence] Marked ${data.length} bulk-deleted poll(s) as discord_deleted`);
        }
    },
};
