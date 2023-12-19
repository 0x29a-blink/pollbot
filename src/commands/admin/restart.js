const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const exec = require('child_process').exec;

module.exports = {

	data: new SlashCommandBuilder()
		.setName('restart')
		.setDescription('bot admin command.'),
	async execute(interaction) {
		if (interaction.member.id != '160853902726660096') {
			const gitNoPermEmbed = new EmbedBuilder()
				.setColor('#ff0000')
				.setTitle('NO PERMISSIONS')
				.setThumbnail('https://i.imgur.com/MsYPWMV.png')
				.setAuthor({
					name: 'blink.dclxvi',
					iconURL: 'https://i.imgur.com/C0ZRGdo.gif',
					url: 'https://twitch.tv/dotblink',
				})
				.setDescription('NO PERMISSION TO EXECUTE COMMAND, ADMIN COMMAND ONLY')
				.setFooter({
					text: 'Don\'t worry this does nothing for you.',
				});
			return interaction.reply({
				embeds: [gitNoPermEmbed],
			});
		}

        await interaction.reply({
            content: 'Restarting.',
        });

        try {
            exec('pm2 restart 0');
        } catch (err) {
            return interaction.reply({
                content: 'There was an error restarting the bot. Please go restart the process manually.',
                fetchReply: true,
                ephemeral: false,
            });
        }
	},
};