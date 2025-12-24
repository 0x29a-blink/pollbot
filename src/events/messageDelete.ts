import { Events, Message, PartialMessage } from 'discord.js';
import { supabase } from '../lib/db';

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
            console.error(`[Persistence] Failed to delete poll data for message ${messageId}:`, error);
        } else {
            // We could log success if we knew it was actually a poll, but delete is idempotent effectively
            // To be more verbose, we could select first, but that implies extra API call.
            // console.log(`[Persistence] Checked/Deleted poll data for message ${messageId}`);
        }
    },
};
