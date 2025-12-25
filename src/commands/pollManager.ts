import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionsBitField, PermissionFlagsBits, MessageFlags, GuildMember, Role, Colors } from 'discord.js';
import { logger } from '../lib/logger';

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
            return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
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
                    return interaction.reply({ content: `The role ${role.toString()} already exists.`, flags: MessageFlags.Ephemeral });
                }

                role = await guild.roles.create({
                    name: 'Poll Manager',
                    color: Colors.Blue,
                    reason: 'Created via /pollManager command for PollBot management'
                });

                logger.info(`[${interaction.guild?.name || 'Unknown Guild'} (${interaction.guild?.memberCount || '?'})] ${interaction.user.tag} executed command /pollmanager create`);
                return interaction.reply({ content: `Successfully created the ${role.toString()} role.`, flags: MessageFlags.Ephemeral });
            }

            if (subcommand === 'assign') {
                const targetUser = interaction.options.getMember('user') as GuildMember;
                const role = findPollManagerRole();

                if (!role) {
                    return interaction.reply({ content: 'The "Poll Manager" role does not exist. Please run `/pollmanager create` first.', flags: MessageFlags.Ephemeral });
                }

                if (targetUser.roles.cache.has(role.id)) {
                    return interaction.reply({ content: `${targetUser.toString()} already has the ${role.toString()} role.`, flags: MessageFlags.Ephemeral });
                }

                await targetUser.roles.add(role);
                logger.info(`[${interaction.guild?.name || 'Unknown Guild'} (${interaction.guild?.memberCount || '?'})] ${interaction.user.tag} executed command /pollmanager assign with parameters "user:${targetUser.user.tag}"`);
                return interaction.reply({ content: `Assigned ${role.toString()} role to ${targetUser.toString()}.`, flags: MessageFlags.Ephemeral });
            }

            if (subcommand === 'remove') {
                const targetUser = interaction.options.getMember('user') as GuildMember;
                const role = findPollManagerRole();

                if (!role) {
                    return interaction.reply({ content: 'The "Poll Manager" role does not exist.', flags: MessageFlags.Ephemeral });
                }

                if (!targetUser.roles.cache.has(role.id)) {
                    return interaction.reply({ content: `${targetUser.toString()} does not have the ${role.toString()} role.`, flags: MessageFlags.Ephemeral });
                }

                await targetUser.roles.remove(role);
                logger.info(`[${interaction.guild?.name || 'Unknown Guild'} (${interaction.guild?.memberCount || '?'})] ${interaction.user.tag} executed command /pollmanager remove with parameters "user:${targetUser.user.tag}"`);
                return interaction.reply({ content: `Removed ${role.toString()} role from ${targetUser.toString()}.`, flags: MessageFlags.Ephemeral });
            }

        } catch (error: any) {
            console.error('Error in pollManager command:', error);

            if (error.code === 50013) { // Missing Permissions
                if (subcommand === 'create') {
                    return interaction.reply({ content: 'I am missing permissions to create roles! Please ensure I have the "Manage Roles" permission.', flags: MessageFlags.Ephemeral });
                }
                if (subcommand === 'assign' || subcommand === 'remove') {
                    return interaction.reply({ content: 'I am missing permissions to manage this user\'s roles! Please ensure I have the "Manage Roles" permission and that my highest role is above the "Poll Manager" role.', flags: MessageFlags.Ephemeral });
                }
            }

            return interaction.reply({ content: 'An error occurred while managing the Poll Manager role.', flags: MessageFlags.Ephemeral });
        }
    }
};
