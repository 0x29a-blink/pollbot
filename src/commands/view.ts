import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, AttachmentBuilder, StringSelectMenuBuilder, PermissionsBitField, GuildMember } from 'discord.js';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';
import { I18n } from '../lib/i18n';
import { Renderer } from '../lib/renderer';
import { ViewInteractionHandler } from '../lib/viewInteraction';

export const data = new SlashCommandBuilder()
    .setName('view')
    .setDescription('View detailed poll results (Premium Feature)')
    .addStringOption(option =>
        option.setName('poll_id')
            .setDescription('The ID of the poll (message ID) to view')
            .setRequired(true)
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    const pollId = interaction.options.getString('poll_id', true);
    await handleViewPoll(interaction, pollId);
}

export async function handleViewPoll(interaction: ChatInputCommandInteraction | any, pollId: string) {
    const userId = interaction.user.id;

    // 1. Check Premium Status (Voted in last 12 hours)
    const { data: userData, error: userError } = await supabase
        .from('users')
        .select('last_vote_at')
        .eq('id', userId)
        .single();

    const now = new Date();
    // Default to a date far in the past if no record found
    const lastVote = userData?.last_vote_at ? new Date(userData.last_vote_at) : new Date(0);
    const twelveHoursAgo = new Date(now.getTime() - 13 * 60 * 60 * 1000); // We make it 13 hours to give the user some buffer.

    // For local testing, you might want to bypass or mock this
    const isPremium = lastVote > twelveHoursAgo;

    if (!isPremium) {
        const voteUrl = 'https://top.gg/bot/911731627498041374/vote'; // Replace with actual URL

        const embed = new EmbedBuilder()
            .setTitle(I18n.t('view.premium_title', interaction.locale))
            .setDescription(I18n.t('view.premium_desc', interaction.locale))
            .setColor('#FFD700'); // Gold

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setLabel(I18n.t('view.vote_unlock', interaction.locale))
                    .setStyle(ButtonStyle.Link)
                    .setURL(voteUrl),
                new ButtonBuilder()
                    .setCustomId(`check_vote_${pollId}`)
                    .setLabel(I18n.t('view.i_voted', interaction.locale))
                    .setStyle(ButtonStyle.Success)
            );

        await interaction.reply({
            embeds: [embed],
            components: [row],
            ephemeral: true
        });
        return;
    }

    // 2. Fetch Poll Data
    const { data: poll, error: pollError } = await supabase
        .from('polls')
        .select('*')
        .eq('message_id', pollId)
        .single();

    if (pollError || !poll) {
        // If this was triggered by a button click on the poll message, remove the buttons to stop spam
        if (interaction.message && typeof interaction.message.edit === 'function') {
            try {
                await interaction.message.edit({ components: [] });
            } catch (error) {
                logger.error('Failed to remove buttons from orphaned poll:', error);
            }
        }
        await interaction.reply({ content: I18n.t('messages.manager.poll_not_found', interaction.locale), ephemeral: true });
        return;
    }

    // 2a. Check allow_exports / public permissions
    const settings = poll.settings as any || {};
    const allowExports = settings.allow_exports !== false; // Default true
    const isPublic = settings.public !== false; // Default true

    if (!allowExports || !isPublic) {
        const member = interaction.member as GuildMember;
        const hasRole = member.roles.cache.some(r => r.name === 'Poll Manager');
        const hasPermission = member.permissions.has(PermissionsBitField.Flags.ManageGuild);
        const isCreator = poll.creator_id === interaction.user.id;

        if (!isCreator && !hasRole && !hasPermission) {
            await interaction.reply({ content: I18n.t('view.export_restricted', interaction.locale), ephemeral: true });
            return;
        }
    }

    // 3. Fetch Vote Data (Just indexes for aggregate counts)
    const { data: votes, error: voteError } = await supabase
        .from('votes')
        .select('option_index')
        .eq('poll_id', pollId);

    if (voteError) {
        logger.error('Error fetching votes for view:', voteError);
        await interaction.reply({ content: I18n.t('messages.common.generic_error', interaction.locale), ephemeral: true });
        return;
    }

    // 4. Aggregate Votes
    const options = poll.options as string[];
    const voteCounts = new Array(options.length).fill(0);

    if (votes) {
        votes.forEach(v => {
            if (voteCounts[v.option_index] !== undefined) {
                voteCounts[v.option_index]++;
            }
        });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        // 5. Generate Dashboard Image
        const imageBuffer = await Renderer.renderDetailedView({
            title: poll.title,
            description: poll.description,
            options: options,
            votes: voteCounts,
            totalVotes: votes ? votes.length : 0,
            creator: (await interaction.client.users.fetch(poll.creator_id).catch(() => ({ username: I18n.t('messages.manager.unknown_user', interaction.locale) }))).username,
            locale: interaction.locale,
            closed: !poll.active
        });

        const attachment = new AttachmentBuilder(imageBuffer, { name: 'results.png' });

        // 6. Build Interactive Components
        const embed = new EmbedBuilder()
            .setTitle(I18n.t('view.title', interaction.locale, { title: poll.title }))
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
