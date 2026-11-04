import { Client, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, MessageFlags, AttachmentBuilder, ChatInputCommandInteraction, ButtonInteraction, Guild } from 'discord.js';
import { supabase } from './db';
import { Renderer } from './renderer';
import { logger } from './logger';
import { I18n } from './i18n';
import { aggregateVotes } from './voteUtils';
import { cancelPendingRender } from './renderQueue';
import { InteractionMemberLike, memberHasManageGuild, memberHasRoleName, memberRoleIds } from './guildUtils';

export interface PollComponentOptions {
    options: string[];
    settings?: {
        min_votes?: number;
        max_votes?: number;
        allow_close?: boolean;
    } | null;
    active: boolean;
    serverAllowsButtons: boolean;
    serverLocale: string;
}

export class PollManager {
    /**
     * Single source of truth for constructing Discord message components for
     * both active and closed polls across slash commands, buttons, auto-close,
     * and the web dashboard.
     */
    static buildPollComponents(params: PollComponentOptions): ActionRowBuilder<any>[] {
        const { options, settings, active, serverAllowsButtons, serverLocale } = params;
        const components: ActionRowBuilder<any>[] = [];

        if (active) {
            const maxVotes = Math.min(Math.max(settings?.max_votes || 1, 1), Math.max(options.length, 1));
            const minVotes = Math.min(Math.max(settings?.min_votes || 1, 1), maxVotes);

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('poll_vote')
                .setPlaceholder(I18n.t('messages.manager.select_placeholder', serverLocale))
                .setMinValues(minVotes)
                .setMaxValues(maxVotes)
                .addOptions(
                    options.map((item: string, index: number) =>
                        new StringSelectMenuOptionBuilder()
                            .setLabel(item.substring(0, 100))
                            .setValue(index.toString())
                            .setDescription(I18n.t('messages.manager.vote_option_desc', serverLocale, { index: index + 1 }))
                    )
                );
            components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu));

            if (serverAllowsButtons) {
                const buttonRow = new ActionRowBuilder<ButtonBuilder>();
                if (settings?.allow_close !== false) {
                    buttonRow.addComponents(
                        new ButtonBuilder()
                            .setCustomId('poll_close')
                            .setLabel(I18n.t('messages.manager.close_button', serverLocale))
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji('🔒')
                    );
                }
                buttonRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId('view_details')
                        .setLabel(I18n.t('messages.manager.view_details_button', serverLocale))
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('📊')
                );
                components.push(buttonRow);
            }
        } else if (serverAllowsButtons) {
            const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId('poll_reopen')
                    .setLabel(I18n.t('messages.manager.reopen_button', serverLocale))
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🔓'),
                new ButtonBuilder()
                    .setCustomId('view_details')
                    .setLabel(I18n.t('messages.manager.view_details_button', serverLocale))
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📊')
            );
            components.push(buttonRow);
        }

        return components;
    }

    static async setPollStatus(interaction: ChatInputCommandInteraction | ButtonInteraction, pollId: string, active: boolean) {
        try {
            if (!interaction.inGuild()) {
                return interaction.reply({ content: I18n.t('messages.common.guild_only', interaction.locale), flags: MessageFlags.Ephemeral });
            }

            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            }

            // 1. Fetch Poll Data (scoped to the interaction's guild to prevent cross-server IDOR)
            const { data: pollData, error: pollError } = await supabase
                .from('polls')
                .select('*')
                .eq('message_id', pollId)
                .eq('guild_id', interaction.guildId)
                .single();

            if (pollError || !pollData) {
                const msg = I18n.t('messages.manager.poll_not_found', interaction.locale);
                return interaction.editReply({ content: msg });
            }

            // 2. Auth Check & Locale Fetch
            const isAdmin = memberHasManageGuild(interaction.member);
            const isPollManager = memberHasRoleName(interaction.guild, interaction.member, 'Poll Manager');
            const isCreator = pollData.creator_id === interaction.user.id;

            if (!isAdmin && !isPollManager && !isCreator) {
                const errorMsg = I18n.t('messages.manager.permissions_error', interaction.locale);
                return interaction.editReply({ content: errorMsg });
            }

            // Cancel any pending debounced vote render so it cannot clobber the status flip
            cancelPendingRender(pollId);

            // Fetch Guild Settings for Buttons & Locale
            let serverLocale = 'en';
            let showButtons = true;

            if (interaction.inGuild()) {
                const { data: guildSettings } = await supabase
                    .from('guild_settings')
                    .select('allow_poll_buttons, locale')
                    .eq('guild_id', interaction.guildId)
                    .maybeSingle();

                if (guildSettings) {
                    showButtons = guildSettings.allow_poll_buttons;
                    if (guildSettings.locale) serverLocale = guildSettings.locale;
                }
            }

            // 3. Fetch Vote Data for Render using centralized utility
            const voteData = await aggregateVotes(pollId, pollData.options.length);

            // If the vote query failed, abort rather than baking a zero-filled
            // image into the (possibly permanently) closed poll. The user can retry.
            if (voteData.error) {
                const msg = I18n.t('messages.common.error', interaction.locale);
                if (interaction.deferred || interaction.replied) {
                    return interaction.editReply({ content: msg });
                }
                return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
            }

            const counts = voteData.counts;
            const totalVotes = voteData.totalWeight;

            // Fetch Creator Tag
            let creatorTag = I18n.t('messages.manager.unknown_user', serverLocale); // Use Server Locale
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

            const showVotes = !active || (pollData.settings && pollData.settings.public !== false);

            const renderOptions: any = {
                title: resolvedTitle,
                description: resolvedDescription,
                options: resolvedOptions,
                totalVotes: totalVotes,
                creator: creatorTag,
                closed: !active,
                locale: serverLocale // Pass Server Locale
            };

            if (showVotes) {
                renderOptions.votes = counts;
            }

            const imageBuffer = await Renderer.renderPoll(renderOptions);

            const attachment = new AttachmentBuilder(imageBuffer, { name: 'poll.png' });

            // 4. Build Components for the new state (including View Details button)
            const components = PollManager.buildPollComponents({
                options: pollData.options,
                settings: pollData.settings,
                active,
                serverAllowsButtons: showButtons,
                serverLocale,
            });

            // 5. Get the message to edit
            let messageToEdit;
            if (interaction.isButton()) {
                messageToEdit = interaction.message;
            } else {
                // Must fetch channel then message
                const channel = await interaction.client.channels.fetch(pollData.channel_id);
                if (channel?.isTextBased()) {
                    messageToEdit = await channel.messages.fetch(pollId);
                }
            }

            if (!messageToEdit) {
                const msg = I18n.t('messages.manager.msg_update_fail', interaction.locale);
                if (interaction.deferred || interaction.replied) {
                    return interaction.editReply({ content: msg });
                }
                return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
            }

            // 6. Update Discord message FIRST (before database)
            // This ensures the poll state only changes if the message update succeeds
            await messageToEdit.edit({
                files: [attachment],
                components: components
            });

            // 7. Only update database AFTER Discord message was successfully updated.
            // If reopening a poll whose scheduled ends_at has already passed, clear
            // ends_at so PollSchedulerService does not immediately auto-close it again.
            const dbUpdate: Record<string, any> = { active };
            if (active && pollData.ends_at && new Date(pollData.ends_at).getTime() <= Date.now()) {
                dbUpdate.ends_at = null;
            }

            const { error: updateError } = await supabase
                .from('polls')
                .update(dbUpdate)
                .eq('message_id', pollId);

            if (updateError) {
                logger.error('Failed to update poll state in DB (Discord was updated):', updateError);
                // Note: Discord message was updated but DB failed - this is an edge case
                // We still report success to the user since the visible state changed
            }

            // Interaction Response
            const successMsg = active ? I18n.t('messages.manager.reopened', interaction.locale) : I18n.t('messages.manager.closed', interaction.locale);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: successMsg, flags: MessageFlags.Ephemeral });
            } else {
                await interaction.editReply({ content: successMsg });
            }

        } catch (err: any) {
            // Handle Missing Access / Missing Permissions gracefully
            if (err.code === 50001 || err.code === 50013) {
                // Log at warn level since these are expected scenarios (permissions changed, channel deleted, etc.)
                logger.warn(`PollManager permission issue (${err.code}): ${err.message}`, {
                    pollId,
                    channelUrl: err.url
                });

                // Database was NOT updated because Discord message update failed first
                // Inform the user that the action could not be completed
                const requiredPerms = 'View Channel, Send Messages, Attach Files, Embed Links';
                let errorMsg: string;
                if (err.code === 50001) {
                    // Missing Access - bot can't see the channel
                    errorMsg = I18n.t('messages.manager.missing_access_no_update', interaction.locale, { permissions: requiredPerms });
                } else {
                    // Missing Permissions - bot can't perform the action
                    errorMsg = I18n.t('messages.manager.missing_perms_no_update', interaction.locale, { permissions: requiredPerms });
                }

                try {
                    if (interaction.deferred || interaction.replied) {
                        await interaction.editReply({ content: errorMsg });
                    } else {
                        await interaction.reply({ content: errorMsg, flags: MessageFlags.Ephemeral });
                    }
                } catch { /* ignore if we can't even reply */ }
                return;
            }

            // For unexpected errors, log at error level
            logger.error('Error in PollManager:', err);
            // Try to notify user
            try {
                const msg = I18n.t('messages.common.error', interaction.locale);
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: msg });
                } else {
                    await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
                }
            } catch { }
        }
    }

    /**
     * Non-interactive close used by the auto-close scheduler. Mirrors the
     * close half of setPollStatus without an interaction (no permission
     * check — the schedule was authorized at poll creation; no replies).
     *
     * Error policy (differs from the interactive path so the scheduler
     * cannot retry a dead poll forever):
     *  - vote-count query failed → do nothing, retry next tick (repo rule:
     *    never bake a zero-filled image into a closed poll)
     *  - Unknown Message (10008) → close in DB and mark discord_deleted
     *  - Missing Access/Permissions (50001/50013) → close in DB anyway; the
     *    DB flag is what stops votes, the stale image is acceptable
     *  - anything else → log and retry next tick
     */
    static async autoClosePoll(client: Client, pollData: any): Promise<void> {
        const pollId: string = pollData.message_id;
        cancelPendingRender(pollId);

        // Guild settings for buttons + locale
        let serverLocale = 'en';
        let showButtons = true;
        const { data: guildSettings } = await supabase
            .from('guild_settings')
            .select('allow_poll_buttons, locale')
            .eq('guild_id', pollData.guild_id)
            .maybeSingle();
        if (guildSettings) {
            showButtons = guildSettings.allow_poll_buttons;
            if (guildSettings.locale) serverLocale = guildSettings.locale;
        }

        const voteData = await aggregateVotes(pollId, pollData.options.length);
        if (voteData.error) {
            logger.warn(`[AutoClose] Skipping poll ${pollId}: vote aggregation failed (will retry next tick).`);
            return;
        }

        try {
            const channel = await client.channels.fetch(pollData.channel_id);
            if (!channel) {
                logger.info(`[AutoClose] Channel ${pollData.channel_id} for poll ${pollId} no longer exists; closing and marking discord_deleted.`);
                await supabase.from('polls').update({ active: false, discord_deleted: true }).eq('message_id', pollId);
                return;
            }
            if (!channel.isTextBased()) {
                logger.warn(`[AutoClose] Channel ${pollData.channel_id} for poll ${pollId} is not text-based; closing in DB only.`);
                await supabase.from('polls').update({ active: false }).eq('message_id', pollId);
                return;
            }
            const message = await channel.messages.fetch(pollId);

            let creatorTag = I18n.t('messages.manager.unknown_user', serverLocale);
            try {
                const user = await client.users.fetch(pollData.creator_id);
                creatorTag = user.tag;
            } catch (e) {
                logger.warn(`[AutoClose] Failed to fetch creator ${pollData.creator_id}`, e);
            }

            const guild = 'guild' in channel ? (channel as any).guild ?? null : null;
            const resolvedTitle = await PollManager.resolveMentions(pollData.title, guild);
            const resolvedDescription = await PollManager.resolveMentions(pollData.description, guild);
            const resolvedOptions = await Promise.all(
                pollData.options.map(async (opt: string) => await PollManager.resolveMentions(opt, guild))
            );

            const imageBuffer = await Renderer.renderPoll({
                title: resolvedTitle,
                description: resolvedDescription,
                options: resolvedOptions,
                // Closed polls always reveal counts (matches setPollStatus).
                votes: voteData.counts,
                totalVotes: voteData.totalWeight,
                creator: creatorTag,
                closed: true,
                locale: serverLocale,
            } as any);
            const attachment = new AttachmentBuilder(imageBuffer, { name: 'poll.png' });

            const components = PollManager.buildPollComponents({
                options: pollData.options,
                settings: pollData.settings,
                active: false,
                serverAllowsButtons: showButtons,
                serverLocale,
            });

            // Discord first, then DB — same ordering as setPollStatus.
            await message.edit({ files: [attachment], components });

            const { error: updateError } = await supabase
                .from('polls')
                .update({ active: false })
                .eq('message_id', pollId);
            if (updateError) {
                logger.error(`[AutoClose] Discord updated but DB close failed for ${pollId}:`, updateError);
            }
        } catch (err: any) {
            if (err?.code === 10008 || err?.code === 10003 || err?.code === 10004) {
                // Unknown Message (10008), Unknown Channel (10003), or Unknown Guild (10004)
                logger.info(`[AutoClose] Poll target ${pollId} no longer exists in Discord (code ${err.code}); closing and marking discord_deleted.`);
                await supabase.from('polls').update({ active: false, discord_deleted: true }).eq('message_id', pollId);
                return;
            }
            if (err?.code === 50001 || err?.code === 50013) { // Missing Access / Permissions
                logger.warn(`[AutoClose] Missing permissions (${err.code}) updating poll ${pollId}; closing in DB only.`);
                await supabase.from('polls').update({ active: false }).eq('message_id', pollId);
                return;
            }
            throw err; // scheduler logs and retries next tick
        }
    }

    static async resolveMentions(text: string, guild: Guild | null): Promise<string> {
        if (!text || !guild) return text;

        const userMatches = [...text.matchAll(/<@!?(\d+)>/g)];
        const roleMatches = [...text.matchAll(/<@&(\d+)>/g)];
        const channelMatches = [...text.matchAll(/<#(\d+)>/g)];

        const replacements = new Map<string, string>();

        // Users
        for (const match of userMatches) {
            const fullMatch = match[0];
            const id = match[1];
            if (!fullMatch || !id) continue;

            if (!replacements.has(fullMatch)) {
                try {
                    const member = await guild.members.fetch(id).catch(() => null);
                    if (member) {
                        replacements.set(fullMatch, `@${member.displayName}`);
                    } else {
                        // Fallback to username if not in guild
                        const user = await guild.client.users.fetch(id).catch(() => null);
                        if (user) {
                            replacements.set(fullMatch, `@${user.username}`);
                        }
                    }
                } catch { }
            }
        }

        // Roles
        for (const match of roleMatches) {
            const fullMatch = match[0];
            const id = match[1];
            if (!fullMatch || !id) continue;

            if (!replacements.has(fullMatch)) {
                try {
                    const role = await guild.roles.fetch(id).catch(() => null);
                    if (role) {
                        replacements.set(fullMatch, `@${role.name}`);
                    }
                } catch { }
            }
        }

        // Channels
        for (const match of channelMatches) {
            const fullMatch = match[0];
            const id = match[1];
            if (!fullMatch || !id) continue;

            if (!replacements.has(fullMatch)) {
                try {
                    const channel = await guild.channels.fetch(id).catch(() => null);
                    if (channel) {
                        replacements.set(fullMatch, `#${channel.name}`);
                    }
                } catch { }
            }
        }

        let newText = text;
        for (const [key, value] of replacements) {
            newText = newText.split(key).join(value);
        }
        return newText;
    }



    /**
     * Parses a string of weights (e.g. "@Admin=5 @Mod=2") into a map of Role ID -> Weight.
     */
    static parseWeights(input: string): Record<string, number> {
        if (!input) return {};
        const weights: Record<string, number> = {};

        // Split by comma or space
        const parts = input.split(/[, ]+/);

        for (const part of parts) {
            // Match <@&ID>=VALUE
            const match = part.match(/<@&(\d+)>=(\d+)/);
            if (match && match[1] && match[2]) {
                const roleId = match[1];
                const weight = parseInt(match[2], 10);
                if (!isNaN(weight)) {
                    weights[roleId] = weight;
                }
            }
        }

        return weights;
    }

    /**
     * Calculates the vote weight for a user based on their roles and configuration.
     * Takes the HIGHEST weight found among their roles.
     * Default is 1.
     */
    static calculateUserWeight(member: InteractionMemberLike, globalWeights: Record<string, number> | null, pollWeights: Record<string, number> | null): number {
        const roleIds = new Set(memberRoleIds(member));
        if (roleIds.size === 0) return 1;

        let maxWeight = 1;

        // Check Global Weights
        if (globalWeights) {
            for (const [roleId, weight] of Object.entries(globalWeights)) {
                if (roleIds.has(roleId)) {
                    if (weight > maxWeight) maxWeight = weight;
                }
            }
        }

        // Check Poll Specific Weights (Highest weight applies across global + poll weights)
        if (pollWeights) {
            for (const [roleId, weight] of Object.entries(pollWeights)) {
                if (roleIds.has(roleId)) {
                    if (weight > maxWeight) maxWeight = weight;
                }
            }
        }

        return maxWeight;
    }
}
