const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { query } = require('../../db.js');
const os = require('os');
const moment = require('moment');

const locale = require('../../localization/localization.json');
function createLocalizations(property) {
  return Object.fromEntries(Object.entries(locale).map(([key, value]) => [key, value[property]]));
}
const pluralize = (value, word) => value === 1 ? `${value} ${word}` : `${value} ${word}s`;

const formatDuration = (uptime, unit = 'milliseconds') => {
  const duration = moment.duration(unit === 'seconds' ? uptime * 1000 : uptime);

  const months = duration.months();
  const days = duration.days();
  const hours = duration.hours();
  const minutes = duration.minutes();
  const seconds = duration.seconds();

  const formattedDuration = [
    pluralize(months, 'month'),
    pluralize(days, 'day'),
    pluralize(hours, 'hour'),
    pluralize(minutes, 'minute'),
    pluralize(seconds, 'second'),
  ].join(', ');

  return formattedDuration;
};

module.exports = {
	data: new SlashCommandBuilder()
		.setName('info')
		.setNameLocalizations(createLocalizations('infoCommandName'))
		.setDescription('Information and stats about Simple Poll Bot')
		.setDescriptionLocalizations(createLocalizations('infoCommandDescription')),
	async execute(interaction) {
		function getLocalization(property) {
            const selectedLocale = locale[interaction.locale] || locale['en-US'];
            return selectedLocale[property] || locale['en-US'][property];
        }
		const totalPolls = await query('SELECT pollsCreated FROM botInfo WHERE name = \'main\''),
			totalVotes = await query('SELECT votesMade FROM botInfo WHERE name = \'main\''),
			guildCount = await interaction.client.shard.fetchClientValues('guilds.cache.size').then(results => {return `${results.reduce((acc, gC) => acc + gC, 0)}`;}).catch(console.error),
			uptimes = await interaction.client.shard.fetchClientValues('uptime');

		const embed = new EmbedBuilder()
			.setColor('#ff6633')
			.setTitle(getLocalization('infoTitle'))
			.setDescription(getLocalization('translators').replace('$1', '\nFrench / Français: <@338695805504454668>\n Polish / Polski: <@343825878448340994>'))
			.setThumbnail('https://i.imgur.com/MsYPWMV.png')
			.setAuthor({ name: 'blink.dclxvi', iconURL: 'https://i.imgur.com/C0ZRGdo.gif', url: 'https://twitch.tv/dotblink' })
			.setURL('https://github.com/0x29a-blink/pollbot')

			.addFields({
				name: getLocalization('infoFieldTotalPollsCreated'),
				value: `${JSON.stringify(totalPolls.rows[0].pollscreated)}`,
				inline: true,
			})
			.addFields({
				name: getLocalization('infoFieldTotalVotes'),
				value: `${JSON.stringify(totalVotes.rows[0].votesmade)}`,
				inline: true,
			})
			.addFields({
				name: getLocalization('infoFieldGuildCount'),
				value: `${guildCount}`,
				inline: true,
			})
			.addFields({
				name: getLocalization('infoFieldBotUptime'),
				value: `${uptimes.map((item, index) => `Shard #${index + 1}: ${formatDuration(item, 'miliseconds')}`).join('\n\n')}`,
				inline: true,
			})
			.addFields({
				name: getLocalization('infoFieldServerUptime'),
				value: `${formatDuration(os.uptime(), 'seconds')}`,
				inline: true,
			})
			.addFields({
				name: getLocalization('infoFieldApiLatency'),
				value: `${Math.round(interaction.client.ws.ping)}`,
				inline: true,
			})

			.setTimestamp();
		return interaction.reply({
			embeds: [embed],
		});
	},
};