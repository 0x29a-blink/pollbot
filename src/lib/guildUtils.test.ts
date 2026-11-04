import { describe, it, expect } from 'vitest';
import { Collection, PermissionsBitField } from 'discord.js';
import type { APIInteractionGuildMember, Guild, GuildMember, Role } from 'discord.js';
import {
    memberRoleIds,
    memberHasPermission,
    memberHasManageGuild,
    memberHasRoleName,
    memberHasAnyRoleName,
    extractMessageId,
    neutralizeCsvFormula,
    formatCsvCell,
    computeChannelPermissions,
    canMemberPostPollInChannel,
} from './guildUtils';

describe('guildUtils — cached vs uncached interaction member helpers', () => {
    it('extracts role IDs from both cached GuildMember and raw APIInteractionGuildMember', () => {
        const rawMember = {
            roles: ['111', '222'],
            permissions: '0',
        } as unknown as APIInteractionGuildMember;
        expect(memberRoleIds(rawMember)).toEqual(['111', '222']);

        const roleCache = new Collection<string, Role>();
        roleCache.set('333', { id: '333', name: 'Poll Manager' } as Role);
        const cachedMember = {
            roles: { cache: roleCache },
            permissions: new PermissionsBitField(0n),
        } as unknown as GuildMember;
        expect(memberRoleIds(cachedMember)).toEqual(['333']);
        expect(memberRoleIds(null)).toEqual([]);
    });

    it('evaluates permission bits on both string bitfields and PermissionsBitField instances', () => {
        const manageGuildBits = PermissionsBitField.Flags.ManageGuild.toString();
        const rawAdmin = {
            roles: [],
            permissions: manageGuildBits,
        } as unknown as APIInteractionGuildMember;
        expect(memberHasManageGuild(rawAdmin)).toBe(true);
        expect(memberHasPermission(rawAdmin, PermissionsBitField.Flags.BanMembers)).toBe(false);

        const cachedMember = {
            roles: { cache: new Collection() },
            permissions: new PermissionsBitField(PermissionsBitField.Flags.ManageGuild),
        } as unknown as GuildMember;
        expect(memberHasManageGuild(cachedMember)).toBe(true);
    });

    it('resolves role names for uncached interaction members via guild.roles.cache', () => {
        const guildRoles = new Collection<string, Role>();
        guildRoles.set('9001', { id: '9001', name: 'Poll Creator' } as Role);
        guildRoles.set('9002', { id: '9002', name: 'Member' } as Role);
        const fakeGuild = { roles: { cache: guildRoles } } as unknown as Guild;

        const rawMember = {
            roles: ['9001'],
            permissions: '0',
        } as unknown as APIInteractionGuildMember;

        expect(memberHasRoleName(fakeGuild, rawMember, 'Poll Creator')).toBe(true);
        expect(memberHasRoleName(fakeGuild, rawMember, 'Poll Manager')).toBe(false);
        expect(memberHasAnyRoleName(fakeGuild, rawMember, ['Poll Manager', 'Poll Creator'])).toBe(true);
    });
});

describe('extractMessageId', () => {
    it('extracts message snowflake from full Discord message URLs and raw IDs', () => {
        expect(extractMessageId('123456789012345678')).toBe('123456789012345678');
        expect(
            extractMessageId('https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333')
        ).toBe('333333333333333333');
        expect(
            extractMessageId('  https://ptb.discord.com/channels/@me/222222222222222222/444444444444444444 ')
        ).toBe('444444444444444444');
    });
});

describe('CSV formula injection defense', () => {
    it('prefixes dangerous leading characters (=, +, -, @, tab, CR) and escapes double quotes', () => {
        expect(neutralizeCsvFormula('=HYPERLINK("http://evil","click")')).toBe('\'=HYPERLINK("http://evil","click")');
        expect(neutralizeCsvFormula('+SUM(A1:A2)')).toBe("'+SUM(A1:A2)");
        expect(neutralizeCsvFormula('-1+2')).toBe("'-1+2");
        expect(neutralizeCsvFormula('@admin')).toBe("'@admin");
        expect(neutralizeCsvFormula('\tcmd')).toBe("'\tcmd");
        expect(neutralizeCsvFormula('Normal Option')).toBe('Normal Option');

        expect(formatCsvCell('=CMD|" /C calc"!A0')).toBe(`"'=CMD|"" /C calc""!A0"`);
        expect(formatCsvCell('Alice "The Ace"')).toBe('"Alice ""The Ace"""');
        expect(formatCsvCell('')).toBe('');
        expect(formatCsvCell(null)).toBe('');
    });
});

describe('computeChannelPermissions & canMemberPostPollInChannel', () => {
    const GUILD_ID = '100000000000000000';
    const ROLE_A = '100000000000000001';
    const ROLE_B = '100000000000000002';
    const USER_ID = '100000000000000099';

    // VIEW_CHANNEL (0x400) | SEND_MESSAGES (0x800) | EMBED_LINKS (0x4000) | ATTACH_FILES (0x8000) = 0xCC00 = 52224
    const ALL_REQUIRED = (0x400n | 0x800n | 0x4000n | 0x8000n).toString();
    const SEND_MESSAGES = (0x800n).toString();
    const ADMINISTRATOR = (0x8n).toString();

    it('grants all permissions to guild owner or ADMINISTRATOR role regardless of channel denies', () => {
        expect(
            canMemberPostPollInChannel({
                guildId: GUILD_ID,
                isGuildOwner: true,
                roles: [{ id: GUILD_ID, permissions: '0' }],
                memberRoleIds: [],
                overwrites: [{ id: GUILD_ID, type: 0, allow: '0', deny: ALL_REQUIRED }],
            })
        ).toBe(true);

        expect(
            canMemberPostPollInChannel({
                guildId: GUILD_ID,
                roles: [
                    { id: GUILD_ID, permissions: '0' },
                    { id: ROLE_A, permissions: ADMINISTRATOR },
                ],
                memberRoleIds: [ROLE_A],
                overwrites: [{ id: ROLE_A, type: 0, allow: '0', deny: ALL_REQUIRED }],
            })
        ).toBe(true);
    });

    it('applies @everyone deny -> role allow -> member overwrite in Discord hierarchy order', () => {
        // @everyone denies SEND_MESSAGES; ROLE_A denies SEND_MESSAGES; ROLE_B allows SEND_MESSAGES -> union role allow wins!
        expect(
            canMemberPostPollInChannel({
                guildId: GUILD_ID,
                memberId: USER_ID,
                roles: [
                    { id: GUILD_ID, permissions: ALL_REQUIRED },
                    { id: ROLE_A, permissions: '0' },
                    { id: ROLE_B, permissions: '0' },
                ],
                memberRoleIds: [ROLE_A, ROLE_B],
                overwrites: [
                    { id: GUILD_ID, type: 0, allow: '0', deny: SEND_MESSAGES },
                    { id: ROLE_A, type: 0, allow: '0', deny: SEND_MESSAGES },
                    { id: ROLE_B, type: 0, allow: SEND_MESSAGES, deny: '0' },
                ],
            })
        ).toBe(true);

        // Now add a member-specific deny on USER_ID -> member overwrite overrides role allow!
        const permsWithMemberDeny = computeChannelPermissions({
            guildId: GUILD_ID,
            memberId: USER_ID,
            roles: [
                { id: GUILD_ID, permissions: ALL_REQUIRED },
                { id: ROLE_B, permissions: '0' },
            ],
            memberRoleIds: [ROLE_B],
            overwrites: [
                { id: ROLE_B, type: 0, allow: SEND_MESSAGES, deny: '0' },
                { id: USER_ID, type: 1, allow: '0', deny: SEND_MESSAGES },
            ],
        });
        expect((permsWithMemberDeny & 0x800n) === 0n).toBe(true);
        expect(
            canMemberPostPollInChannel({
                guildId: GUILD_ID,
                memberId: USER_ID,
                roles: [
                    { id: GUILD_ID, permissions: ALL_REQUIRED },
                    { id: ROLE_B, permissions: '0' },
                ],
                memberRoleIds: [ROLE_B],
                overwrites: [
                    { id: ROLE_B, type: 0, allow: SEND_MESSAGES, deny: '0' },
                    { id: USER_ID, type: 1, allow: '0', deny: SEND_MESSAGES },
                ],
            })
        ).toBe(false);
    });
});
