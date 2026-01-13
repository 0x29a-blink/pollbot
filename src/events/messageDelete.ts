import { Events, Message, PartialMessage } from 'discord.js';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';

export default {
    name: Events.MessageDelete,
    async execute(message: Message | PartialMessage) {
        // If message is partial, we only have the ID, which is enough for DB lookup
        const messageId = message.id;

        if (!process.env.SUPABASE_URL) return;

        // Soft-delete: Mark poll as deleted and close it
        // This allows users to see deleted polls in dashboard and permanently delete them
        const { data, error } = await supabase
            .from('polls')
            .update({ discord_deleted: true, active: false })
            .eq('message_id', messageId)
            .select('message_id');

        if (error) {
            logger.error(`[Persistence] Failed to mark poll as deleted for message ${messageId}:`, error);
        } else if (data && data.length > 0) {
            logger.info(`[Persistence] Poll ${messageId} marked as discord_deleted`);
        }
    },
};
