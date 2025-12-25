import { Events, Interaction, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { ExtendedClient } from '../bot';
import { supabase } from '../lib/db';
import { Renderer } from '../lib/renderer';
import { logger } from '../lib/logger';
import { PollManager } from '../lib/pollManager';
import { AttachmentBuilder } from 'discord.js';

export default {
    name: Events.InteractionCreate,
    async execute(interaction: Interaction) {
        // Handle Button Interactions (Close/Reopen)
        if (interaction.isButton() && (interaction.customId === 'poll_close' || interaction.customId === 'poll_reopen')) {
            const pollId = interaction.message.id;
            const isCloseAction = interaction.customId === 'poll_close';

            // Use centralised manager
            // Pass active state: Close -> false, Reopen -> true
            await PollManager.setPollStatus(interaction, pollId, !isCloseAction);
            return;
        }

        // Handle Autocomplete
        if (interaction.isAutocomplete()) {
            const client = interaction.client as ExtendedClient;
            const command = client.commands.get(interaction.commandName);

            if (!command) {
                return;
            }

            try {
                if (command.autocomplete) {
                    await command.autocomplete(interaction);
                }
            } catch (error) {
                logger.error(`Error executing autocomplete for ${interaction.commandName}`, error);
            }
            return;
        }

        // Handle Select Menus (Voting)
        if (interaction.isStringSelectMenu() && interaction.customId === 'poll_vote') {
            const pollId = interaction.message.id;
            const userId = interaction.user.id;
            const selectedIndices = interaction.values.map(v => parseInt(v));

            if (selectedIndices.some(isNaN)) {
                return interaction.reply({ content: 'Invalid selection.', flags: MessageFlags.Ephemeral });
            }

            try {
                // Defer immediately to prevent timeout on slow DB ops
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                // 1. Check for Existing Vote
                const { data: existingVotes } = await supabase
                    .from('votes')
                    .select('option_index')
                    .eq('poll_id', pollId)
                    .eq('user_id', userId);

                const currentVoteIndices = existingVotes ? existingVotes.map(v => v.option_index).sort((a, b) => a - b) : [];
                const newVoteIndices = [...selectedIndices].sort((a, b) => a - b);

                // If identical, no change needed
                if (JSON.stringify(currentVoteIndices) === JSON.stringify(newVoteIndices)) {
                    await interaction.editReply({ content: 'You have already voted for these options.' });
                    return;
                }

                // 2. Record Vote (Delete old, insert new)
                // Delete all previous votes for this user on this poll
                const { error: deleteError } = await supabase
                    .from('votes')
                    .delete()
                    .eq('poll_id', pollId)
                    .eq('user_id', userId);

                if (deleteError) {
                    logger.error('Vote Delete Error:', deleteError);
                    await interaction.editReply({ content: 'Failed to record your vote. Please try again.' });
                    return;
                }

                // Insert new votes
                const rowsToInsert = selectedIndices.map(index => ({
                    poll_id: pollId,
                    user_id: userId,
                    option_index: index
                }));

                const { error: insertError } = await supabase
                    .from('votes')
                    .insert(rowsToInsert);

                if (insertError) {
                    if (insertError.code === '23503') { // Foreign Key Violation (Poll missing)
                        logger.info(`Handled orphaned poll vote attempt (Poll ID: ${pollId})`);

                        const disabledRow = new ActionRowBuilder<ButtonBuilder>()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId('poll_invalid')
                                    .setLabel('Poll Invalid - Please Recreate')
                                    .setStyle(ButtonStyle.Danger)
                                    .setDisabled(true)
                            );

                        // Disable the component to prevent further spam
                        await interaction.message.edit({
                            components: [disabledRow]
                        });

                        await interaction.editReply({ content: 'This poll is no longer valid.' });
                        return;
                    }

                    logger.error('Vote Insert Error:', insertError);
                    await interaction.editReply({ content: 'Failed to record your vote. Please try again.' });
                    return;
                }

                // 2. Fetch Poll Settings & Data to see if we should update UI
                const { data: pollData, error: pollError } = await supabase
                    .from('polls')
                    .select('*')
                    .eq('message_id', pollId)
                    .single();

                if (pollError || !pollData) {
                    // Poll might have been deleted but message remains?
                    await interaction.editReply({ content: 'This poll no longer exists in the database.' });
                    return;
                }

                if (!pollData.active) {
                    await interaction.editReply({ content: 'This poll is closed.' });
                    return;
                }

                // 3. Acknowledge the vote
                const votedOptions = selectedIndices.map(i => pollData.options[i]).join(', ');
                await interaction.editReply({ content: `You voted for **${votedOptions}**!` });
                logger.info(`[${interaction.guild?.name || 'Unknown Guild'} (${interaction.guild?.memberCount || '?'})] ${interaction.user.tag} voted on poll ${pollId} with the following item: ${votedOptions}`);

                // 4. Update the Poll Image (Always, to show updated Total Votes or Breakdown)
                // Fetch Vote Counts
                const { data: voteCounts, error: countError } = await supabase
                    .from('votes')
                    .select('option_index')
                    .eq('poll_id', pollId);

                if (!countError && voteCounts) {
                    // Calculate Total Votes
                    const totalVotes = voteCounts.length;

                    // Calculate Breakdown (only needed if public, but useful to have)
                    const counts = new Array(pollData.options.length).fill(0);
                    voteCounts.forEach((v: any) => {
                        if (v.option_index >= 0 && v.option_index < counts.length) {
                            counts[v.option_index]++;
                        }
                    });

                    // Fetch Creator Tag
                    let creatorTag = "Unknown User";
                    try {
                        const user = await interaction.client.users.fetch(pollData.creator_id);
                        creatorTag = user.tag;
                    } catch (e) {
                        logger.warn(`Failed to fetch creator ${pollData.creator_id}`, e);
                    }

                    // Re-render
                    const resolvedTitle = await PollManager.resolveMentions(pollData.title, interaction.guild);
                    const resolvedDescription = await PollManager.resolveMentions(pollData.description, interaction.guild);
                    const resolvedOptions = await Promise.all(
                        pollData.options.map(async (opt: string) => await PollManager.resolveMentions(opt, interaction.guild))
                    );

                    // Determine if we show the bar graph
                    // Show if Public == true
                    const showVotes = pollData.settings.public;

                    // Fetch server locale
                    let serverLocale = 'en';
                    if (interaction.guildId) {
                        const { data: guildSettings } = await supabase
                            .from('guild_settings')
                            .select('locale')
                            .eq('guild_id', interaction.guildId)
                            .single();
                        if (guildSettings?.locale) {
                            serverLocale = guildSettings.locale;
                        }
                    }

                    const renderOptions: any = {
                        title: resolvedTitle,
                        description: resolvedDescription,
                        options: resolvedOptions,
                        totalVotes: totalVotes,
                        creator: creatorTag,
                        closed: false,
                        locale: serverLocale // Pass Server Locale
                    };

                    if (showVotes) {
                        renderOptions.votes = counts;
                    }

                    const imageBuffer = await Renderer.renderPoll(renderOptions);

                    // Let's create an attachment
                    const attachment = new AttachmentBuilder(imageBuffer, { name: 'poll.png' });

                    await interaction.message.edit({
                        files: [attachment],
                    });
                }

            } catch (err) {
                logger.error('Voting Logic Error:', err);
                // If anything blew up, try to notify
                try {
                    if (interaction.deferred && !interaction.replied) {
                        await interaction.editReply({ content: 'An error occurred while voting.' });
                    } else if (!interaction.replied) {
                        // Should not happen if we deferred at start, but safety net
                        await interaction.reply({ content: 'An error occurred while voting.', flags: MessageFlags.Ephemeral });
                    }
                } catch { /* ignore if we can't even reply */ }
            }
            return;
        }

        // Chat Input Commands
        if (!interaction.isChatInputCommand()) return;

        const client = interaction.client as ExtendedClient;
        const command = client.commands.get(interaction.commandName);


        if (!command) {
            logger.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error: any) {
            logger.error(`Error executing ${interaction.commandName}`, error);

            // Check for Missing Permissions to handle gracefully
            if (error.code === 50013) { // Missing Permissions
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: 'I am missing permissions to perform this action! Please check my role permissions.', flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ content: 'I am missing permissions to perform this action! Please check my role permissions.', flags: MessageFlags.Ephemeral });
                }
                return;
            }

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
            }
        }
    },
};
