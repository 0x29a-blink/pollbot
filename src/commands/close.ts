import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionsBitField, MessageFlags, GuildMember } from 'discord.js';
import { PollManager } from '../lib/pollManager';

export default {
    data: new SlashCommandBuilder()
        .setName('close')
        .setDescription('Close an active poll')
        .addStringOption(option =>
            option.setName('poll')
                .setDescription('Message Link or ID of the poll')
                .setRequired(true)
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
        }

        const pollInput = interaction.options.getString('poll', true);

        // Extract Message ID
        // Supports raw ID or https://discord.com/channels/GUILD/CHANNEL/MESSAGE_ID
        let pollId = pollInput;
        const match = pollInput.match(/channels\/\d+\/\d+\/(\d+)/);
        if (match && match[1]) {
            pollId = match[1];
        }

        // Validate ID format (simple check)
        if (!/^\d+$/.test(pollId)) {
            return interaction.reply({ content: 'Invalid poll ID or link provided.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        await PollManager.setPollStatus(interaction, pollId, false);
    }
};
