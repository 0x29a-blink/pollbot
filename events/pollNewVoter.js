const { Events, EmbedBuilder } = require('discord.js');
const moment = require('moment');
const { query } = require('../db.js');
const locale = require('../localization/localization.json');


module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction) {
		function getLocalization(property) {
			const selectedLocale = locale[interaction.locale] || locale['en-US'];
			return selectedLocale[property] || locale['en-US'][property];
		}
		if (interaction.customId != 'poll') return 0;

		const pollExistsInDatabase = await query(`SELECT EXISTS(SELECT messageId FROM polls WHERE messageId=${interaction.message.id})`);
		if (!pollExistsInDatabase.rows[0].exists === true) {
			interaction.reply({
					content: getLocalization('noLongerExistsInDatabase'),
					ephemeral: true,
				})
				.catch(console.error);

			return 0;
		}

		const userHasVoted = await query(`SELECT EXISTS(SELECT pollVoteUserId FROM polls WHERE messageId=${interaction.message.id} AND pollVoteUserId=${interaction.member.id})`);
		if (userHasVoted.rows[0].exists === true) return 0;

		const userChoice = interaction.values[0];
		await interaction.deferUpdate();

		try {
			await query('INSERT INTO polls (messageId, pollVoteUserName, pollVoteUserId, pollVoteUserItem) VALUES($1, $2, $3, $4)', [interaction.message.id, interaction.member.displayName, interaction.member.id, userChoice]);
			await query('UPDATE polls SET pollVoteCount = pollVoteCount + 1 WHERE messageId=$1 AND pollItem=$2', [interaction.message.id, userChoice]);
			await query('UPDATE polls SET lastInteraction = $1', [moment().format('MM-DD-YYYY HH:mm:ss')]);
			await query('UPDATE botInfo SET votesMade = votesMade + 1 WHERE name=\'main\'');
		} catch (error) {
			await interaction.followUp({
				content: getLocalization('errorUpdatingDatabase'),
				ephemeral: true,
			});
			console.error(`[ [1;31mPOLL INTERACTION DATABASE ERROR[0m ] Create user option section. (pollNewVoter.js LN: 50)\n${error}\n [1;35mERROR END[0m`);

			return 0;
		}

		const pollIsPublic = await query(`SELECT pollViewVotesFlag FROM polls WHERE messageId=${interaction.message.id} LIMIT 1`);
		if (pollIsPublic.rows[0].pollviewvotesflag === false) {
			await interaction.followUp({
				content: getLocalization('pollChoiceSelected').replace('$1', [userChoice]),
				ephemeral: true,
			}).catch(err => {
				console.error('Could not send the interaction.followUp for the non-public new user vote. Err: ' + err);
			});
			console.log(`[ [1;34mPoll Interact Info[0m ] saved ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}]s choice of "${userChoice}" to ${interaction.message.id}. [1;31mNot Public Poll[0m`);

			return 0;
		}

		console.log(`[ [1;34mPoll Interact Info[0m ] saved ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}]s choice of "${userChoice}" to ${interaction.message.id}. [1;31mPublic Poll[0m`);
		const result = await query('SELECT * FROM polls WHERE messageId = $1 AND pollVoteUserId IS NULL ORDER BY pollVoteCount DESC', [interaction.message.id]);

		const pollItemLoop = [],
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

		const publicPollNewVoteEmbed = new EmbedBuilder()
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
			});

		try {
			await interaction.editReply({
				embeds: [publicPollNewVoteEmbed],
			});
		} catch (error) {
			await interaction.followUp({
				content: getLocalization('publicPollUpdateVoteEmbedError'),
				ephemeral: true,
			});

			console.error(`[ [1;31mUPDATE POLL ERROR[0m ] There was an issue sending the publicPollNewVoteEmbed embed.\n ${error}\n[ [1;31mEND[0m ]`);
		}

		await interaction.followUp({
			content: getLocalization('pollChoiceSelected').replace('$1', userChoice),
			ephemeral: true,
		});
	},
};