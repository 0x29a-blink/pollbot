require('dotenv').config();
const { Client, Collection, EmbedBuilder, Events, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const pool = require('./db.js');
const locale = require('./localization/localization.json');
const fs = require('node:fs');
const path = require('node:path');
const moment = require('moment');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);
for (const folder of commandFolders) {
	const commandsPath = path.join(foldersPath, folder);
	const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const command = require(filePath);
		if ('data' in command && 'execute' in command) {
			client.commands.set(command.data.name, command);
		} else {
			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
}
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
for (const file of eventFiles) {
	const filePath = path.join(eventsPath, file);
	const event = require(filePath);
	if (event.once) {
		client.once(event.name, (...args) => event.execute(...args));
	} else {
		client.on(event.name, (...args) => event.execute(...args));
	}
}

client.on(Events.InteractionCreate, async interaction => {

	// add implementation for monthly poll too-old clearing.

	async function displayPollingData(scenario, firstChoice, newChoice, interact) {
		const result = await pool.query('SELECT * FROM polls WHERE messageId = $1 AND pollVoteUserId IS NULL ORDER BY pollVoteCount DESC', [interact.message.id]),
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

		switch (scenario) {
			case scenario = 'publicPollUpdateVote': {
				const publicPollUpdateVoteEmbed = new EmbedBuilder()
					.setColor('#ff6633')
					.setTitle(`${interact.message.embeds[0].title}`)
					.setDescription(`${interact.message.embeds[0].description}`)
					.setURL('https://top.gg/bot/911731627498041374')
					.addFields({
						name: locale[interact.locale].item,
						value: pollItem,
						inline: true,
					})
					.addFields({
						name: locale[interact.locale].results.replace('$1', graphTotalVotes),
						value: graph,
						inline: true,
					});

				try {
					await interact.update({
						embeds: [publicPollUpdateVoteEmbed],
					});
				} catch (error) {
					interact.reply({
						content: locale[interact.locale].publicPollUpdateVoteEmbedError,
						ephemeral: true,
					});
					console.error(`[ [1;31mUPDATE POLL ERROR[0m ] There was an issue sending the publicPollUpdateVote embed.\n ${error}`);
				}

				await interact.followUp({
						content: locale[interact.locale].changedVote.replace(/\$1/g, firstChoice).replace(/\$2/g, newChoice),
						fetchReply: true,
						ephemeral: true,
					})
					.catch(console.error);
				console.log(`[ [1;34mPoll Interact Info[0m ] saved ${interact.guild.name}[${interact.guild.id}](${interact.guild.memberCount}) ${interact.member.displayName}[${interact.member.id}]s new choice of "${firstChoice}" to "${newChoice}" to ${interaction.message.id}.`);
				break;
			}

			case scenario = 'publicPollNewVote': {
				const publicPollNewVoteEmbed = new EmbedBuilder()
					.setColor('#ff6633')
					.setTitle(`${interact.message.embeds[0].title}`)
					.setDescription(`${interact.message.embeds[0].description}`)
					.setURL('https://top.gg/bot/911731627498041374')
					.addFields({
						name: locale[interact.locale].item,
						value: pollItem,
						inline: true,
					})
					.addFields({
						name: locale[interact.locale].results.replace('$1', graphTotalVotes),
						value: graph,
						inline: true,
					});

				try {
					await interact.update({
						embeds: [publicPollNewVoteEmbed],
					});
				} catch (error) {
					interact.reply({
						content: locale[interact.locale].publicPollNewVoteEmbedError,
						ephemeral: true,
					});

					console.error(`[ [1;31mUPDATE POLL ERROR[0m ] There was an issue sending the publicPollNewVote embed.\n ${error}`);
				}

				await interact.followUp({
						content: locale[interact.locale].pollChoiceSelected.replace('$1', newChoice),
						fetchReply: true,
						ephemeral: true,
					})
					.catch(console.error);
				console.log(`[ [1;34mPoll Interact Info[0m ] saved ${interact.guild.name}[${interact.guild.id}](${interact.guild.memberCount}) ${interact.member.displayName}[${interact.member.id}]s choice of "${newChoice}" to ${interaction.message.id}.`);
				break;
			}

			case scenario = 'closePoll': {

				const closePollEmbed = new EmbedBuilder()
					.setColor('#ff6633')
					.setTitle(`${interact.message.embeds[0].title}`)
					.setDescription(`${interact.message.embeds[0].description}`)
					.setURL('https://top.gg/bot/911731627498041374')
					.addFields({
						name: locale[interact.locale].item,
						value: pollItem,
						inline: true,
					})
					.addFields({
						name: locale[interact.locale].results.replace('$1', graphTotalVotes),
						value: graph,
						inline: true,
					})
					.setFooter({
						text: locale[interact.locale].pollClosedBy.replace('$1', interact.member.displayName),
					})
					.setTimestamp();

				try {
					await interact.update({
						embeds: [closePollEmbed],
						components: [],
					});
				} catch (error) {
					interact.reply({
						content: locale[interact.locale].pollCloseEmbedError,
						ephemeral: true,
					});

					console.error(`[ [1;31mUPDATE POLL ERROR[0m ] There was an issue sending the closePoll embed.\n ${error}`);

					return 0;
				}

				await interact.followUp({
						content: locale[interact.locale].pollCloseSucess,
						fetchReply: true,
						ephemeral: true,
					})
					.catch(console.error);
				break;
			}
		}
	}

	if (interaction.customId === 'poll') {
		const userChoice = interaction.values[0];
		const pollIsPublic = await pool.query(`SELECT pollViewVotesFlag FROM polls WHERE messageId=${interaction.message.id} LIMIT 1`);
		const userHasVoted = await pool.query(`SELECT EXISTS(SELECT pollVoteUserId FROM polls WHERE messageId=${interaction.message.id} AND pollVoteUserId=${interaction.member.id})`);
		const pollExistsInDatabase = await pool.query(`SELECT EXISTS(SELECT messageId FROM polls WHERE messageId=${interaction.message.id})`);


		if (!pollExistsInDatabase.rows[0].exists === true) {
			interaction.reply({
					content: locale[interaction.locale].noLongerExistsInDatabase,
					ephemeral: true,
				})
				.catch(console.error);

			return 0;
		}

		if (userHasVoted.rows[0].exists === true) {
			const originalChoice = await pool.query(`SELECT pollVoteUserItem FROM polls WHERE messageId=${interaction.message.id} AND pollVoteUserId=${interaction.member.id}`);

			try {
				await pool.query('UPDATE polls SET pollVoteCount = CASE WHEN pollItem = $1 THEN pollVoteCount + 1 WHEN pollItem = $2 THEN pollVoteCount - 1 END WHERE pollItem IN ($1, $2);', [userChoice, originalChoice.rows[0].pollvoteuseritem]);
				await pool.query('UPDATE polls SET pollVoteUserItem = $1 WHERE pollVoteUserId = $2;', [userChoice, interaction.member.id]);
				await pool.query('UPDATE polls SET lastInteraction = $1', [moment().format('MM-DD-YYYY HH:mm:ss')]);
			} catch (error) {
				interaction.reply({
					content: locale[interaction.locale].errorUpdatingDatabase,
					ephemeral: true,
				});
				console.error(`[ [1;31mPOLL INTERACT ERROR[0m ] Database error in the update user option section.\n${error}\n [1;35mERROR END[0m`);

				return 0;
			}
			if (pollIsPublic.rows[0].pollviewvotesflag === true) {
				try {
					await displayPollingData('publicPollUpdateVote', originalChoice.rows[0].pollvoteuseritem, userChoice, interaction);
				} catch (error) {
					interaction.reply({
						content: locale[interaction.locale].errorUpdatingDatabase,
						ephemeral: true,
					});
					console.error(`[ [1;31mDISPLAY POLLING DATA ERROR[0m ]\n${error}\n [1;35mERROR END[0m`);
				}

				return 0;
			}

			await interaction.reply({
					content: locale[interaction.locale].changedVote.replace(/\$1/g, originalChoice.rows[0].pollvoteuseritem).replace(/\$2/g, userChoice),
					fetchReply: true,
					ephemeral: true,
				})
				.catch(console.error);
			console.log(`[ [1;34mPoll Interact Info[0m ] saved ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}]s new choice of "${originalChoice.rows[0].pollvoteuseritem}" to "${userChoice}". to ${interaction.message.id}.`);

			return 0;
		}

		// User has not voted

		try {
			await pool.query(`INSERT INTO polls (messageId, pollVoteUserName, pollVoteUserId, pollVoteUserItem) VALUES(${interaction.message.id}, $1, ${interaction.member.id}, $2)`, [interaction.member.displayName, userChoice]);
			await pool.query(`UPDATE polls SET pollVoteCount = pollVoteCount + 1 WHERE messageId=${interaction.message.id} AND pollItem=$1`, [userChoice]);
			await pool.query('UPDATE polls SET lastInteraction = $1', [moment().format('MM-DD-YYYY HH:mm:ss')]);
			await pool.query('UPDATE botInfo SET votesMade = votesMade + 1 WHERE name=\'main\'');
		} catch (error) {
			interaction.reply({
				content: locale[interaction.locale].errorUpdatingDatabase,
				ephemeral: true,
			});
			console.error(`[ [1;31mPOLL INTERACT ERROR[0m ] Database error in the create user option section.\n${error}\n [1;35mERROR END[0m`);

			return 0;
		}

		if (pollIsPublic.rows[0].pollviewvotesflag === true) {
			try {
				await displayPollingData('publicPollNewVote', null, userChoice, interaction);
			} catch (error) {
				interaction.reply({
					content: locale[interaction.locale].errorUpdatingDatabase,
					ephemeral: true,
				});
				console.error(`[ [1;31mDISPLAY POLLING DATA ERROR[0m ]\n${error}\n [1;35mERROR END[0m`);
			}

			return 0;
		}
		await interaction.reply({
				content: locale[interaction.locale].pollChoiceSelected.replace('$1', [userChoice]),
				fetchReply: true,
				ephemeral: true,
			})
			.catch(console.error);
		console.log(`[ [1;34mPoll Interact Info[0m ] saved ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}]s choice of "${userChoice}" to ${interaction.message.id}.`);
	}

	if (interaction.customId === 'closepoll') {
		const pollExistsInDatabase = await pool.query(`SELECT EXISTS(SELECT messageId FROM polls WHERE messageId=${interaction.message.id})`);

		if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild) && !interaction.member.roles.cache.some(role => role.name === 'Poll Manager')) {
			interaction.reply({
					content: locale[interaction.locale].memberNoPermsNoRole,
					ephemeral: true,
				})
				.catch(console.error);
			console.log(`[ [1;34mPoll Interact Info[0m ] ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}] tried to close the poll "${interaction.message.id}"`);

			return 0;
		}

		if (!pollExistsInDatabase.rows[0].exists === true) {
			interaction.reply({
					content: locale[interaction.locale].noLongerExistsInDatabase,
					ephemeral: true,
				})
				.catch(console.error);

			return 0;
		}

		try {
			await displayPollingData('closePoll', null, null, interaction);
		} catch (error) {
			console.error(error);

			return 0;
		}

		try {
			pool.query('DELETE FROM polls WHERE messageId = $1', [interaction.message.id]);
		} catch (error) {
			interaction.reply({
				content: locale[interaction.locale].errorUpdatingDatabase,
				ephemeral: true,
			});
			console.error(`[ [1;31mDISPLAY POLLING DATA ERROR[0m ]\n${error}\n [1;35mERROR END[0m`);

			return 0;
		}
		console.log(`[ [1;34mPoll Button Info[0m ] ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) / ${interaction.member.displayName}[${interaction.member.id}] closed the poll ${interaction.message.id}.`);
	}
});

client.login(process.env.discord_token);