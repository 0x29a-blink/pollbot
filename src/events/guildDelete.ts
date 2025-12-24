import { Events, Guild } from 'discord.js';
import { supabase } from '../lib/db';

export default {
    name: Events.GuildDelete,
    async execute(guild: Guild) {
        if (!process.env.SUPABASE_URL) return;

        console.log(`[Persistence] Left guild ${guild.id}. Cleaning up poll data...`);

        const { error } = await supabase
            .from('polls')
            .delete()
            .eq('guild_id', guild.id);

        if (error) {
            console.error(`[Persistence] Failed to delete polls for guild ${guild.id}:`, error);
        } else {
            console.log(`[Persistence] Cleared all polls for guild ${guild.id}`);
        }
    },
};
