import { Interaction, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, MessageFlags, AttachmentBuilder, GuildMember, PermissionsBitField, ChatInputCommandInteraction, ButtonInteraction, Guild } from 'discord.js';
import { supabase } from './db';
import { Renderer } from './renderer';
import { logger } from './logger';
import { I18n } from './i18n';

export class PollManager {
    static async setPollStatus(interaction: ChatInputCommandInteraction | ButtonInteraction, pollId: string, active: boolean) {
        try {
            // 1. Fetch Poll Data
            const { data: pollData, error: pollError } = await supabase
                .from('polls')
                .select('*')
                .eq('message_id', pollId)
                .single();

            if (pollError || !pollData) {
                const msg = I18n.t('messages.manager.poll_not_found', interaction.locale);
                if (interaction.deferred || interaction.replied) {
                    return interaction.editReply({ content: msg });
                }
                return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
            }

            // 2. Auth Check & Locale Fetch
            const member = interaction.member as GuildMember;
            const isAdmin = member?.permissions.has(PermissionsBitField.Flags.ManageGuild);
            const isPollManager = member?.roles.cache.some(r => r.name === 'Poll Manager');

            if (!isAdmin && !isPollManager) {
                const errorMsg = I18n.t('messages.manager.permissions_error', interaction.locale);
                if (interaction.deferred || interaction.replied) {
                    return interaction.editReply({ content: errorMsg });
                }
                return interaction.reply({ content: errorMsg, flags: MessageFlags.Ephemeral });
            }

            // Fetch Guild Settings for Buttons & Locale
            let serverLocale = 'en';
            let showButtons = true;

            if (interaction.inGuild()) {
                const { data: guildSettings } = await supabase
                    .from('guild_settings')
                    .select('allow_poll_buttons, locale')
                    .eq('guild_id', interaction.guildId)
                    .single();

                if (guildSettings) {
                    showButtons = guildSettings.allow_poll_buttons;
                    if (guildSettings.locale) serverLocale = guildSettings.locale;
                }
            }

            // 3. Update Database
            const { error: updateError } = await supabase
                .from('polls')
                .update({ active: active })
                .eq('message_id', pollId);

            if (updateError) {
                logger.error('Failed to update poll state:', updateError);
                // Use server locale for response if possible, or interaction
                const msg = I18n.t('messages.manager.update_state_fail', interaction.locale);
                if (interaction.deferred || interaction.replied) {
                    return interaction.editReply({ content: msg });
                }
                return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
            }

            // 4. Fetch Vote Data for Render
            const { data: voteCounts } = await supabase
                .from('votes')
                .select('option_index')
                .eq('poll_id', pollId);

            const counts = new Array(pollData.options.length).fill(0);
            if (voteCounts) {
                voteCounts.forEach((v: any) => {
                    if (v.option_index >= 0 && v.option_index < counts.length) counts[v.option_index]++;
                });
            }
            const totalVotes = voteCounts ? voteCounts.length : 0;

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

            const showVotes = !active || (pollData.settings && pollData.settings.public);

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

            // 5. Update Components
            const components: ActionRowBuilder<any>[] = [];

            if (active) {
                // ACTIVE: Select Menu + Close Button (if enabled)
                const maxVotes = Math.min(pollData.settings?.max_votes || 1, pollData.options.length);
                const minVotes = Math.min(pollData.settings?.min_votes || 1, maxVotes);

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('poll_vote')
                    .setPlaceholder(I18n.t('messages.manager.select_placeholder', serverLocale)) // Use Server Locale
                    .setMinValues(minVotes)
                    .setMaxValues(maxVotes)
                    .addOptions(
                        pollData.options.map((item: string, index: number) =>
                            new StringSelectMenuOptionBuilder()
                                .setLabel(item.substring(0, 100))
                                .setValue(index.toString())
                                .setDescription(I18n.t('messages.manager.vote_option_desc', serverLocale, { index: index + 1 })) // Use Server Locale
                        )
                    );
                components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu));

                // Check Guild Settings for Buttons
                if (pollData.settings.allow_close) {
                    if (showButtons) {
                        const closeButton = new ButtonBuilder()
                            .setCustomId('poll_close')
                            .setLabel(I18n.t('messages.manager.close_button', serverLocale)) // Use Server Locale
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji('🔒');
                        components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(closeButton));
                    }
                }
            } else {
                // CLOSED: Reopen Button (if enabled)
                if (showButtons) {
                    const reopenButton = new ButtonBuilder()
                        .setCustomId('poll_reopen')
                        .setLabel(I18n.t('messages.manager.reopen_button', serverLocale)) // Use Server Locale
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('🔓');
                    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(reopenButton));
                }
            }

            // Input check for poll interaction type
            let messageToEdit;
            if (interaction.isButton()) {
                messageToEdit = interaction.message;
            } else {
                // Must fetch channel then message
                // pollData.channel_id
                const channel = await interaction.client.channels.fetch(pollData.channel_id);
                if (channel?.isTextBased()) {
                    messageToEdit = await channel.messages.fetch(pollId);
                }
            }

            if (messageToEdit) {
                await messageToEdit.edit({
                    files: [attachment],
                    components: components
                });
            } else {
                const msg = I18n.t('messages.manager.msg_update_fail', interaction.locale);
                if (interaction.deferred || interaction.replied) {
                    return interaction.editReply({ content: msg });
                }
                return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
            }

            // Interaction Response
            const successMsg = active ? I18n.t('messages.manager.reopened', interaction.locale) : I18n.t('messages.manager.closed', interaction.locale);
            if (interaction.isButton()) {
                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: successMsg, flags: MessageFlags.Ephemeral });
                    } else {
                        await interaction.followUp({ content: successMsg, flags: MessageFlags.Ephemeral });
                    }
                } catch (e) { /* ignore already replied */ }
            } else {
                // Slash Command
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: successMsg, flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.editReply({ content: successMsg });
                }
            }

        } catch (err) {
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
    static calculateUserWeight(member: GuildMember | null, globalWeights: Record<string, number> | null, pollWeights: Record<string, number> | null): number {
        if (!member) return 1;

        let maxWeight = 1;

        // Check Global Weights
        if (globalWeights) {
            for (const [roleId, weight] of Object.entries(globalWeights)) {
                if (member.roles.cache.has(roleId)) {
                    if (weight > maxWeight) maxWeight = weight;
                }
            }
        }

        // Check Poll Specific Weights (Override Global if higher? Or just take max of all?)
        // Usually specific overrides global, but if we want "Highest Role Wins" logic across both:
        if (pollWeights) {
            for (const [roleId, weight] of Object.entries(pollWeights)) {
                if (member.roles.cache.has(roleId)) {
                    // Start from scratch or keep max? 
                    // Let's assume poll specific weights take precedence if present for that role.
                    // But if a user has Admin (Global 5) and Voted (Poll 2), which wins?
                    // "Highest weight applies" is safest.
                    if (weight > maxWeight) maxWeight = weight;
                }
            }
        }

        return maxWeight;
    }
}
