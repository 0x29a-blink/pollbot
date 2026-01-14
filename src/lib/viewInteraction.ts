import { ButtonInteraction, StringSelectMenuInteraction, ActionRowBuilder, ButtonBuilder, EmbedBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { supabase } from '../lib/db';
import { I18n } from '../lib/i18n';
import { logger } from '../lib/logger';

export class ViewInteractionHandler {
    static async handle(interaction: ButtonInteraction | StringSelectMenuInteraction) {
        // Parse Custom ID: view_pollId_action_page_optionIndex
        // Example: view_12345_next_1_2  (Page 1, Option 2)
        //          view_12345_select_0_2 (Select Option 2, default page 0)

        const parts = interaction.customId.split('_');
        // parts[0] = 'view'
        // parts[1] = pollId
        // parts[2] = action ('prev', 'next', 'select')
        // parts[3] = currentPage (number)
        // parts[4] = selectedOptionIndex (number, or -1 if none)

        if (parts.length < 5) return;

        const pollId = parts[1] || '';
        const action = parts[2] || '';
        let page = parseInt(parts[3] || '0');
        let selectedOption = parseInt(parts[4] || '0');

        // Handle Select Menu
        if (interaction.isStringSelectMenu()) {
            selectedOption = parseInt(interaction.values[0] || '0');
            page = 0; // Reset to first page on new selection
        } else {
            // Handle Buttons
            if (action === 'prev') page = Math.max(0, page - 1);
            if (action === 'next') page++;
            if (action === 'first') page = 0;
            if (action === 'export') {
                const { data: allVoters, error: exportError } = await supabase
                    .from('votes')
                    .select('user_id')
                    .eq('poll_id', pollId)
                    .eq('option_index', selectedOption);

                if (exportError || !allVoters) {
                    await interaction.followUp({ content: I18n.t('messages.common.generic_error', interaction.locale), ephemeral: true });
                    return;
                }

                // Fetch Option Name for filename
                const { data: pollData } = await supabase
                    .from('polls')
                    .select('options')
                    .eq('message_id', pollId)
                    .single();

                const fallbackName = I18n.t('view.option_generic', interaction.locale, { index: (selectedOption + 1).toString() });
                const optName = pollData?.options ? (pollData.options as string[])[selectedOption] : fallbackName;
                const safeOptName = optName || fallbackName;
                const cleanOptName = safeOptName.replace(/[^a-z0-9]/gi, '_').substring(0, 30);

                // Format content
                let fileContent = I18n.t('view.export_content', interaction.locale, { option: safeOptName });

                // Fetch members to get nicknames (Optional, might be slow for thousands)
                // For "Premium" feel, maybe we try? But for stability, IDs are safest.
                // Let's just list User IDs for now as per "simple text file", but user asked for "userid, username, display name, nickname".
                // We need to fetch from Discord.

                try {
                    const guild = interaction.guild;
                    if (guild) {
                        // Max fetch is limited usually? 
                        // For large polls, this might timeout.
                        // Let's fetch in chunks or just fetch the ones we have?
                        // Actually, guild.members.fetch({ user: ids }) works well.
                        const userIds = allVoters.map(v => v.user_id);
                        // Split into chunks of 100 if needed? Discord.js handles it?
                        // Let's do it safely.
                        await interaction.deferReply({ ephemeral: true }); // We follow up

                        const members = await guild.members.fetch({ user: userIds });

                        allVoters.forEach(v => {
                            const member = members.get(v.user_id);
                            const username = member?.user.username || I18n.t('messages.manager.unknown_user', interaction.locale);
                            const displayName = member?.user.displayName || I18n.t('messages.manager.unknown_user', interaction.locale);
                            const nickname = member?.nickname || I18n.t('messages.common.none', interaction.locale);
                            fileContent += `${v.user_id} | ${username} | ${displayName} | ${nickname}\n`;
                        });

                        const buffer = Buffer.from(fileContent, 'utf-8');
                        const attachment = { attachment: buffer, name: `voters_${cleanOptName}.txt` };

                        await interaction.editReply({ files: [attachment] });
                        return; // Done with export interaction
                    }
                } catch (e) {
                    logger.error("Export fetch failed", e);
                    await interaction.followUp({ content: I18n.t('view.export_fail', interaction.locale), ephemeral: true });
                }
                return;
            }
        }

        try {
            await interaction.deferUpdate();
        } catch (error: any) {
            if (error.code === 10062 || error.code === 40060) { // Unknown interaction or already acknowledged
                logger.warn('ViewInteractionHandler: Interaction already handled or expired');
                return;
            }
            throw error;
        }

        // Fetch Data
        const pageSize = 15; // Match with embed limit
        const start = page * pageSize;
        const end = start + pageSize - 1;

        // Fetch Voters (Paginated)
        // Note: option_index column in votes table
        const { data: voters, error, count } = await supabase
            .from('votes')
            .select('user_id', { count: 'exact' })
            .eq('poll_id', pollId)
            .eq('option_index', selectedOption)
            .range(start, end);

        if (error) {
            logger.error('View Interaction Error:', error);
            await interaction.followUp({ content: I18n.t('messages.common.generic_error', interaction.locale), ephemeral: true });
            return;
        }

        const totalVotes = count || 0;
        const totalPages = Math.ceil(totalVotes / pageSize);
        // Correct page if out of bounds (shouldn't happen with correct button logic but safe to check)
        if (page >= totalPages && totalPages > 0) page = totalPages - 1;


        // Get Poll Data for Option Name
        const { data: poll } = await supabase
            .from('polls')
            .select('options')
            .eq('message_id', pollId)
            .single();

        const optionName = poll?.options ? (poll.options as string[])[selectedOption] : I18n.t('view.option_generic', interaction.locale, { index: (selectedOption + 1).toString() });

        // Build Embed
        const embed = new EmbedBuilder()
            .setTitle(I18n.t('view.voter_list_title', interaction.locale, { index: (selectedOption + 1).toString(), option: optionName }))
            .setColor('#5865F2');

        if (voters && voters.length > 0) {
            const list = voters.map(v => `<@${v.user_id}>`).join('\n');
            embed.setDescription(list);
            embed.setFooter({ text: I18n.t('view.page_indicator', interaction.locale, { current: (page + 1).toString(), total: totalPages.toString() }) });
        } else {
            embed.setDescription(I18n.t('view.no_votes', interaction.locale));
            embed.setFooter({ text: I18n.t('view.page_indicator', interaction.locale, { current: '1', total: '1' }) });
        }

        // Rebuild Buttons
        // We reuse the existing select menu from the message?
        // Actually, we should probably just update the buttons row and keep the select menu as is.
        // BUT, we need to regenerate components to update the state in the customIDs.

        // Retrieve existing select menu (Row 0)
        // We assume Row 0 is Select Menu, Row 1 is Buttons (if exists)
        // Need to cast correctly or cleaner check
        const oldComponents = interaction.message.components;
        const selectMenuRow = oldComponents[0] as any; // Cast to avoid strict type checks on API components vs Builders

        // Build Button Row
        const buttonRow = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`view_${pollId}_first_${page}_${selectedOption}`)
                    .setLabel('«')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === 0),
                new ButtonBuilder()
                    .setCustomId(`view_${pollId}_prev_${page}_${selectedOption}`)
                    .setLabel(I18n.t('view.nav_prev', interaction.locale))
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page === 0),
                new ButtonBuilder()
                    // New Export Button in middle
                    .setCustomId(`view_${pollId}_export_${page}_${selectedOption}`)
                    .setLabel(I18n.t('view.export_btn', interaction.locale))
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('📂'),
                new ButtonBuilder()
                    .setCustomId(`view_${pollId}_next_${page}_${selectedOption}`)
                    .setLabel(I18n.t('view.nav_next', interaction.locale))
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page >= totalPages - 1),
                new ButtonBuilder()
                    .setCustomId(`view_${pollId}_last_${totalPages - 1}_${selectedOption}`)
                    .setLabel('»')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page >= totalPages - 1)
            );

        await interaction.editReply({
            embeds: [embed],
            components: [selectMenuRow, buttonRow]
        });
    }
}
