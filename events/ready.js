const { Events } = require('discord.js');
const { chalk, log, logtable } = require('../util/logger');

	module.exports = {
		name: Events.ClientReady,
		once: true,
		execute(client) {
			log(chalk`{green ${client.user.id} Ready.}`);
			const guilds = client.guilds.cache.filter(guild => guild.memberCount > 1000);
			const tableData = guilds.map(guild => ({
				name: guild.name,
				id: guild.id,
				memberCount: guild.memberCount,
			}));
			tableData.sort((a, b) => b.memberCount - a.memberCount);
			logtable(tableData, ['name', 'id', 'memberCount']);
		},
	};