import { SlashCommandBuilder, ChatInputCommandInteraction, AttachmentBuilder, MessageFlags } from 'discord.js';
import { ExportManager } from '../lib/exportManager';
import { I18n } from '../lib/i18n';
import { logger } from '../lib/logger';

export default {
    data: new SlashCommandBuilder()
        .setName('export-poll')
        .setDescription('Export voting results for a specific poll')
        .addStringOption(option =>
            option.setName('message_id')
                .setDescription('The Message ID of the poll')
                .setRequired(true)
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: I18n.t('messages.common.guild_only', interaction.locale), flags: MessageFlags.Ephemeral });
        }

        const pollInput = interaction.options.getString('message_id', true);

        // Extract Message ID
        // Supports raw ID or https://discord.com/channels/GUILD/CHANNEL/MESSAGE_ID
        let pollId = pollInput;
        const match = pollInput.match(/channels\/\d+\/\d+\/(\d+)/);
        if (match && match[1]) {
            pollId = match[1];
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const csvData = await ExportManager.generateCsv(pollId, interaction.guild!, interaction.locale);

            if (!csvData) {
                return interaction.editReply({
                    content: I18n.t('messages.export.not_found', interaction.locale)
                });
            }

            const buffer = Buffer.from(csvData, 'utf-8');
            const attachment = new AttachmentBuilder(buffer, { name: `poll_results_${pollId}.csv` });

            await interaction.editReply({
                content: I18n.t('messages.export.success', interaction.locale),
                files: [attachment]
            });

        } catch (error) {
            logger.error(`Export command failed: ${error}`);
            await interaction.editReply({
                content: I18n.t('messages.common.generic_error', interaction.locale)
            });
        }
    }
};
