const {
	Events,
} = require('discord.js');
const chalk = require('chalk'),
	log = console.log;

module.exports = {
	name: Events.ClientReady,
	once: true,
	execute(client) {
		log(chalk`{green ${client.user.id} Ready.}`);
	},
};