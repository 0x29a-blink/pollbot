const {
	Events,
	EmbedBuilder,
	PermissionsBitField,
} = require('discord.js');
const {
	query,
} = require('../db.js');
const locale = require('../localization/localization.json'),
	chalk = require('chalk'),
	log = console.log,
	logerr = console.error;

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction) {
		function getLocalization(property) {
			const selectedLocale = locale[interaction.locale] || locale['en-US'];
			return selectedLocale[property] || locale['en-US'][property];
		}
		if (interaction.customId === 'closepoll') {
			const pollExistsInDatabase = await query(`SELECT EXISTS(SELECT messageId FROM polls WHERE messageId=${interaction.message.id})`);

			if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild) && !interaction.member.roles.cache.some(role => role.name === 'Poll Manager')) {
				interaction.reply({
					content: getLocalization('memberNoPermsNoRole'),
					ephemeral: true,
				}).catch(err => {
					logerr(chalk`{red [ INTERACTION REPLY ERROR ]} {gray pollClose.js property: memberNoPermsNoRole}\n${err}\n{red [ END ]}`);
				});
				log(chalk`{yellow [ CLOSE POLL ATTEMPT ]} Server: {gray ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount})} Member: {gray ${interaction.member.displayName}[${interaction.member.id}]} tried to close the poll {gray ${interaction.message.id}}`);

				return 0;
			}

			if (!pollExistsInDatabase.rows[0].exists === true) {
				interaction.reply({
					content: getLocalization('noLongerExistsInDatabase'),
					ephemeral: true,
				}).catch(err => {
					logerr(chalk`{red [ INTERACTION REPLY ERROR ]} {gray pollClose.js property: noLongerExistsInDatabase}\n${err}\n{red [ END ]}`);
				});

				return 0;
			}

			try {
				const result = await query('SELECT * FROM polls WHERE messageId = $1 AND pollVoteUserId IS NULL ORDER BY pollVoteCount DESC', [interaction.message.id]),
					pollItemLoop = [],
					graphLoop = [];
				let graphTotalVotes = 0;

				for (let i = 0; i < result.rows.length; i++) {
					pollItemLoop.push(`${result.rows[i].pollitem}`);
					graphTotalVotes += parseInt(result.rows[i].pollvotecount);
				}

				for (let i = 0; i < result.rows.length; i++) {
					const percentage = (100 * result.rows[i].pollvotecount / graphTotalVotes),
						dotsCount = Math.max(0, Math.round(percentage / 10)),
						dots = '▮'.repeat(dotsCount),
						left = Math.max(0, 10 - dotsCount),
						empty = '▯'.repeat(left);
					graphLoop.push(`[${dots}${empty}] (${result.rows[i].pollvotecount}) ${percentage.toFixed(2)}%`);
				}

				const pollItem = pollItemLoop.toString().split(',').join('\r\n'),
					graph = graphLoop.toString().split(',').join('\r\n');

				const closePollEmbed = new EmbedBuilder()
					.setColor('#ff6633')
					.setTitle(`${interaction.message.embeds[0].title}`)
					.setDescription(`${interaction.message.embeds[0].description}`)
					.setURL('https://top.gg/bot/911731627498041374')
					.addFields({
						name: getLocalization('item'),
						value: pollItem,
						inline: true,
					})
					.addFields({
						name: getLocalization('results').replace('$1', graphTotalVotes),
						value: graph,
						inline: true,
					})
					.setFooter({
						text: getLocalization('pollClosedBy').replace('$1', interaction.member.displayName),
					})
					.setTimestamp();

				try {
					await interaction.update({
						embeds: [closePollEmbed],
						components: [],
					});
				} catch (error) {
					interaction.reply({
						content: getLocalization('pollCloseEmbedError'),
						ephemeral: true,
					}).catch(err => {
						logerr(chalk`{red [ INTERACTION REPLY ERROR ]} {gray pollClose.js property: pollCloseEmbedError}\n${err}\n{red [ END ]}`);
					});

					logerr(chalk`{red [ POLL CLOSE EMBED ERROR ]}\n${error}\n{red [ END ]}`);

					return 0;
				}

				await interaction.followUp({
					content: getLocalization('pollCloseSucess'),
					fetchReply: true,
					ephemeral: true,
				}).catch(err => {
					logerr(chalk`{red [ INTERACTION FOLLOW UP ERROR ]} {gray pollClose.js property: pollCloseSucess}\n${err}\n{red [ END ]}`);
				});
			} catch (error) {
				console.error(error);

				return 0;
			}

			try {
				query('DELETE FROM polls WHERE messageId = $1', [interaction.message.id]);
			} catch (error) {
				interaction.followUp({
					content: getLocalization('errorUpdatingDatabase'),
					ephemeral: true,
				}).catch(err => {
					logerr(chalk`{red [ INTERACTION FOLLOW UP ERROR ]} {gray pollClose.js property: errorUpdatingDatabase}\n${err}\n{red [ END ]}`);
				});
				logerr(chalk`{red [ COULD NOT DETE POLL DATA ]}\n${error}\n{red [ END ]}`);

				return 0;
			}
			log(chalk`{blue [ CLOSE POLL ]} Server: {gray ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount})} Member: {gray ${interaction.member.displayName}[${interaction.member.id}]} closed the poll {gray ${interaction.message.id}}`);
		}
	},
};