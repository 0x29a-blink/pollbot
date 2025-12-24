import { Interaction, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, MessageFlags, AttachmentBuilder, GuildMember, PermissionsBitField, ChatInputCommandInteraction, ButtonInteraction } from 'discord.js';
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
                return interaction.reply({ content: 'Poll not found in database.', flags: MessageFlags.Ephemeral });
            }

            // 2. Auth Check
            const userId = interaction.user.id;
            const member = interaction.member as GuildMember;
            const isAdmin = member?.permissions.has(PermissionsBitField.Flags.ManageGuild);
            const isPollManager = member?.roles.cache.some(r => r.name === 'Poll Manager');
            const isCreator = pollData.creator_id === userId;

            if (!isCreator && !isAdmin && !isPollManager) {
                return interaction.reply({ content: 'Only the creator or a Poll Manager can manage this poll.', flags: MessageFlags.Ephemeral });
            }

            // 3. Update Database
            const { error: updateError } = await supabase
                .from('polls')
                .update({ active: active })
                .eq('message_id', pollId);

            if (updateError) {
                logger.error('Failed to update poll state:', updateError);
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

            const imageBuffer = await Renderer.renderPoll({
                title: pollData.title,
                description: pollData.description,
                options: pollData.options,
                votes: counts,
                totalVotes: totalVotes,
                creator: creatorTag,
                closed: !active
            });

            const attachment = new AttachmentBuilder(imageBuffer, { name: 'poll.png' });

            // 5. Update Components
            const components: ActionRowBuilder<any>[] = [];

            if (active) {
                // ACTIVE: Select Menu + Close Button (if enabled)
                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('poll_vote')
                    .setPlaceholder('Select an option to vote')
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
                    // We should verify if guild settings override this?
                    // The user requested: "add server config options... so the user can opt to have the buttons"
                    // So we should verify guild_settings too.
                    // But strictly, pollData.settings.allow_close was set at creation.
                    // A global toggle might imply overriding even existing polls?
                    // Usually config applies to NEW polls or we check config here LIVE.
                    // Let's check config LIVE if possible, or stick to poll settings.
                    // Ideally, check `guild_settings` here.

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

            // If called from a Button, we update the message directly via interaction.update if we can?
            // BUT this shared function might be called from Slash Command (/close).
            // Slash Command: interaction.editReply (if deferred) or interaction.reply.
            // But we need to update the ORIGINAL poll message, NOT the interaction reply!
            // The `interaction` passed here is the Command interaction or Button interaction.

            // If ButtonInteraction: `interaction.message` is the poll message.
            // If ChatInputCommandInteraction: We have `pollId` (messageId). We need to fetch the message.

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
                return interaction.reply({ content: 'Could not find the poll message to update.', flags: MessageFlags.Ephemeral });
            }

            // Interaction Response
            if (interaction.isButton()) {
                // We typically use update() or deferUpdate() for buttons if we edited the message already?
                // Actually `message.edit` works.
                // We should just followUp.
                // Or `interaction.update` if we didn't use `message.edit`.
                // Since we used `message.edit`, we should `deferUpdate` or `reply`.
                // Let's assume we reply to confirm action.
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
                if (!interaction.replied) await interaction.reply({ content: 'An error occurred.', flags: MessageFlags.Ephemeral });
            } catch { }
        }
    }
}
