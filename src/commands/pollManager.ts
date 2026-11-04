import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, MessageFlags, GuildMember, Colors } from 'discord.js';
import { logger } from '../lib/logger';
import { I18n } from '../lib/i18n';
import { memberHasManageGuild } from '../lib/guildUtils';

export default {
    data: new SlashCommandBuilder()
        .setName('pollmanager')
        .setDescription('Manage the Poll Manager role and assignments')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
                .setDescription('Creates the "Poll Manager" role if it does not exist')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('assign')
                .setDescription('Assign the "Poll Manager" role to a user')
                .addUserOption(option =>
                    option.setName('user').setDescription('The user to assign the role to').setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove the "Poll Manager" role from a user')
                .addUserOption(option =>
                    option.setName('user').setDescription('The user to remove the role from').setRequired(true)
                )
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.inGuild() || !interaction.guild) {
            return interaction.reply({ content: I18n.t('messages.common.guild_only', interaction.locale), flags: MessageFlags.Ephemeral });
        }

        if (!memberHasManageGuild(interaction.member)) {
            return interaction.reply({ content: I18n.t('messages.common.no_permission', interaction.locale), flags: MessageFlags.Ephemeral });
        }

        const subcommand = interaction.options.getSubcommand();
        const guild = interaction.guild;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Helper to find the role (checking cache first, then fetching roles if needed)
        const findPollManagerRole = async () => {
            const cached = guild.roles.cache.find(r => r.name === 'Poll Manager');
            if (cached) return cached;
            const roles = await guild.roles.fetch();
            return roles.find(r => r.name === 'Poll Manager');
        };

        const resolveTargetMember = async (): Promise<GuildMember | null> => {
            const memberOption = interaction.options.getMember('user');
            if (memberOption && 'roles' in memberOption && !Array.isArray(memberOption.roles)) {
                return memberOption as GuildMember;
            }
            const userOption = interaction.options.getUser('user', true);
            return guild.members.fetch(userOption.id).catch(() => null);
        };

        try {
            if (subcommand === 'create') {
                let role = await findPollManagerRole();
                if (role) {
                    return interaction.editReply({ content: I18n.t('messages.manager.role_exists', interaction.locale, { role: role.toString() }) });
                }

                role = await guild.roles.create({
                    name: 'Poll Manager',
                    color: Colors.Blue,
                    reason: 'Created via /pollmanager command for PollBot management'
                });

                logger.info(`[${interaction.guild?.name || 'Unknown Guild'} (${interaction.guild?.memberCount || '?'})] ${interaction.user.tag} executed command /pollmanager create`);
                return interaction.editReply({ content: I18n.t('messages.manager.create_success', interaction.locale, { role: role.toString() }) });
            }

            if (subcommand === 'assign') {
                const targetUser = await resolveTargetMember();
                if (!targetUser) {
                    return interaction.editReply({ content: I18n.t('messages.manager.manage_fail', interaction.locale) });
                }
                const role = await findPollManagerRole();

                if (!role) {
                    return interaction.editReply({ content: I18n.t('messages.manager.role_not_found_create', interaction.locale) });
                }

                if (targetUser.roles.cache.has(role.id)) {
                    return interaction.editReply({ content: I18n.t('messages.manager.already_has_role', interaction.locale, { user: targetUser.toString(), role: role.toString() }) });
                }

                await targetUser.roles.add(role);
                logger.info(`[${interaction.guild?.name || 'Unknown Guild'} (${interaction.guild?.memberCount || '?'})] ${interaction.user.tag} executed command /pollmanager assign with parameters "user:${targetUser.user.tag}"`);
                return interaction.editReply({ content: I18n.t('messages.manager.assigned_success', interaction.locale, { role: role.toString(), user: targetUser.toString() }) });
            }

            if (subcommand === 'remove') {
                const targetUser = await resolveTargetMember();
                if (!targetUser) {
                    return interaction.editReply({ content: I18n.t('messages.manager.manage_fail', interaction.locale) });
                }
                const role = await findPollManagerRole();

                if (!role) {
                    return interaction.editReply({ content: I18n.t('messages.manager.role_not_found', interaction.locale) });
                }

                if (!targetUser.roles.cache.has(role.id)) {
                    return interaction.editReply({ content: I18n.t('messages.manager.not_have_role', interaction.locale, { user: targetUser.toString(), role: role.toString() }) });
                }

                await targetUser.roles.remove(role);
                logger.info(`[${interaction.guild?.name || 'Unknown Guild'} (${interaction.guild?.memberCount || '?'})] ${interaction.user.tag} executed command /pollmanager remove with parameters "user:${targetUser.user.tag}"`);
                return interaction.editReply({ content: I18n.t('messages.manager.removed_success', interaction.locale, { role: role.toString(), user: targetUser.toString() }) });
            }

        } catch (error: any) {
            logger.error('Error in pollManager command:', error);

            if (error.code === 50013) { // Missing Permissions
                if (subcommand === 'create') {
                    return interaction.editReply({ content: I18n.t('messages.manager.missing_perms_create', interaction.locale) });
                }
                if (subcommand === 'assign' || subcommand === 'remove') {
                    return interaction.editReply({ content: I18n.t('messages.manager.missing_perms_manage', interaction.locale) });
                }
            }

            return interaction.editReply({ content: I18n.t('messages.manager.manage_fail', interaction.locale) });
        }
    }
};
