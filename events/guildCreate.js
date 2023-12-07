const { chalk, log } = require('../util/logger');

module.exports = {
	name: 'guildCreate',
	once: false,
	execute(guild) {
		log(chalk`{magenta [ GUILD ADDED ]} "${guild.name}" [${guild.id}](${guild.memberCount}) at ${Date(Date.now())}`);
	},
};