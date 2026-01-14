import { Events, Interaction, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, TextChannel, GuildChannel, GuildMember } from 'discord.js';
import { ExtendedClient } from '../bot';
import { supabase } from '../lib/db';
import { Renderer } from '../lib/renderer';
import { logger } from '../lib/logger';
import { PollManager } from '../lib/pollManager';
import { I18n } from '../lib/i18n';
import { AttachmentBuilder } from 'discord.js';

export default {
    name: Events.InteractionCreate,
    async execute(interaction: Interaction) {
        // Handle Button Interactions (Close/Reopen)
        if (interaction.isButton()) {
            // Poll Management (Close/Reopen)
            if (interaction.customId === 'poll_close' || interaction.customId === 'poll_reopen') {
                const pollId = interaction.message.id;
                const isCloseAction = interaction.customId === 'poll_close';
                await PollManager.setPollStatus(interaction, pollId, !isCloseAction);
                return;
            }

            // View Details
            if (interaction.customId === 'view_details' || interaction.customId.startsWith('view_details_')) {
                // Determine Poll ID: from message ID if static, or parsed if using old dynamic logic (backup)
                let pollId = interaction.message.id;
                if (interaction.customId.startsWith('view_details_')) {
                    pollId = interaction.customId.replace('view_details_', '');
                }

                // Permission Check
                const member = interaction.member as GuildMember;
                const isAdmin = member.permissions.has(PermissionFlagsBits.ManageGuild);
                const isPollManager = member.roles.cache.some(r => r.name === 'Poll Manager' || r.name === 'Poll Creator');

                if (!isAdmin && !isPollManager) {
                    await interaction.reply({
                        content: I18n.t('messages.common.view_details_deny', interaction.locale),
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                const { handleViewPoll } = await import('../commands/view');
                await handleViewPoll(interaction, pollId);
                return;
            }

            // Check Vote (Premium Upgrade Check)
            if (interaction.customId.startsWith('check_vote_')) {
                const pollId = interaction.customId.replace('check_vote_', '');
                const { handleViewPoll } = await import('../commands/view');
                await handleViewPoll(interaction, pollId);
                return;
            }
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
                return interaction.reply({ content: I18n.t('messages.poll.invalid_selection', interaction.locale), flags: MessageFlags.Ephemeral });
            }

            try {
                // Defer immediately to prevent timeout on slow DB ops
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                // 1. Fetch Poll Data (Moved up for role checking)
                const { data: pollData, error: pollError } = await supabase
                    .from('polls')
                    .select('*')
                    .eq('message_id', pollId)
                    .single();

                if (pollError || !pollData) {
                    await interaction.editReply({ content: I18n.t('messages.poll.db_missing', interaction.locale) });
                    return;
                }

                if (!pollData.active) {
                    await interaction.editReply({ content: I18n.t('messages.poll.closed', interaction.locale) });
                    return;
                }

                // 2. Role Restriction Check
                const member = interaction.member as GuildMember;
                const allowedRoles = pollData.settings?.allowed_roles as string[];

                if (allowedRoles && allowedRoles.length > 0) {
                    const hasAllowedRole = allowedRoles.some(roleId => member.roles.cache.has(roleId));
                    if (!hasAllowedRole) {
                        await interaction.editReply({ content: I18n.t('messages.poll.role_restricted', interaction.locale) });
                        return;
                    }
                }

                // 3. Check for Existing Vote
                const { data: existingVotes } = await supabase
                    .from('votes')
                    .select('option_index')
                    .eq('poll_id', pollId)
                    .eq('user_id', userId);

                const currentVoteIndices = existingVotes ? existingVotes.map(v => v.option_index).sort((a, b) => a - b) : [];
                const newVoteIndices = [...selectedIndices].sort((a, b) => a - b);

                // If identical, no change needed
                if (JSON.stringify(currentVoteIndices) === JSON.stringify(newVoteIndices)) {
                    await interaction.editReply({ content: I18n.t('messages.poll.already_voted', interaction.locale) });
                    return;
                }

                // 4. Calculate Weight
                // Fetch Global Weights
                let globalWeights = {};
                if (interaction.guildId) {
                    const { data: guildSettings } = await supabase
                        .from('guild_settings')
                        .select('vote_weights')
                        .eq('guild_id', interaction.guildId)
                        .single();
                    if (guildSettings?.vote_weights) {
                        globalWeights = guildSettings.vote_weights;
                    }
                }

                const pollWeights = pollData.settings?.vote_weights || {};
                const voteWeight = PollManager.calculateUserWeight(member, globalWeights, pollWeights);

                // 5. Record Vote (Delete old, insert new)
                // Delete all previous votes for this user on this poll
                const { error: deleteError } = await supabase
                    .from('votes')
                    .delete()
                    .eq('poll_id', pollId)
                    .eq('user_id', userId);

                if (deleteError) {
                    logger.error('Vote Delete Error:', deleteError);
                    await interaction.editReply({ content: I18n.t('messages.poll.vote_fail', interaction.locale) });
                    return;
                }

                // Insert new votes
                const rowsToInsert = selectedIndices.map(index => ({
                    poll_id: pollId,
                    user_id: userId,
                    option_index: index,
                    weight: voteWeight
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

                        await interaction.editReply({ content: I18n.t('messages.poll.orphaned', interaction.locale) });
                        return;
                    }

                    logger.error('Vote Insert Error:', insertError);
                    await interaction.editReply({ content: I18n.t('messages.poll.vote_fail', interaction.locale) });
                    return;
                }

                // 6. Acknowledge the vote
                const votedOptions = selectedIndices.map(i => pollData.options[i]).join(', ');
                const weightMsg = voteWeight > 1 ? ` (Weight: ${voteWeight})` : '';
                await interaction.editReply({ content: I18n.t('messages.poll.voted', interaction.locale, { options: votedOptions }) + weightMsg });
                logger.info(`[${interaction.guild?.name || 'Unknown Guild'} (${interaction.guild?.memberCount || '?'})] ${interaction.user.tag} voted on poll ${pollId} with the following item: ${votedOptions} weight:${voteWeight}`);

                // 7. Update the Poll Image (Always, to show updated Total Votes or Breakdown)
                // Fetch Vote Counts calling new logic? Or just raw aggregation?
                // We need sum of weights now.
                const { data: allVotes, error: countError } = await supabase
                    .from('votes')
                    .select('option_index, weight')
                    .eq('poll_id', pollId);

                if (!countError && allVotes) {
                    // Calculate Total Votes (Effective)
                    let totalEffectiveVotes = 0;
                    const counts = new Array(pollData.options.length).fill(0);

                    allVotes.forEach((v: any) => {
                        const w = v.weight || 1; // Default to 1 if null (shouldn't happen with default)
                        if (v.option_index >= 0 && v.option_index < counts.length) {
                            counts[v.option_index] += w;
                            totalEffectiveVotes += w;
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
                        totalVotes: totalEffectiveVotes,
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

            } catch (err: any) {
                // Sanitize error log to avoid dumping raw request body (binary data)
                const loggableError = { ...err, message: err.message, stack: err.stack, code: err.code };
                if (loggableError.requestBody) {
                    loggableError.requestBody = '[Binary Data Omitted]';
                }

                // Handle Missing Access / Permissions - log at warn level since these are expected scenarios
                if (err.code === 50001 || err.code === 50013) {
                    logger.warn(`Vote update permission issue (${err.code}): ${err.message}`, {
                        pollId,
                        userId,
                        channelUrl: err.url
                    });
                    let missingPerms: string[] = [];

                    if (interaction.guild && interaction.channel && !interaction.channel.isDMBased()) {
                        const me = interaction.guild.members.me;
                        if (me) {
                            const channelPerms = interaction.channel.permissionsFor(me);
                            const required = [
                                { name: 'View Channel', flag: PermissionFlagsBits.ViewChannel },
                                { name: 'Send Messages', flag: PermissionFlagsBits.SendMessages },
                                { name: 'Embed Links', flag: PermissionFlagsBits.EmbedLinks },
                                { name: 'Attach Files', flag: PermissionFlagsBits.AttachFiles }
                            ];

                            missingPerms = required
                                .filter(p => !channelPerms.has(p.flag))
                                .map(p => p.name);
                        }
                    }

                    const permMsg = missingPerms.length > 0
                        ? `\nMissing permissions: **${missingPerms.join(', ')}**`
                        : '';

                    // Choose the appropriate error message based on error code
                    const baseMessage = err.code === 50001
                        ? I18n.t('messages.common.missing_access_channel', interaction.locale)
                        : I18n.t('messages.common.missing_perms_channel', interaction.locale);
                    const errorResponse = baseMessage + permMsg;

                    try {
                        if (interaction.deferred && !interaction.replied) {
                            await interaction.editReply({ content: errorResponse });
                        } else if (!interaction.replied) {
                            await interaction.reply({ content: errorResponse, flags: MessageFlags.Ephemeral });
                        }
                    } catch { /* ignore */ }
                    return;
                }

                // Generic Error - log at error level for unexpected issues
                logger.error('Voting Logic Error:', loggableError);
                try {
                    if (interaction.deferred && !interaction.replied) {
                        await interaction.editReply({ content: I18n.t('messages.common.vote_error', interaction.locale) });
                    } else if (!interaction.replied) {
                        await interaction.reply({ content: I18n.t('messages.common.vote_error', interaction.locale), flags: MessageFlags.Ephemeral });
                    }
                } catch { /* ignore if we can't even reply */ }
            }
            return;
        }

        // Chat Input & Context Menu Commands
        if (!interaction.isChatInputCommand() && !interaction.isContextMenuCommand()) return;

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
                    await interaction.followUp({ content: I18n.t('messages.common.missing_perms_action', interaction.locale), flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ content: I18n.t('messages.common.missing_perms_action', interaction.locale), flags: MessageFlags.Ephemeral });
                }
                return;
            }

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: I18n.t('messages.common.command_error', interaction.locale), flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ content: I18n.t('messages.common.command_error', interaction.locale), flags: MessageFlags.Ephemeral });
            }
        }
    },
};
