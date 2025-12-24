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

        // Handle Select Menus (Voting)
        if (interaction.isStringSelectMenu() && interaction.customId === 'poll_vote') {
            const pollId = interaction.message.id;
            const userId = interaction.user.id;
            const selectedIndex = parseInt(interaction.values[0]!);

            if (isNaN(selectedIndex)) {
                return interaction.reply({ content: 'Invalid selection.', flags: MessageFlags.Ephemeral });
            }

            try {
                // 1. Record Vote
                const { error: deleteError } = await supabase
                    .from('votes')
                    .delete()
                    .eq('poll_id', pollId)
                    .eq('user_id', userId);

                if (deleteError) {
                    logger.error('Vote Delete Error:', deleteError);
                    return interaction.reply({ content: 'Failed to record your vote. Please try again.', flags: MessageFlags.Ephemeral });
                }

                const { error: insertError } = await supabase
                    .from('votes')
                    .insert({
                        poll_id: pollId,
                        user_id: userId,
                        option_index: selectedIndex
                    });

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
                        await interaction.update({
                            components: [disabledRow]
                        });
                        return;
                    }

                    logger.error('Vote Insert Error:', insertError);
                    return interaction.reply({ content: 'Failed to record your vote. Please try again.', flags: MessageFlags.Ephemeral });
                }

                // 2. Fetch Poll Settings & Data to see if we should update UI
                const { data: pollData, error: pollError } = await supabase
                    .from('polls')
                    .select('*')
                    .eq('message_id', pollId)
                    .single();

                if (pollError || !pollData) {
                    // Poll might have been deleted but message remains?
                    return interaction.reply({ content: 'This poll no longer exists in the database.', flags: MessageFlags.Ephemeral });
                }

                if (!pollData.active) {
                    return interaction.reply({ content: 'This poll is closed.', flags: MessageFlags.Ephemeral });
                }

                // 3. Acknowledge the vote immediately (ephemeral)
                await interaction.reply({ content: `You voted for **${pollData.options[selectedIndex]}**!`, flags: MessageFlags.Ephemeral });

                // 4. If Public, Update the Poll Image
                // We do this AFTER replying to not block the user interaction response (avoid "This interaction failed")
                if (pollData.settings.public) {
                    // Fetch Vote Counts
                    // We need counts for ALL options.
                    // Group by option_index.
                    const { data: voteCounts, error: countError } = await supabase
                        .from('votes')
                        .select('option_index')
                        .eq('poll_id', pollId);

                    if (!countError && voteCounts) {
                        // Aggregate
                        const counts = new Array(pollData.options.length).fill(0);
                        voteCounts.forEach((v: any) => {
                            if (v.option_index >= 0 && v.option_index < counts.length) {
                                counts[v.option_index]++;
                            }
                        });
                        const totalVotes = voteCounts.length;

                        // Fetch Creator Tag
                        let creatorTag = "Unknown User";
                        try {
                            const user = await interaction.client.users.fetch(pollData.creator_id);
                            creatorTag = user.tag;
                        } catch (e) {
                            logger.warn(`Failed to fetch creator ${pollData.creator_id}`, e);
                        }

                        // Re-render
                        const imageBuffer = await Renderer.renderPoll({
                            title: pollData.title,
                            description: pollData.description,
                            options: pollData.options,
                            votes: counts,
                            totalVotes: totalVotes,
                            creator: creatorTag,
                            closed: false
                        });

                        // Let's create an attachment
                        const attachment = new AttachmentBuilder(imageBuffer, { name: 'poll.png' });

                        await interaction.message.edit({
                            files: [attachment],
                        });
                    }
                }

            } catch (err) {
                logger.error('Voting Logic Error:', err);
                if (!interaction.replied) {
                    await interaction.followUp({ content: 'An error occurred while voting.', flags: MessageFlags.Ephemeral });
                }
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
