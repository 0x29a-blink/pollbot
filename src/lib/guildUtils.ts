import { Guild } from 'discord.js';
import { supabase } from './db';
import { logger } from './logger';

/**
 * Guild row shape for the guilds table. Only id and name are required
 * (all other columns have defaults).
 */
export interface GuildRow {
    id: string;
    name: string;
    member_count?: number;
    icon_url?: string | null;
    locale?: string;
    joined_at?: string;
    left_at?: string | null;
}

/**
 * Upserts a guild row. Single source of truth for writing to the guilds table —
 * used by GuildSyncService and as a recovery path when a poll insert hits the
 * polls.guild_id foreign key because the guild was never synced.
 *
 * @returns true if the upsert succeeded
 */
export async function upsertGuildRow(row: GuildRow): Promise<boolean> {
    const { error } = await supabase.from('guilds').upsert({
        ...row,
        updated_at: new Date().toISOString(),
    });

    if (error) {
        logger.error(`[GuildUtils] Failed to upsert guild ${row.id}:`, error);
        return false;
    }
    return true;
}

/**
 * Maps a discord.js Guild to a guilds table row.
 */
export function guildToRow(guild: Guild): GuildRow {
    return {
        id: guild.id,
        name: guild.name,
        member_count: guild.memberCount,
        icon_url: guild.iconURL({ forceStatic: false }) || null,
        locale: guild.preferredLocale,
        joined_at: guild.joinedAt?.toISOString() || new Date().toISOString(),
        // The bot can only sync a guild it is currently in, so every sync
        // clears the left marker (covers re-joins without a separate query).
        left_at: null,
    };
}
