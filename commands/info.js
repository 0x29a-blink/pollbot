const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, } = require('discord.js');
var { open } = require('sqlite');
var sqlite3 = require('sqlite3').verbose();
const chalk = require('chalk');

module.exports = {
	data: new SlashCommandBuilder()
		.setDefaultPermission(true)
		.setName('info')
		.setDescription('information / stats about bot'),
	async execute(interaction) {
		(async () => {
			const db = await open({
				filename: './data/main.db',
				driver: sqlite3.Database
			})

			let totalPolls = await db.get('SELECT Count FROM Info WHERE rowid = 1');
			let totalVotes = await db.get('SELECT Count FROM Info WHERE rowid = 2');
			const embed = new MessageEmbed()
				.setColor('#ff6633')
				.setTitle('Information')
				.setThumbnail(`https://i.imgur.com/MsYPWMV.png`)
				.setAuthor('blink#0140', 'https://i.imgur.com/C0ZRGdo.gif', 'https://twitch.tv/dotblink')
				.setURL(`https://statcord.com/bot/911731627498041374`)

				.addField('Total Polls Created', `${JSON.stringify(totalPolls.Count)}`, true)
				.addField('Total Votes', `${JSON.stringify(totalVotes.Count)}`, true)
				.addField('API Latency', `${Math.round(interaction.client.ws.ping)}`, true)

				.addField('Guild Count', `${interaction.client.guilds.cache.size}`, true)

				.setFooter('i\'m a horrible programmer')
				.setTimestamp()
			console.log(`${chalk.magenta('+ cmd run:')} info / ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}]`);
			return interaction.reply({
				embeds: [embed]
			});
		})()
	},
};