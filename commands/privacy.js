const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageEmbed, } = require('discord.js');
const chalk = require('chalk');

module.exports = {

	data: new SlashCommandBuilder()
		.setDefaultPermission(true)
		.setName('privacy')
		.setDescription('privacy stuff'),
	async execute(interaction) {
		const embed = new MessageEmbed()
			.setColor('#ff6633')
			.setTitle('Privacy Policy')
			.setThumbnail(`https://i.imgur.com/MsYPWMV.png`)
			.setAuthor('blink#0140', 'https://i.imgur.com/C0ZRGdo.gif', 'https://twitch.tv/dotblink')
			.setDescription(`\`\`\`What Information Is Stored?\`\`\`messageId, guildName, guildId, channelName, channelId, userName, userId, pollTitle, pollDescription, and pollItems\`\`\`Why we store the information and how we use it.\`\`\`All of the information we store is for the functionality of the bot and for future feature additions. The main use of the information stored is to validate votes between users so there's no duplication of votes in the poll. \n\nThe bot is open source and can be viewed by anyone on [the github for the bot](https://github.com/0x29a-blink/pollbot) \`\`\`How can I contact you for removal of my data?\`\`\`Via our [support discord](https://discord.gg/hUge5epA) and creating a ticket there.`)
			.setFooter('All of this data is temporary and is immediately removed upon the closing of the poll or after 1 month of poll inactivity.')
		console.log(`${chalk.magenta('+ cmd run:')} privacy / ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}]`);
		return interaction.reply({
			embeds: [embed]
		});
	},
};