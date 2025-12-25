import { Interaction, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, MessageFlags, AttachmentBuilder, GuildMember, PermissionsBitField, ChatInputCommandInteraction, ButtonInteraction, Guild } from 'discord.js';
import { supabase } from './db';
import { Renderer } from './renderer';
import { logger } from './logger';

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
                if (interaction.deferred || interaction.replied) {
                    return interaction.editReply({ content: 'Poll not found in database.' });
                }
                return interaction.reply({ content: 'Poll not found in database.', flags: MessageFlags.Ephemeral });
            }

            // 2. Auth Check
            const member = interaction.member as GuildMember;
            const isAdmin = member?.permissions.has(PermissionsBitField.Flags.ManageGuild);
            const isPollManager = member?.roles.cache.some(r => r.name === 'Poll Manager');

            if (!isAdmin && !isPollManager) {
                const errorMsg = 'You need \'Manage Guild\' permissions or the \'Poll Manager\' role to manage this poll.\n' +
                    'You can ask a server admin to run `/pollmanager create` and then `/pollmanager assign` to give you the role.';
                if (interaction.deferred || interaction.replied) {
                    return interaction.editReply({ content: errorMsg });
                }
                return interaction.reply({ content: errorMsg, flags: MessageFlags.Ephemeral });
            }

            // 3. Update Database
            const { error: updateError } = await supabase
                .from('polls')
                .update({ active: active })
                .eq('message_id', pollId);

            if (updateError) {
                logger.error('Failed to update poll state:', updateError);
                if (interaction.deferred || interaction.replied) {
                    return interaction.editReply({ content: 'Failed to update poll state.' });
                }
                return interaction.reply({ content: 'Failed to update poll state.', flags: MessageFlags.Ephemeral });
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

            const showVotes = !active || (pollData.settings && pollData.settings.public);

            const renderOptions: any = {
                title: resolvedTitle,
                description: resolvedDescription,
                options: resolvedOptions,
                totalVotes: totalVotes,
                creator: creatorTag,
                closed: !active
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
                    .setPlaceholder('Select an option to vote')
                    .setMinValues(minVotes)
                    .setMaxValues(maxVotes)
                    .addOptions(
                        pollData.options.map((item: string, index: number) =>
                            new StringSelectMenuOptionBuilder()
                                .setLabel(item.substring(0, 100))
                                .setValue(index.toString())
                                .setDescription(`Vote for Option #${index + 1}`)
                        )
                    );
                components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu));

                // Check Guild Settings for Buttons
                if (pollData.settings.allow_close) {
                    const { data: guildSettings } = await supabase
                        .from('guild_settings')
                        .select('allow_poll_buttons')
                        .eq('guild_id', interaction.guildId)
                        .single();

                    const showButton = guildSettings?.allow_poll_buttons ?? true; // Default true

                    if (showButton) {
                        const closeButton = new ButtonBuilder()
                            .setCustomId('poll_close')
                            .setLabel('Close Poll')
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji('🔒');
                        components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(closeButton));
                    }
                }
            } else {
                // CLOSED: Reopen Button (if enabled)
                const { data: guildSettings } = await supabase
                    .from('guild_settings')
                    .select('allow_poll_buttons')
                    .eq('guild_id', interaction.guildId)
                    .single();

                const showButton = guildSettings?.allow_poll_buttons ?? true;

                if (showButton) {
                    const reopenButton = new ButtonBuilder()
                        .setCustomId('poll_reopen')
                        .setLabel('Reopen Poll')
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
                if (interaction.deferred || interaction.replied) {
                    return interaction.editReply({ content: 'Could not find the poll message to update.' });
                }
                return interaction.reply({ content: 'Could not find the poll message to update.', flags: MessageFlags.Ephemeral });
            }

            // Interaction Response
            if (interaction.isButton()) {
                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: active ? 'Poll Reopened!' : 'Poll Closed!', flags: MessageFlags.Ephemeral });
                    } else {
                        await interaction.followUp({ content: active ? 'Poll Reopened!' : 'Poll Closed!', flags: MessageFlags.Ephemeral });
                    }
                } catch (e) { /* ignore already replied */ }
            } else {
                // Slash Command
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: active ? 'Poll Reopened!' : 'Poll Closed!', flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.editReply({ content: active ? 'Poll Reopened!' : 'Poll Closed!' });
                }
            }

        } catch (err) {
            logger.error('Error in PollManager:', err);
            // Try to notify user
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: 'An error occurred.' });
                } else {
                    await interaction.reply({ content: 'An error occurred.', flags: MessageFlags.Ephemeral });
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
}
