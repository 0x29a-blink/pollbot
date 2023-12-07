const { SlashCommandBuilder } = require('@discordjs/builders');
const { ActionRowBuilder, EmbedBuilder, ButtonBuilder } = require('discord.js');

const locale = require('../../localization/localization.json');
function createLocalizations(property) {
	return Object.fromEntries(Object.entries(locale).map(([key, value]) => [key, value[property]]));
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('help')
		.setNameLocalizations(createLocalizations('helpCommandName'))
		.setDescription('Information on creating votes / helpful links.')
		.setDescriptionLocalizations(createLocalizations('helpCommandDescription')),
	async execute(interaction) {
		function getLocalization(property) {
            const selectedLocale = locale[interaction.locale] || locale['en-US'];
            return selectedLocale[property] || locale['en-US'][property];
        }
		const button = new ActionRowBuilder()
			.addComponents(
				new ButtonBuilder()
				.setLabel(getLocalization('helpLabel1'))
				.setURL('https://discord.gg/hUge5epA')
				.setStyle('Link'),
				new ButtonBuilder()
				.setLabel(getLocalization('helpLabel2'))
				.setURL('https://github.com/0x29a-blink/pollbot')
				.setStyle('Link'),

				new ButtonBuilder()
				.setLabel(getLocalization('helpLabel3'))
				.setURL('https://ko-fi.com/0x29a')
				.setStyle('Link'),
			);
		const embed = new EmbedBuilder()
			.setColor('#ff6633')
			.setTitle(getLocalization('helpTitle'))
			.setThumbnail('https://i.imgur.com/MsYPWMV.png')
			.setAuthor({ name: 'blink.dclxvi', iconURL: 'https://i.imgur.com/C0ZRGdo.gif', url: 'https://twitch.tv/dotblink' })
			.setDescription(getLocalization('helpDescription'));
		return interaction.reply({
			embeds: [embed],
			components: [button],
		});
	},
};