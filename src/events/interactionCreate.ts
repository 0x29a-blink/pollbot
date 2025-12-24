import { Events, Interaction } from 'discord.js';
import { ExtendedClient } from '../index';

export default {
    name: Events.InteractionCreate,
    async execute(interaction: Interaction) {
        if (!interaction.isChatInputCommand()) return;

        const client = interaction.client as ExtendedClient;
        const command = client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error: any) {
            console.error(`Error executing ${interaction.commandName}`);
            console.error(error);

            // Check for Missing Permissions to handle gracefully
            if (error.code === 50013) { // Missing Permissions
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: 'I am missing permissions to perform this action! Please check my role permissions.', ephemeral: true });
                } else {
                    await interaction.reply({ content: 'I am missing permissions to perform this action! Please check my role permissions.', ephemeral: true });
                }
                return;
            }

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
            } else {
                await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
            }
        }
    },
};
