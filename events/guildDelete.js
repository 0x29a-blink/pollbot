const chalk = require('chalk'),
	log = console.log;

module.exports = {
	name: 'guildDelete',
	once: false,
	execute(guild) {
		log(chalk`{magenta [ GUILD REMOVED ]} "${guild.name}" [${guild.id}](${guild.memberCount}) at ${Date(Date.now())}`);
	},
};