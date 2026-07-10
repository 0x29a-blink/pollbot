import { Events, Guild } from 'discord.js';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';

export default {
    name: Events.GuildDelete,
    async execute(guild: Guild) {
        if (!process.env.SUPABASE_URL) return;

        logger.info(`[Persistence] Left guild ${guild.id}. Cleaning up poll data...`);

        const { error } = await supabase
            .from('polls')
            .delete()
            .eq('guild_id', guild.id);

        if (error) {
            logger.error(`[Persistence] Failed to delete polls for guild ${guild.id}:`, error);
        } else {
            logger.info(`[Persistence] Cleared all polls for guild ${guild.id}`);
        }

        // Soft-mark the guild as left so dashboard counts exclude it. The row is
        // kept (polls.guild_id has a non-cascading FK) and left_at clears on
        // re-join via upsertGuildRow.
        const { error: guildError } = await supabase
            .from('guilds')
            .update({ left_at: new Date().toISOString() })
            .eq('id', guild.id);

        if (guildError) {
            logger.error(`[Persistence] Failed to mark guild ${guild.id} as left:`, guildError);
        }
    },
};
