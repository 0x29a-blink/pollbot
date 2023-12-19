const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');

const locale = require('../../localization/localization.json');
function createLocalizations(property) {
    return Object.fromEntries(Object.entries(locale).map(([key, value]) => [key, value[property]]));
}

module.exports = {

	data: new SlashCommandBuilder()
		.setName('privacy')
        .setNameLocalizations(createLocalizations('privacyCommandName'))
		.setDescription('privacy stuff')
        .setDescriptionLocalizations(createLocalizations('privacyCommandDescription')),
	async execute(interaction) {
		function getLocalization(property) {
            const selectedLocale = locale[interaction.locale] || locale['en-US'];
            return selectedLocale[property] || locale['en-US'][property];
        }
		const embed = new EmbedBuilder()
			.setColor('#ff6633')
			.setTitle(getLocalization('privacyTitle'))
			.setThumbnail('https://i.imgur.com/MsYPWMV.png')
			.setAuthor({ name: 'blink.dclxvi', iconURL: 'https://i.imgur.com/C0ZRGdo.gif', url: 'https://twitch.tv/dotblink' })
			.setDescription(getLocalization('privacyDescription'))
			.setFooter({ text: getLocalization('privacyFooter') });
		return interaction.reply({
			embeds: [embed],
		});
	},
};