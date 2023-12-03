const chalk = require('chalk'),
	log = console.log;

module.exports = {
	name: 'guildCreate',
	once: false,
	execute(guild) {
		log(chalk`{magenta [ GUILD ADDED ]} "${guild.name}" [${guild.id}](${guild.memberCount}) at ${Date(Date.now())}`);
	},
};