import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { PollManager } from '../lib/pollManager';
import { I18n } from '../lib/i18n';
import { logger } from '../lib/logger';
import { extractMessageId } from '../lib/guildUtils';

export default {
    data: new SlashCommandBuilder()
        .setName('reopen')
        .setDescription('Reopen a closed poll')
        .addStringOption(option =>
            option.setName('poll')
                .setDescription('Message Link or ID of the poll')
                .setRequired(true)
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: I18n.t('messages.common.guild_only', interaction.locale), flags: MessageFlags.Ephemeral });
        }

        const pollInput = interaction.options.getString('poll', true);
        const pollId = extractMessageId(pollInput);

        if (!/^\d+$/.test(pollId)) {
            return interaction.reply({ content: I18n.t('messages.manager.invalid_id', interaction.locale), flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        await PollManager.setPollStatus(interaction, pollId, true);
        logger.info(`[${interaction.guild?.name || 'Unknown Guild'} (${interaction.guild?.memberCount || '?'})] ${interaction.user.tag} executed command /reopen with parameters "poll:${pollId}"`);
    }
};
