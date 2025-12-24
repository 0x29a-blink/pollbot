import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionsBitField, MessageFlags, GuildMember } from 'discord.js';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';

export default {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configure Poll Bot settings for this server')
        .addSubcommand(subcommand =>
            subcommand
                .setName('poll-buttons')
                .setDescription('Enable or disable poll buttons (Close/Reopen)')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('Whether to enable poll buttons')
                        .setRequired(true)
                )
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        }

        const member = interaction.member as GuildMember;
        if (!member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({ content: 'You need the "Manage Server" permission to use this command.', flags: MessageFlags.Ephemeral });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'poll-buttons') {
            const enabled = interaction.options.getBoolean('enabled', true);
            const guildId = interaction.guildId!;

            const { error } = await supabase
                .from('guild_settings')
                .upsert({
                    guild_id: guildId,
                    allow_poll_buttons: enabled,
                    updated_at: new Date().toISOString()
                });

            if (error) {
                logger.error('Failed to update guild settings:', error);
                return interaction.reply({ content: 'Failed to update settings.', flags: MessageFlags.Ephemeral });
            }

            await interaction.reply({
                content: `Poll buttons have been **${enabled ? 'ENABLED' : 'DISABLED'}** for this server.`,
                flags: MessageFlags.Ephemeral // Using Ephemeral to reduce clutter, or could be public to announce change
            });
        }
    }
};
