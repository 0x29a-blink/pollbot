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
 * Max rows per upsert request. The bot runs on a bandwidth-metered Supabase
 * plan and each HTTPS round trip costs ~1.7 KB in headers alone, so full-fleet
 * syncs must batch — one request per guild put ~12 GB/month on the wire.
 */
const UPSERT_CHUNK_SIZE = 500;

/**
 * Upserts guild rows in batches. Single source of truth for writing to the
 * guilds table — used by GuildSyncService and as a recovery path when a poll
 * insert hits the polls.guild_id foreign key because the guild was never
 * synced.
 *
 * @returns true if every chunk succeeded
 */
export async function upsertGuildRows(rows: GuildRow[]): Promise<boolean> {
    if (rows.length === 0) return true;

    const updated_at = new Date().toISOString();
    let ok = true;

    for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
        const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE);
        const { error } = await supabase
            .from('guilds')
            .upsert(chunk.map(row => ({ ...row, updated_at })));

        if (error) {
            logger.error(
                `[GuildUtils] Failed to upsert ${chunk.length} guild(s) starting at ${chunk[0]?.id}:`,
                error
            );
            ok = false;
        }
    }

    return ok;
}

/**
 * Upserts a single guild row. Convenience wrapper over {@link upsertGuildRows}
 * for the event-driven call sites (guild join/update, FK recovery).
 *
 * @returns true if the upsert succeeded
 */
export async function upsertGuildRow(row: GuildRow): Promise<boolean> {
    return upsertGuildRows([row]);
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
