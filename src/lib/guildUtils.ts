import { APIInteractionGuildMember, Guild, GuildMember, PermissionsBitField } from 'discord.js';
import { supabase } from './db';
import { logger } from './logger';

export type InteractionMemberLike = GuildMember | APIInteractionGuildMember | null | undefined;

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

/**
 * Extracts role IDs safely from either a cached GuildMember or a raw
 * APIInteractionGuildMember (returned when GuildMemberManager evicts entries).
 */
export function memberRoleIds(member: InteractionMemberLike): string[] {
    if (!member || !member.roles) return [];
    if (Array.isArray(member.roles)) {
        return member.roles;
    }
    if ('cache' in member.roles && member.roles.cache) {
        return [...member.roles.cache.keys()];
    }
    return [];
}

/**
 * Checks whether an interaction member has a Discord permission bit, working
 * across both cached GuildMember and uncached APIInteractionGuildMember.
 */
export function memberHasPermission(member: InteractionMemberLike, flag: bigint): boolean {
    if (!member || !member.permissions) return false;
    if (typeof member.permissions === 'string') {
        try {
            return new PermissionsBitField(BigInt(member.permissions)).has(flag);
        } catch {
            return false;
        }
    }
    return member.permissions.has(flag);
}

export function memberHasManageGuild(member: InteractionMemberLike): boolean {
    return memberHasPermission(member, PermissionsBitField.Flags.ManageGuild);
}

/**
 * Checks whether an interaction member holds a role with the given name,
 * falling back to guild.roles.cache when the member itself is uncached.
 */
export function memberHasRoleName(
    guild: Guild | null | undefined,
    member: InteractionMemberLike,
    roleName: string
): boolean {
    if (!member) return false;
    if (!Array.isArray(member.roles) && member.roles?.cache) {
        if (member.roles.cache.some(r => r.name === roleName)) {
            return true;
        }
    }
    if (guild) {
        const roleIds = memberRoleIds(member);
        return roleIds.some(id => guild.roles.cache.get(id)?.name === roleName);
    }
    return false;
}

export function memberHasAnyRoleName(
    guild: Guild | null | undefined,
    member: InteractionMemberLike,
    roleNames: string[]
): boolean {
    return roleNames.some(name => memberHasRoleName(guild, member, name));
}

/**
 * Extracts a Discord message snowflake from either a raw ID or a message link.
 */
export function extractMessageId(input: string): string {
    const trimmed = input.trim();
    const match = trimmed.match(/channels\/(?:\d+|@me)\/\d+\/(\d+)/);
    if (match && match[1]) {
        return match[1];
    }
    return trimmed;
}

const MEMBER_FETCH_CHUNK_SIZE = 100;

/**
 * Fetches guild members in chunks of 100 IDs to respect Discord Gateway's
 * REQUEST_GUILD_MEMBERS per-request cap.
 */
export async function fetchMembersChunked(
    guild: Guild,
    userIds: string[]
): Promise<Map<string, GuildMember>> {
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    const result = new Map<string, GuildMember>();

    for (let i = 0; i < uniqueIds.length; i += MEMBER_FETCH_CHUNK_SIZE) {
        const chunk = uniqueIds.slice(i, i + MEMBER_FETCH_CHUNK_SIZE);
        try {
            const fetched = await guild.members.fetch({ user: chunk });
            fetched.forEach((member, id) => {
                result.set(id, member);
            });
        } catch (err) {
            logger.warn(`[GuildUtils] Partial/failed member chunk fetch (${chunk.length} users) in guild ${guild.id}: ${err}`);
        }
    }

    return result;
}

/**
 * Neutralizes spreadsheet formula injection (OWASP CSV Injection) by prefixing
 * cells starting with =, +, -, @, tab, or CR with a single quote.
 */
export function neutralizeCsvFormula(value: string): string {
    if (/^[=+\-@\t\r]/.test(value)) {
        return `'${value}`;
    }
    return value;
}

/**
 * Formats a string value as a quoted, formula-safe CSV cell.
 */
export function formatCsvCell(value: string | null | undefined): string {
    if (value === null || value === undefined || value === '') return '';
    const neutralized = neutralizeCsvFormula(String(value));
    return `"${neutralized.replace(/"/g, '""')}"`;
}

export interface ChannelOverwriteLike {
    id: string;
    type: number; // 0 = role, 1 = member
    allow: string;
    deny: string;
}

export interface RolePermissionLike {
    id: string;
    permissions: string;
}

const PERM_ADMINISTRATOR = 0x8n;
const PERM_VIEW_CHANNEL = 0x400n;
const PERM_SEND_MESSAGES = 0x800n;
const PERM_EMBED_LINKS = 0x4000n;
const PERM_ATTACH_FILES = 0x8000n;

/**
 * Computes effective Discord channel permissions following Discord's official
 * overwrite hierarchy:
 *   1. Guild owner or ADMINISTRATOR bit -> all permissions granted
 *   2. Base permissions = @everyone role | union(member roles)
 *   3. @everyone channel overwrite: (perms & ~deny) | allow
 *   4. Member role channel overwrites: (perms & ~unionDeny) | unionAllow
 *   5. Member-specific channel overwrite: (perms & ~memberDeny) | memberAllow
 */
export function computeChannelPermissions(params: {
    guildId: string;
    memberId?: string | undefined;
    isGuildOwner?: boolean | undefined;
    roles: RolePermissionLike[];
    memberRoleIds: string[];
    overwrites?: ChannelOverwriteLike[] | undefined;
}): bigint {
    const { guildId, memberId, isGuildOwner, roles, memberRoleIds: roleIds, overwrites } = params;
    if (isGuildOwner) {
        return ~0n;
    }

    let perms = 0n;
    const everyoneRole = roles.find(r => r.id === guildId);
    if (everyoneRole) {
        perms |= BigInt(everyoneRole.permissions);
    }

    const roleSet = new Set(roleIds);
    for (const role of roles) {
        if (roleSet.has(role.id)) {
            perms |= BigInt(role.permissions);
        }
    }

    if ((perms & PERM_ADMINISTRATOR) !== 0n) {
        return ~0n;
    }

    if (overwrites && overwrites.length > 0) {
        // 1. @everyone overwrite
        const everyoneOverwrite = overwrites.find(ow => ow.type === 0 && ow.id === guildId);
        if (everyoneOverwrite) {
            perms &= ~BigInt(everyoneOverwrite.deny);
            perms |= BigInt(everyoneOverwrite.allow);
        }

        // 2. Role overwrites (accumulated before applying so one role's allow beats another's deny)
        let roleAllow = 0n;
        let roleDeny = 0n;
        for (const ow of overwrites) {
            if (ow.type === 0 && ow.id !== guildId && roleSet.has(ow.id)) {
                roleAllow |= BigInt(ow.allow);
                roleDeny |= BigInt(ow.deny);
            }
        }
        perms &= ~roleDeny;
        perms |= roleAllow;

        // 3. Member-specific overwrite
        if (memberId) {
            const memberOverwrite = overwrites.find(ow => ow.type === 1 && ow.id === memberId);
            if (memberOverwrite) {
                perms &= ~BigInt(memberOverwrite.deny);
                perms |= BigInt(memberOverwrite.allow);
            }
        }
    }

    return perms;
}

export function canMemberPostPollInChannel(params: {
    guildId: string;
    memberId?: string | undefined;
    isGuildOwner?: boolean | undefined;
    roles: RolePermissionLike[];
    memberRoleIds: string[];
    overwrites?: ChannelOverwriteLike[] | undefined;
}): boolean {
    const perms = computeChannelPermissions(params);
    const required = PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES | PERM_ATTACH_FILES | PERM_EMBED_LINKS;
    return (perms & required) === required;
}
