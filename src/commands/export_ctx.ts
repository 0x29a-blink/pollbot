import { ContextMenuCommandBuilder, ApplicationCommandType, MessageContextMenuCommandInteraction, AttachmentBuilder, MessageFlags, PermissionsBitField, GuildMember } from 'discord.js';
import { ExportManager } from '../lib/exportManager';
import { I18n } from '../lib/i18n';
import { logger } from '../lib/logger';
import { supabase } from '../lib/db';

export default {
    data: new ContextMenuCommandBuilder()
        .setName('Export Results')
        .setType(ApplicationCommandType.Message),
    async execute(interaction: MessageContextMenuCommandInteraction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: I18n.t('messages.common.guild_only', interaction.locale), flags: MessageFlags.Ephemeral });
        }

        const pollId = interaction.targetId;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            // Check Permissions
            const { data: poll } = await supabase
                .from('polls')
                .select('settings, creator_id')
                .eq('message_id', pollId)
                .single();

            if (poll) {
                const settings = poll.settings as any || {};
                const allowExports = settings.allow_exports !== false;
                const isPublic = settings.public !== false;

                if (!allowExports || !isPublic) {
                    const member = interaction.member as GuildMember;
                    const hasRole = member.roles.cache.some(r => r.name === 'Poll Manager');
                    const hasPermission = member.permissions.has(PermissionsBitField.Flags.ManageGuild);
                    const isCreator = poll.creator_id === interaction.user.id;

                    if (!isCreator && !hasRole && !hasPermission) {
                        return interaction.editReply({
                            content: I18n.t('view.export_restricted', interaction.locale)
                        });
                    }
                }
            }

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
            logger.info(`[${interaction.guild?.name || 'Unknown Guild'} (${interaction.guild?.memberCount || '?'})] ${interaction.user.tag} executed Context Menu "Export Results" on message ${pollId}`);

        } catch (error) {
            logger.error(`Export command failed: ${error}`);
            await interaction.editReply({
                content: I18n.t('messages.common.generic_error', interaction.locale)
            });
        }
    }
};
