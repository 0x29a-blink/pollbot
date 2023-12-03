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
		if (userHasVoted.rows[0].exists === false) return 0;


		const userChoice = interaction.values[0];
		const originalChoice = await query(`SELECT pollVoteUserItem FROM polls WHERE messageId=${interaction.message.id} AND pollVoteUserId=${interaction.member.id}`);

		if (userChoice == originalChoice.rows[0].pollvoteuseritem) {
			return interaction.reply({
				content: getLocalization('pollChoiceSelected').replace('$1', userChoice),
				ephemeral: true,
			});
		}

		await interaction.deferUpdate();

		try {
			await query('UPDATE polls SET pollVoteCount = CASE WHEN pollItem = $1 THEN pollVoteCount + 1 WHEN pollItem = $2 THEN pollVoteCount - 1 END WHERE pollItem IN ($1, $2);', [userChoice, originalChoice.rows[0].pollvoteuseritem]);
			await query('UPDATE polls SET pollVoteUserItem = $1 WHERE pollVoteUserId = $2;', [userChoice, interaction.member.id]);
			await query('UPDATE polls SET lastInteraction = $1', [moment().format('MM-DD-YYYY HH:mm:ss')]);
		} catch (error) {
			interaction.followUp({
				content: getLocalization('errorUpdatingDatabase'),
				ephemeral: true,
			});
			console.error(`[ [1;31mPOLL INTERACT ERROR[0m ] Database error in the update user option section.\n${error}\n [1;35mERROR END[0m`);

			return 0;
		}


		const pollIsPublic = await query(`SELECT pollViewVotesFlag FROM polls WHERE messageId=${interaction.message.id} LIMIT 1`);
		if (pollIsPublic.rows[0].pollviewvotesflag === false) {
			await interaction.followUp({
					content: getLocalization('changedVote').replace(/\$1/g, await originalChoice.rows[0].pollvoteuseritem).replace(/\$2/g, userChoice),
					fetchReply: true,
					ephemeral: true,
				})
				.catch(console.error);
			console.log(`[ [1;34mPoll Interact Info[0m ] saved ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}]s new choice of "${await originalChoice.rows[0].pollvoteuseritem}" to "${userChoice}". to ${interaction.message.id}.`);

			return 0;
		}


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

		const publicPollUpdateVoteEmbed = new EmbedBuilder()
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
				embeds: [publicPollUpdateVoteEmbed],
			});
		} catch (error) {
			interaction.followUp({
				content: getLocalization('publicPollUpdateVoteEmbedError'),
				ephemeral: true,
			});
			console.error(`[ [1;31mUPDATE POLL ERROR[0m ] There was an issue sending the publicPollUpdateVote embed.\n ${error}`);
		}

		await interaction.followUp({
				content: getLocalization('changedVote').replace(/\$1/g, originalChoice.rows[0].pollvoteuseritem).replace(/\$2/g, userChoice),
				ephemeral: true,
			})
			.catch(console.error);
		console.log(`[ [1;34mPoll Interact Info[0m ] saved ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}]s new choice of "${originalChoice.rows[0].pollvoteuseritem}" to "${userChoice}" to ${interaction.message.id}.`);
	},
};