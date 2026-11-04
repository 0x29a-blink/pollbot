import { ButtonInteraction, StringSelectMenuInteraction, ActionRowBuilder, ButtonBuilder, EmbedBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { supabase } from '../lib/db';
import { I18n } from '../lib/i18n';
import { logger } from '../lib/logger';
import { fetchMembersChunked, memberHasManageGuild, memberHasRoleName } from '../lib/guildUtils';
import { fetchAllPollVotes } from '../lib/voteUtils';

export class ViewInteractionHandler {
    static async handle(interaction: ButtonInteraction | StringSelectMenuInteraction) {
        if (!interaction.inGuild() || !interaction.guild) return;

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
        let page = parseInt(parts[3] || '0', 10);
        let selectedOption = parseInt(parts[4] || '0', 10);
        if (Number.isNaN(page)) page = 0;
        if (Number.isNaN(selectedOption)) selectedOption = 0;

        // Handle Select Menu
        if (interaction.isStringSelectMenu()) {
            selectedOption = parseInt(interaction.values[0] || '0', 10);
            if (Number.isNaN(selectedOption)) selectedOption = 0;
            page = 0; // Reset to first page on new selection
        } else {
            // Handle Buttons
            if (action === 'prev') page = Math.max(0, page - 1);
            if (action === 'next') page++;
            if (action === 'first') page = 0;
            if (action === 'export') {
                try {
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                    // Verify poll belongs to this guild & caller has export permission
                    const { data: pollData, error: pollError } = await supabase
                        .from('polls')
                        .select('guild_id, options, settings, creator_id')
                        .eq('message_id', pollId)
                        .eq('guild_id', interaction.guildId)
                        .maybeSingle();

                    if (pollError || !pollData) {
                        await interaction.editReply({ content: I18n.t('messages.manager.poll_not_found', interaction.locale) });
                        return;
                    }

                    const settings = (pollData.settings as Record<string, any>) || {};
                    const allowExports = settings.allow_exports !== false;
                    const isPublic = settings.public !== false;
                    if (!allowExports || !isPublic) {
                        const isCreator = pollData.creator_id === interaction.user.id;
                        const hasRole = memberHasRoleName(interaction.guild, interaction.member, 'Poll Manager');
                        const hasPermission = memberHasManageGuild(interaction.member);
                        if (!isCreator && !hasRole && !hasPermission) {
                            await interaction.editReply({ content: I18n.t('view.export_restricted', interaction.locale) });
                            return;
                        }
                    }

                    const options = (pollData.options as string[]) || [];
                    if (selectedOption < 0 || selectedOption >= options.length) {
                        await interaction.editReply({ content: I18n.t('messages.poll.invalid_selection', interaction.locale) });
                        return;
                    }

                    const { data: allVoters, error: exportError } = await fetchAllPollVotes(pollId, {
                        optionIndex: selectedOption,
                    });

                    if (exportError || !allVoters) {
                        await interaction.editReply({ content: I18n.t('messages.common.generic_error', interaction.locale) });
                        return;
                    }

                    const fallbackName = I18n.t('view.option_generic', interaction.locale, { index: (selectedOption + 1).toString() });
                    const optName = options[selectedOption] || fallbackName;
                    const cleanOptName = optName.replace(/[^a-z0-9]/gi, '_').substring(0, 30) || `opt_${selectedOption + 1}`;

                    let fileContent = I18n.t('view.export_content', interaction.locale, { option: optName });

                    const userIds = allVoters.map(v => v.user_id);
                    const members = await fetchMembersChunked(interaction.guild, userIds);
                    const cleanField = (val: string) => val.replace(/[\r\n|]+/g, ' ').trim();

                    allVoters.forEach(v => {
                        const member = members.get(v.user_id);
                        const username = cleanField(member?.user.username || I18n.t('messages.manager.unknown_user', interaction.locale));
                        const displayName = cleanField(member?.user.displayName || I18n.t('messages.manager.unknown_user', interaction.locale));
                        const nickname = cleanField(member?.nickname || I18n.t('messages.common.none', interaction.locale));
                        fileContent += `${v.user_id} | ${username} | ${displayName} | ${nickname}\n`;
                    });

                    const buffer = Buffer.from(fileContent, 'utf-8');
                    const attachment = { attachment: buffer, name: `voters_${cleanOptName}.txt` };

                    await interaction.editReply({ files: [attachment] });
                } catch (e) {
                    logger.error('Export fetch failed', e);
                    try {
                        if (interaction.deferred || interaction.replied) {
                            await interaction.editReply({ content: I18n.t('view.export_fail', interaction.locale) });
                        } else {
                            await interaction.reply({ content: I18n.t('view.export_fail', interaction.locale), flags: MessageFlags.Ephemeral });
                        }
                    } catch { /* ignore */ }
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

        // Verify Poll belongs to this guild & fetch options
        const { data: poll } = await supabase
            .from('polls')
            .select('guild_id, options, settings, creator_id')
            .eq('message_id', pollId)
            .eq('guild_id', interaction.guildId)
            .maybeSingle();

        if (!poll) {
            await interaction.followUp({ content: I18n.t('messages.manager.poll_not_found', interaction.locale), flags: MessageFlags.Ephemeral });
            return;
        }

        const settings = (poll.settings as Record<string, any>) || {};
        if (settings.allow_exports === false || settings.public === false) {
            const isCreator = poll.creator_id === interaction.user.id;
            const hasRole = memberHasRoleName(interaction.guild, interaction.member, 'Poll Manager');
            const hasPermission = memberHasManageGuild(interaction.member);
            if (!isCreator && !hasRole && !hasPermission) {
                await interaction.followUp({ content: I18n.t('view.export_restricted', interaction.locale), flags: MessageFlags.Ephemeral });
                return;
            }
        }

        // Fetch Data
        const pageSize = 15; // Match with embed limit

        // Determine the true page count FIRST, then clamp an out-of-range page
        // before fetching. Previously the range was fetched and the page clamped
        // afterwards with no refetch, so a "next" click past the last page (or a
        // stale button) returned an empty voter list with a mismatched footer.
        const { count } = await supabase
            .from('votes')
            .select('user_id', { count: 'exact', head: true })
            .eq('poll_id', pollId)
            .eq('option_index', selectedOption);

        const totalVotes = count || 0;
        const totalPages = Math.ceil(totalVotes / pageSize);
        if (totalPages > 0 && page >= totalPages) page = totalPages - 1;
        if (page < 0) page = 0;

        const start = page * pageSize;
        const end = start + pageSize - 1;

        // Fetch Voters (Paginated with deterministic ordering)
        const { data: voters, error } = await supabase
            .from('votes')
            .select('user_id')
            .eq('poll_id', pollId)
            .eq('option_index', selectedOption)
            .order('created_at', { ascending: true })
            .order('user_id', { ascending: true })
            .range(start, end);

        if (error) {
            logger.error('View Interaction Error:', error);
            await interaction.followUp({ content: I18n.t('messages.common.generic_error', interaction.locale), flags: MessageFlags.Ephemeral });
            return;
        }

        const optionName = poll.options ? (poll.options as string[])[selectedOption] : I18n.t('view.option_generic', interaction.locale, { index: (selectedOption + 1).toString() });
        const rawTitle = I18n.t('view.voter_list_title', interaction.locale, { index: (selectedOption + 1).toString(), option: optionName });

        // Build Embed
        const embed = new EmbedBuilder()
            .setTitle(rawTitle.slice(0, 256))
            .setColor('#5865F2');

        if (voters && voters.length > 0) {
            const list = voters.map(v => `<@${v.user_id}>`).join('\n');
            embed.setDescription(list);
            embed.setFooter({ text: I18n.t('view.page_indicator', interaction.locale, { current: (page + 1).toString(), total: totalPages.toString() }) });
        } else {
            embed.setDescription(I18n.t('view.no_votes', interaction.locale));
            embed.setFooter({ text: I18n.t('view.page_indicator', interaction.locale, { current: '1', total: '1' }) });
        }

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
