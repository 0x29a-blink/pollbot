import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, StringSelectMenuBuilder, MessageFlags, ButtonInteraction, MessageContextMenuCommandInteraction } from 'discord.js';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';
import { I18n } from '../lib/i18n';
import { Renderer } from '../lib/renderer';
import { ViewInteractionHandler } from '../lib/viewInteraction';
import { aggregateVotes } from '../lib/voteUtils';
import { extractMessageId, memberHasManageGuild, memberHasRoleName } from '../lib/guildUtils';
import { computePremiumWindow, DASHBOARD_URL, DISCORDFORGE_VOTE_URL, TOPGG_VOTE_URL } from '../lib/botListVotes';

export const data = new SlashCommandBuilder()
    .setName('view')
    .setDescription('View detailed poll results (Premium Feature)')
    .addStringOption(option =>
        option.setName('poll_id')
            .setDescription('The ID or Message Link of the poll to view')
            .setRequired(true)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    const pollInput = interaction.options.getString('poll_id', true);
    await handleViewPoll(interaction, pollInput);
}

export async function handleViewPoll(
    interaction: ChatInputCommandInteraction | ButtonInteraction | MessageContextMenuCommandInteraction,
    rawPollId: string
) {
    if (!interaction.inGuild()) {
        return interaction.reply({
            content: I18n.t('messages.common.guild_only', interaction.locale),
            flags: MessageFlags.Ephemeral,
        });
    }

    const pollId = extractMessageId(rawPollId);
    if (!/^\d+$/.test(pollId)) {
        return interaction.reply({
            content: I18n.t('messages.manager.invalid_id', interaction.locale),
            flags: MessageFlags.Ephemeral,
        });
    }

    const userId = interaction.user.id;

    // Acknowledge immediately: everything below performs several DB queries and a
    // canvas render that can easily exceed Discord's 3-second reply window.
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    // 1. Check Premium Status (supports stacked vote windows from Top.gg + DiscordForge)
    let { data: userData, error: userErr } = await supabase
        .from('users')
        .select('last_vote_at, premium_expires_at')
        .eq('id', userId)
        .maybeSingle();

    // Pre-migration-32 schema fallback if premium_expires_at column is absent
    if (userErr && (userErr.code === 'PGRST204' || userErr.code === '42703')) {
        const fallback = await supabase
            .from('users')
            .select('last_vote_at')
            .eq('id', userId)
            .maybeSingle();
        userData = fallback.data as any;
    }

    const { isPremium } = computePremiumWindow(userData);

    if (!isPremium) {
        const embed = new EmbedBuilder()
            .setTitle(I18n.t('view.premium_title', interaction.locale))
            .setDescription(I18n.t('view.premium_desc', interaction.locale))
            .setColor('#FFD700'); // Gold

        // Prioritize Top.gg first, allow stacking +12h via DiscordForge, and surface the Web Dashboard
        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setLabel(I18n.t('view.vote_unlock', interaction.locale))
                    .setStyle(ButtonStyle.Link)
                    .setURL(TOPGG_VOTE_URL),
                new ButtonBuilder()
                    .setLabel(I18n.t('view.vote_forge_unlock', interaction.locale))
                    .setStyle(ButtonStyle.Link)
                    .setURL(DISCORDFORGE_VOTE_URL),
                new ButtonBuilder()
                    .setCustomId(`check_vote_${pollId}`)
                    .setLabel(I18n.t('view.i_voted', interaction.locale))
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setLabel(I18n.t('view.dashboard_btn', interaction.locale))
                    .setStyle(ButtonStyle.Link)
                    .setURL(DASHBOARD_URL)
            );

        await interaction.editReply({
            embeds: [embed],
            components: [row],
        });
        return;
    }

    // 2. Fetch Poll Data (scoped to the interaction's guild to prevent cross-server IDOR)
    const { data: poll, error: pollError } = await supabase
        .from('polls')
        .select('*')
        .eq('message_id', pollId)
        .eq('guild_id', interaction.guildId)
        .single();

    if (pollError || !poll) {
        // Only remove buttons if this came directly from the poll card's view_details button
        if (interaction.isButton() && (interaction.customId === 'view_details' || interaction.customId === 'poll_view_details')) {
            try {
                await interaction.message.edit({ components: [] });
            } catch (error) {
                logger.error('Failed to remove buttons from orphaned poll:', error);
            }
        }
        await interaction.editReply({ content: I18n.t('messages.manager.poll_not_found', interaction.locale) });
        return;
    }

    // 2a. Check allow_exports / public permissions
    const settings = (poll.settings as any) || {};
    const allowExports = settings.allow_exports !== false; // Default true
    const isPublic = settings.public !== false; // Default true

    if (!allowExports || !isPublic) {
        const hasRole = memberHasRoleName(interaction.guild, interaction.member, 'Poll Manager');
        const hasPermission = memberHasManageGuild(interaction.member);
        const isCreator = poll.creator_id === interaction.user.id;

        if (!isCreator && !hasRole && !hasPermission) {
            await interaction.editReply({ content: I18n.t('view.export_restricted', interaction.locale) });
            return;
        }
    }

    // 3. Aggregate Votes (weighted — consistent with the live poll image)
    const options = poll.options as string[];
    const voteData = await aggregateVotes(pollId, options.length);

    if (voteData.error) {
        await interaction.editReply({ content: I18n.t('messages.common.generic_error', interaction.locale) });
        return;
    }

    const voteCounts = voteData.counts;

    try {
        // 5. Generate Dashboard Image
        const imageBuffer = await Renderer.renderDetailedView({
            title: poll.title,
            description: poll.description,
            options: options,
            votes: voteCounts,
            totalVotes: voteData.totalWeight,
            creator: (await interaction.client.users.fetch(poll.creator_id).catch(() => ({ username: I18n.t('messages.manager.unknown_user', interaction.locale) }))).username,
            locale: interaction.locale,
            closed: !poll.active
        });

        const attachment = new AttachmentBuilder(imageBuffer, { name: 'results.png' });

        // 6. Build Interactive Components
        const embed = new EmbedBuilder()
            .setTitle(I18n.t('view.title', interaction.locale, { title: poll.title }).slice(0, 256))
            .setDescription(I18n.t('view.description', interaction.locale))
            .setColor('#2b2d31')
            .setImage('attachment://results.png');

        // Select Menu for filtering
        const selectOptions = options.map((opt, i) => ({
            label: opt.substring(0, 100),
            value: i.toString()
        }));

        const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`view_${pollId}_select_0_0`) // Default: Page 0, Option 0 (or we could use -1 to force selection)
                    .setPlaceholder(I18n.t('view.option_default', interaction.locale))
                    .addOptions(selectOptions as any)
            );

        // Buttons (Disabled initially until option selected? Or default to Option 1?)
        // Let's default to Option 1 (Index 0) being "selected" in the interaction handler context, 
        // but maybe just show the list for Option 1 immediately?
        // Current 'view_interaction' expects a selected option.
        // Let's default to no Buttons, just the Select Menu. 
        // OR: Show the list for "All"? My plan said "Paginated + Filter by Option".
        // Let's keep it simple: Select option -> Show list. 

        const message = await interaction.editReply({
            embeds: [embed],
            files: [attachment],
            components: [selectRow]
        });

        // Initialize Collector for this ephemeral message
        // This connects the interactive components to our handler
        const filter = (i: any) => i.customId.startsWith(`view_${pollId}`);
        const collector = message.createMessageComponentCollector({ filter, time: 900000 }); // 15 mins

        collector.on('collect', async (i: any) => {
            await ViewInteractionHandler.handle(i);
        });

    } catch (error) {
        logger.error('Failed to render view:', error);
        await interaction.editReply({ content: I18n.t('messages.common.generic_error', interaction.locale) });
    }
}
