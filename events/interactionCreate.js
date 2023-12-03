const {
	Events,
} = require('discord.js');
const chalk = require('chalk'),
	logerr = console.error;

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction) {
		if (!interaction.isChatInputCommand()) return;

		const command = interaction.client.commands.get(interaction.commandName);

		if (!command) {
			console.error(`No command matching ${interaction.commandName} was found.`);
			return;
		}

		try {
			await command.execute(interaction);
		} catch (error) {
			logerr(chalk`{red Error Executing ${interaction.commandName}}`);
			logerr(error);
		}
	},
};