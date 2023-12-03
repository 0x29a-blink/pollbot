const { Events, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { query } = require('../db.js');
const locale = require('../localization/localization.json');

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
					})
					.catch(console.error);
				console.log(`[ [1;34mPoll Interact Info[0m ] ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}] tried to close the poll "${interaction.message.id}"`);

				return 0;
			}

			if (!pollExistsInDatabase.rows[0].exists === true) {
				interaction.reply({
						content: getLocalization('noLongerExistsInDatabase'),
						ephemeral: true,
					})
					.catch(console.error);

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
					const dots = '▮'.repeat(Math.round((100 * result.rows[i].pollvotecount / graphTotalVotes) / 10)),
						left = 10 - (Math.round((100 * result.rows[i].pollvotecount / graphTotalVotes) / 10)),
						empty = '▯'.repeat(left);
					graphLoop.push(`[${dots}${empty}] (${result.rows[i].pollvotecount}) ${(100 * result.rows[i].pollvotecount / graphTotalVotes).toFixed(2)}%`);
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
					});

					console.error(`[ [1;31mUPDATE POLL ERROR[0m ] There was an issue sending the closePoll embed.\n ${error}`);

					return 0;
				}

				await interaction.followUp({
						content: getLocalization('pollCloseSucess'),
						fetchReply: true,
						ephemeral: true,
					})
					.catch(console.error);
			} catch (error) {
				console.error(error);

				return 0;
			}

			try {
				query('DELETE FROM polls WHERE messageId = $1', [interaction.message.id]);
			} catch (error) {
				interaction.reply({
					content: getLocalization('errorUpdatingDatabase'),
					ephemeral: true,
				});
				console.error(`[ [1;31mDISPLAY POLLING DATA ERROR[0m ]\n${error}\n [1;35mERROR END[0m`);

				return 0;
			}
			console.log(`[ [1;34mPoll Button Info[0m ] ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) / ${interaction.member.displayName}[${interaction.member.id}] closed the poll ${interaction.message.id}.`);
		}
	},
};