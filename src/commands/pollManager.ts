import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionsBitField, PermissionFlagsBits, MessageFlags, GuildMember, Role, Colors } from 'discord.js';
import { logger } from '../lib/logger';
import { I18n } from '../lib/i18n';

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
        if (!interaction.inGuild()) {
            return interaction.reply({ content: I18n.t('messages.common.guild_only', interaction.locale), flags: MessageFlags.Ephemeral });
        }

        const subcommand = interaction.options.getSubcommand();
        const guild = interaction.guild!;

        // Helper to find the role
        const findPollManagerRole = () => {
            return guild.roles.cache.find(r => r.name === 'Poll Manager');
        };

        try {
            if (subcommand === 'create') {
                let role = findPollManagerRole();
                if (role) {
                    return interaction.reply({ content: I18n.t('messages.manager.role_exists', interaction.locale, { role: role.toString() }), flags: MessageFlags.Ephemeral });
                }

                role = await guild.roles.create({
                    name: 'Poll Manager',
                    color: Colors.Blue,
                    reason: 'Created via /pollManager command for PollBot management'
                });

                logger.info(`[${interaction.guild?.name || 'Unknown Guild'} (${interaction.guild?.memberCount || '?'})] ${interaction.user.tag} executed command /pollmanager create`);
                return interaction.reply({ content: I18n.t('messages.manager.create_success', interaction.locale, { role: role.toString() }), flags: MessageFlags.Ephemeral });
            }

            if (subcommand === 'assign') {
                const targetUser = interaction.options.getMember('user') as GuildMember;
                const role = findPollManagerRole();

                if (!role) {
                    return interaction.reply({ content: I18n.t('messages.manager.role_not_found_create', interaction.locale), flags: MessageFlags.Ephemeral });
                }

                if (targetUser.roles.cache.has(role.id)) {
                    return interaction.reply({ content: I18n.t('messages.manager.already_has_role', interaction.locale, { user: targetUser.toString(), role: role.toString() }), flags: MessageFlags.Ephemeral });
                }

                await targetUser.roles.add(role);
                logger.info(`[${interaction.guild?.name || 'Unknown Guild'} (${interaction.guild?.memberCount || '?'})] ${interaction.user.tag} executed command /pollmanager assign with parameters "user:${targetUser.user.tag}"`);
                return interaction.reply({ content: I18n.t('messages.manager.assigned_success', interaction.locale, { role: role.toString(), user: targetUser.toString() }), flags: MessageFlags.Ephemeral });
            }

            if (subcommand === 'remove') {
                const targetUser = interaction.options.getMember('user') as GuildMember;
                const role = findPollManagerRole();

                if (!role) {
                    return interaction.reply({ content: I18n.t('messages.manager.role_not_found', interaction.locale), flags: MessageFlags.Ephemeral });
                }

                if (!targetUser.roles.cache.has(role.id)) {
                    return interaction.reply({ content: I18n.t('messages.manager.not_have_role', interaction.locale, { user: targetUser.toString(), role: role.toString() }), flags: MessageFlags.Ephemeral });
                }

                await targetUser.roles.remove(role);
                logger.info(`[${interaction.guild?.name || 'Unknown Guild'} (${interaction.guild?.memberCount || '?'})] ${interaction.user.tag} executed command /pollmanager remove with parameters "user:${targetUser.user.tag}"`);
                return interaction.reply({ content: I18n.t('messages.manager.removed_success', interaction.locale, { role: role.toString(), user: targetUser.toString() }), flags: MessageFlags.Ephemeral });
            }

        } catch (error: any) {
            console.error('Error in pollManager command:', error);

            if (error.code === 50013) { // Missing Permissions
                if (subcommand === 'create') {
                    return interaction.reply({ content: I18n.t('messages.manager.missing_perms_create', interaction.locale), flags: MessageFlags.Ephemeral });
                }
                if (subcommand === 'assign' || subcommand === 'remove') {
                    return interaction.reply({ content: I18n.t('messages.manager.missing_perms_manage', interaction.locale), flags: MessageFlags.Ephemeral });
                }
            }

            return interaction.reply({ content: I18n.t('messages.manager.manage_fail', interaction.locale), flags: MessageFlags.Ephemeral });
        }
    }
};
