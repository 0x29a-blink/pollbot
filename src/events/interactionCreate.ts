import { Events, Interaction, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, TextChannel, GuildChannel, GuildMember } from 'discord.js';
import { ExtendedClient } from '../bot';
import { supabase } from '../lib/db';
import { Renderer } from '../lib/renderer';
import { logger } from '../lib/logger';
import { PollManager } from '../lib/pollManager';
import { I18n } from '../lib/i18n';
import { aggregateVotes, replaceUserVotes } from '../lib/voteUtils';
import { scheduleRender } from '../lib/renderQueue';
import { trackUsage } from '../lib/usageTracker';
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
                trackUsage({ source: 'bot', event_type: isCloseAction ? 'poll_close' : 'poll_reopen', guild_id: interaction.guildId, user_id: interaction.user.id });
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

                // Fetch guild settings once (weights + locale) — reused for the
                // weight calculation below and the re-render further down.
                let globalWeights = {};
                let serverLocale = 'en';
                if (interaction.guildId) {
                    const { data: guildSettings } = await supabase
                        .from('guild_settings')
                        .select('vote_weights, locale')
                        .eq('guild_id', interaction.guildId)
                        .single();
                    if (guildSettings?.vote_weights) {
                        globalWeights = guildSettings.vote_weights;
                    }
                    if (guildSettings?.locale) {
                        serverLocale = guildSettings.locale;
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
                const pollWeights = pollData.settings?.vote_weights || {};
                const voteWeight = PollManager.calculateUserWeight(member, globalWeights, pollWeights);

                // 5. Record Vote atomically (replace the user's previous votes).
                // A partial failure here can never erase the user's prior vote.
                const replaceResult = await replaceUserVotes(pollId, userId, selectedIndices, voteWeight);

                if (!replaceResult.ok) {
                    if (replaceResult.fkViolation) { // Poll row missing
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

                    await interaction.editReply({ content: I18n.t('messages.poll.vote_fail', interaction.locale) });
                    return;
                }

                // 6. Acknowledge the vote
                const votedOptions = selectedIndices.map(i => pollData.options[i]).join(', ');
                const weightMsg = voteWeight > 1 ? ` (Weight: ${voteWeight})` : '';
                await interaction.editReply({ content: I18n.t('messages.poll.voted', interaction.locale, { options: votedOptions }) + weightMsg });
                logger.info(`[${interaction.guild?.name || 'Unknown Guild'} (${interaction.guild?.memberCount || '?'})] ${interaction.user.tag} voted on poll ${pollId} with the following item: ${votedOptions} weight:${voteWeight}`);
                trackUsage({ source: 'bot', event_type: 'vote', guild_id: interaction.guildId, user_id: userId });

                // 7. Update the Poll Image — coalesced per poll so a burst of votes
                // collapses to a single render + Discord edit (the voter already got
                // their ephemeral confirmation above). The job re-reads the current
                // totals when it runs, so the final image reflects every vote in the
                // burst rather than each intermediate state.
                const messageToEdit = interaction.message;
                const showVotes = pollData.settings.public;

                scheduleRender(pollId, async () => {
                    const voteAggregation = await aggregateVotes(pollId, pollData.options.length);

                    // If the count query failed, skip the refresh rather than
                    // overwriting the live poll with a zero-filled fallback.
                    if (voteAggregation.error) {
                        logger.warn(`[Vote] Skipping poll image refresh for ${pollId} due to a vote aggregation error (vote was recorded).`);
                        return;
                    }

                    let creatorTag = "Unknown User";
                    try {
                        const user = await interaction.client.users.fetch(pollData.creator_id);
                        creatorTag = user.tag;
                    } catch (e) {
                        logger.warn(`Failed to fetch creator ${pollData.creator_id}`, e);
                    }

                    const resolvedTitle = await PollManager.resolveMentions(pollData.title, interaction.guild);
                    const resolvedDescription = await PollManager.resolveMentions(pollData.description, interaction.guild);
                    const resolvedOptions = await Promise.all(
                        pollData.options.map(async (opt: string) => await PollManager.resolveMentions(opt, interaction.guild))
                    );

                    const renderOptions: any = {
                        title: resolvedTitle,
                        description: resolvedDescription,
                        options: resolvedOptions,
                        totalVotes: voteAggregation.totalWeight,
                        creator: creatorTag,
                        closed: false,
                        locale: serverLocale // Pass Server Locale
                    };

                    if (showVotes) {
                        renderOptions.votes = voteAggregation.counts;
                    }

                    const imageBuffer = await Renderer.renderPoll(renderOptions);
                    const attachment = new AttachmentBuilder(imageBuffer, { name: 'poll.png' });

                    try {
                        await messageToEdit.edit({ files: [attachment] });
                    } catch (editErr: any) {
                        // The vote is already recorded; a failed image edit (e.g. the
                        // bot lost channel permissions) is logged, not surfaced to the
                        // voter, who cannot act on it anyway.
                        if (editErr?.code === 50001 || editErr?.code === 50013) {
                            logger.warn(`[Vote] Could not update poll image for ${pollId} (missing permissions ${editErr.code}).`);
                        } else {
                            throw editErr;
                        }
                    }
                });

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
            trackUsage({ source: 'bot', event_type: `command:${interaction.commandName}`, guild_id: interaction.guildId, user_id: interaction.user.id });
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
