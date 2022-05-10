const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, } = require('discord.js');
const chalk = require('chalk');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('server')
		.setDescription('Display info about this server.'),
	async execute(interaction) {

		const embed = new MessageEmbed()
			.setColor('#ff6633')
			.setTitle('Server Information')
			.setURL(interaction.guild.iconURL())
			.setThumbnail(`${interaction.guild.iconURL({dynamic: true,})}`)
			.addField('Name', `${interaction.guild.name}`, true)
			.addField('Owner', `<@${interaction.guild.ownerId}>`, true)
			.addField('Member Count', `${interaction.guild.memberCount}`, true)

			.addField('\u200B', `\u200B`)

			.addField('Boost Count', `${interaction.guild.premiumSubscriptionCount}`, true)
			.addField('Partnered', `${interaction.guild.partnered}`, true)
			.addField('Preferred Locale', `${interaction.guild.preferredLocale}`, true)

			.addField('\u200B', `\u200B`)

			.addField('Splash Image URL', `${interaction.guild.splashURL()}`, true)
			.addField('Discovery Splash Image URL', `${interaction.guild.discoverySplashURL()}`, true)

			.setTimestamp(interaction.guild.createdAt)

		console.log(`${chalk.magenta('+ cmd run:')} server / ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}]`);
		return interaction.reply({
			embeds: [embed]
		});
	},
};