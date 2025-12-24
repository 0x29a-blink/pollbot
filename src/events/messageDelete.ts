import { Events, Message, PartialMessage } from 'discord.js';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';

export default {
    name: Events.MessageDelete,
    async execute(message: Message | PartialMessage) {
        // If message is partial, we only have the ID, which is enough for DB lookup
        const messageId = message.id;

        if (!process.env.SUPABASE_URL) return;

        // Try to delete from polls table
        // We handle "poll data" deletion.
        const { error } = await supabase
            .from('polls')
            .delete()
            .eq('message_id', messageId);

        if (error) {
            logger.error(`[Persistence] Failed to delete poll data for message ${messageId}:`, error);
        }
    },
};
