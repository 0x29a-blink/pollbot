import { ContextMenuCommandBuilder, ApplicationCommandType, MessageContextMenuCommandInteraction } from 'discord.js';
import { handleViewPoll } from './view';

export const data = new ContextMenuCommandBuilder()
    .setName('View Data')
    .setType(ApplicationCommandType.Message);

export async function execute(interaction: MessageContextMenuCommandInteraction) {
    if (!interaction.isMessageContextMenuCommand()) return;

    // Check if the message is a poll from this bot
    // We can assume if the user clicked it, they want to try.
    // Ideally we check if it is a poll by database check, but handleViewPoll does that.

    // We only want to run this on messages that are actually polls.
    // Depending on bot logic, we might check if author is bot or if it has specific embed.
    // For now, pass to handleViewPoll which checks DB.

    await handleViewPoll(interaction, interaction.targetId);
}
