import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';
import { I18n } from '../lib/i18n';

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
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);

    // For local testing, you might want to bypass or mock this
    const isPremium = lastVote > twelveHoursAgo;

    if (!isPremium) {
        const voteUrl = 'https://top.gg/bot/YOUR_BOT_ID/vote'; // Replace with actual URL

        const embed = new EmbedBuilder()
            .setTitle('Premium Feature: View Detailed Results')
            .setDescription('Viewing detailed poll results (who voted for what) is a **Premium Feature**.\n\nTo unlock this for 12 hours, simply vote for the bot on Top.gg!')
            .setColor('#FFD700'); // Gold

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Vote to Unlock')
                    .setStyle(ButtonStyle.Link)
                    .setURL(voteUrl),
                new ButtonBuilder()
                    .setCustomId(`check_vote_${pollId}`)
                    .setLabel('I Voted!')
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
        await interaction.reply({ content: 'Poll not found.', ephemeral: true });
        return;
    }

    // 3. Fetch Vote Data
    const { data: votes, error: voteError } = await supabase
        .from('votes')
        .select('user_id, option_index')
        .eq('poll_id', pollId);

    if (voteError) {
        logger.error('Error fetching votes for view:', voteError);
        await interaction.reply({ content: 'Failed to fetch vote data.', ephemeral: true });
        return;
    }

    // 4. Aggregate Votes
    // Map option index to user IDs
    const votersByOption: { [key: number]: string[] } = {};
    if (votes) {
        votes.forEach(vote => {
            if (!votersByOption[vote.option_index]) {
                votersByOption[vote.option_index] = [];
            }
            votersByOption[vote.option_index]!.push(vote.user_id);
        });
    }

    // 5. Construct Embed
    const embed = new EmbedBuilder()
        .setTitle(`Detailed Results: ${poll.title}`)
        .setDescription(poll.description || 'No description')
        .setColor('#0099ff');

    const options = poll.options as string[];

    options.forEach((option, index) => {
        const voterIds = votersByOption[index] || [];
        const count = voterIds.length;

        // Format voter list (max 10, then "...and X more")
        let voterList = 'No votes.';
        if (count > 0) {
            const displayLimit = 15;
            const displayedVoters = voterIds.slice(0, displayLimit).map(id => `<@${id}>`).join(', ');
            const remaining = count - displayLimit;
            voterList = remaining > 0 ? `${displayedVoters}, and ${remaining} more...` : displayedVoters;
        }

        embed.addFields({
            name: `${option} (${count})`,
            value: voterList
        });
    });

    await interaction.reply({ embeds: [embed], ephemeral: true });
}
