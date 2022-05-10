//
// Imports
//
require('dotenv').config();
const chalk = require('chalk');
const fs = require('fs');
const AsciiBar = require('ascii-bar').default;
const { AutoPoster } = require('topgg-autoposter')
const { Client, Collection, Intents, MessageEmbed, Permissions, } = require('discord.js');
const client = new Client({ intents: [Intents.FLAGS.GUILDS] });
var moment = require('moment');
var { open } = require('sqlite');
var sqlite3 = require('sqlite3').verbose();




const ap = AutoPoster(`${process.env.topgg_token}`, client)

const eventFiles = fs.readdirSync('./events').filter(file => file.endsWith('.js'));
for (const file of eventFiles) {
    const event = require(`./events/${file}`);
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
    } else {
        client.on(event.name, (...args) => event.execute(...args));
    }
}


client.commands = new Collection();
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
}

(async () => {
    const db = await open({
        filename: './data/main.db',
        driver: sqlite3.Database
    })

    // Remove the poll for a database if lastInteraction inside the database is more than a month old.
    // If the database file does not contain a lastInteraction assume it's more tahn a month old and delete it.

    setInterval(() => {
        let sql = `SELECT EXISTS(SELECT lastInteraction FROM * LIMIT 1)`;
        //db.get(sql)
    }, 43200000)

    client.on('interactionCreate', async interaction => {
        if (interaction.isCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;
            let cmd = JSON.parse(JSON.stringify(command));
            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(error);
                return interaction.reply({
                    content: 'There was an error while executing this command!',
                    ephemeral: true
                });
            }
        }


        //
        // Selection Menu
        //
        if (interaction.isSelectMenu()) {
            if (interaction.customId === "poll") {
                try {
                    let choice = interaction.values[0];
                    let member = interaction.member;

                    let sql = Object.values(await db.get(`SELECT EXISTS(SELECT userId FROM "user-${interaction.message.id}" WHERE userId=${member.id} LIMIT 1);`));
                    let date = moment();

                    let publicPoll = Object.values(await db.get(`SELECT EXISTS(SELECT publicPoll FROM "poll-${interaction.message.id}" WHERE publicPoll="true" LIMIT 1);`));


                    // Checking if users contains the userId of current voter.
                    if (sql[0]) {
                        let user = Object.values(await db.get(`SELECT * FROM "user-${interaction.message.id}" WHERE userId=${member.id} LIMIT 1;`));
                        let originalChoice = user[2];
                        await db.run(`UPDATE "user-${interaction.message.id}" SET pollItem = ? WHERE userId=${member.id}`, `${choice}`);
                        await db.run(`UPDATE "poll-${interaction.message.id}" SET voteCount = voteCount + 1 WHERE pollItem= ?`, `${choice}`);
                        await db.run(`UPDATE "poll-${interaction.message.id}" SET voteCount = voteCount - 1 WHERE pollItem= ?`, `${originalChoice}`);
                        await db.run(`UPDATE "poll-${interaction.message.id}" SET lastInteraction = ?`, `${date}`);

                        if (publicPoll[0] === 1) {
                            const result = await db.all(`SELECT * FROM "poll-${interaction.message.id}" ORDER BY voteCount DESC`);
                            let pollItemLoop = [],
                                graphLoop = [],
                                graphTotalVotes = 0;
                            for (let i = 0; i < result.length; i++) {
                                pollItemLoop.push(`${result[i].pollItem}`);
                                graphTotalVotes += result[i].voteCount;
                            }
                            for (let i = 0; i < result.length; i++) {
                                let dots = "▮".repeat(Math.round((100 * result[i].voteCount / graphTotalVotes) / 10));
                                let left = 10 - (Math.round((100 * result[i].voteCount / graphTotalVotes) / 10));
                                let empty = "▯".repeat(left);
                                graphLoop.push(`[${dots}${empty}] (${result[i].voteCount}) ${(100 * result[i].voteCount / graphTotalVotes).toFixed(2)}%`);
                            }
                            let pollItem = pollItemLoop.toString().split(',').join("\r\n"),
                                graph = graphLoop.toString().split(',').join("\r\n");

                            const embed = new MessageEmbed()
                                .setColor('#ff6633')
                                .setTitle(`${interaction.message.embeds[0].title}`)
                                .setDescription(`${interaction.message.embeds[0].description}`)
                                .setURL('https://top.gg/bot/911731627498041374')
                                .addField(`Item`, pollItem, true)
                                .addField(`Results (Total Votes: ${graphTotalVotes})`, graph, true)
                            try {
                                await interaction.update({
                                    embeds: [embed],
                                })
                            } catch (err) {
                                console.log(`${chalk.red('! UPDATE POLL ERR')} \n ${err}`)
                            }
                            await interaction.followUp({
                                    content: `"You've changed your vote from "${originalChoice}" to "${choice}".`,
                                    fetchReply: true,
                                    ephemeral: true
                                })
                                .then(console.log(`${chalk.green('+ vote change:')} saved ${chalk.gray(`${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}]`)}s new choice of ${chalk.gray(`"${originalChoice}"`)} to ${chalk.gray(`"${choice}"`)} in ${chalk.gray(`"./data/main.db:user-${interaction.message.id}"`)}.`))
                                .catch(console.error);
                        } else {
                            await interaction.reply({
                                    content: `"You've changed your vote from "${originalChoice}" to "${choice}".`,
                                    fetchReply: true,
                                    ephemeral: true
                                })
                                .then(console.log(`${chalk.green('+ vote change:')} saved ${chalk.gray(`${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}]`)}s new choice of ${chalk.gray(`"${originalChoice}"`)} to ${chalk.gray(`"${choice}"`)} in ${chalk.gray(`"./data/main.db:user-${interaction.message.id}"`)}.`))
                                .catch(console.error);
                        }
                    } else {
                        await db.run(`INSERT INTO "user-${interaction.message.id}" (userName, userId, pollItem) VALUES (?, ?, ?)`, `${member.displayName}`, `${member.id}`, `${choice}`);
                        await db.run(`UPDATE "poll-${interaction.message.id}" SET voteCount = voteCount + 1 WHERE pollItem= ?`, `${choice}`);
                        await db.run("UPDATE Info SET Count = Count + 1 WHERE rowid = 2");
                        await db.run(`UPDATE "poll-${interaction.message.id}" SET lastInteraction = ?`, `${date}`);

                        if (publicPoll[0] === 1) {
                            const result = await db.all(`SELECT * FROM "poll-${interaction.message.id}" ORDER BY voteCount DESC`);
                            let pollItemLoop = [],
                                graphLoop = [],
                                graphTotalVotes = 0;
                            for (let i = 0; i < result.length; i++) {
                                pollItemLoop.push(`${result[i].pollItem}`);
                                graphTotalVotes += result[i].voteCount;
                            }
                            for (let i = 0; i < result.length; i++) {
                                let dots = "▮".repeat(Math.round((100 * result[i].voteCount / graphTotalVotes) / 10));
                                let left = 10 - (Math.round((100 * result[i].voteCount / graphTotalVotes) / 10));
                                let empty = "▯".repeat(left);
                                graphLoop.push(`[${dots}${empty}] (${result[i].voteCount}) ${(100 * result[i].voteCount / graphTotalVotes).toFixed(2)}%`);
                            }
                            let pollItem = pollItemLoop.toString().split(',').join("\r\n"),
                                graph = graphLoop.toString().split(',').join("\r\n");

                            const embed = new MessageEmbed()
                                .setColor('#ff6633')
                                .setTitle(`${interaction.message.embeds[0].title}`)
                                .setDescription(`${interaction.message.embeds[0].description}`)
                                .setURL('https://top.gg/bot/911731627498041374')
                                .addField(`Item`, pollItem, true)
                                .addField(`Results (Total Votes: ${graphTotalVotes})`, graph, true)
                            try {
                                await interaction.update({
                                    embeds: [embed],
                                })
                            } catch (err) {
                                console.log(`${chalk.red('! UPDATE POLL ERR')} \n ${err}`)
                            }
                            await interaction.followUp({
                                    content: `"${choice}" chosen.`,
                                    fetchReply: true,
                                    ephemeral: true
                                })
                                .then(console.log(`${chalk.green('+ vote:')} saved ${chalk.gray(`${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}]`)}s choice of ${chalk.gray(`"${choice}"`)} to ${chalk.gray(`"./data/main.db:user-${interaction.message.id}"`)}.`))
                                .catch(console.error);
                        } else {
                            await interaction.reply({
                                    content: `"${choice}" chosen.`,
                                    fetchReply: true,
                                    ephemeral: true
                                })
                                .then(console.log(`${chalk.green('+ vote:')} saved ${chalk.gray(`${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}]`)}s choice of ${chalk.gray(`"${choice}"`)} to ${chalk.gray(`"./data/main.db:user-${interaction.message.id}"`)}.`))
                                .catch(console.error);
                        }
                    }
                } catch (err) {
                    console.log("vote change error: " + err);
                }
            }
        }
        //
        // Close Poll
        //
        if (interaction.isButton()) {
            if (interaction.customId === 'closepoll') {
                try {
                    let roleName = "Poll Manager";
                    if (interaction.member.roles.cache.some(role => role.name === roleName) || interaction.member.permissions.has(Permissions.FLAGS['MANAGE_GUILD'])) {

                        const result = await db.all(`SELECT * FROM "poll-${interaction.message.id}" ORDER BY voteCount DESC`);
                        let pollItemLoop = [],
                            graphLoop = [],
                            graphTotalVotes = 0;
                        for (let i = 0; i < result.length; i++) {
                            pollItemLoop.push(`${result[i].pollItem}`);
                            graphTotalVotes += result[i].voteCount;
                        }
                        for (let i = 0; i < result.length; i++) {
                            let dots = "▮".repeat(Math.round((100 * result[i].voteCount / graphTotalVotes) / 10));
                            let left = 10 - (Math.round((100 * result[i].voteCount / graphTotalVotes) / 10));
                            let empty = "▯".repeat(left);
                            graphLoop.push(`[${dots}${empty}] (${result[i].voteCount}) ${(100 * result[i].voteCount / graphTotalVotes).toFixed(2)}%`);
                        }
                        let pollItem = pollItemLoop.toString().split(',').join("\r\n"),
                            graph = graphLoop.toString().split(',').join("\r\n");

                        const embed = new MessageEmbed()
                            .setColor('#ff6633')
                            .setTitle(`${interaction.message.embeds[0].title}`)
                            .setDescription(`${interaction.message.embeds[0].description}`)
                            .setURL('https://top.gg/bot/911731627498041374')
                            .addField(`Item`, pollItem, true)
                            .addField(`Results (Total Votes: ${graphTotalVotes})`, graph, true)
                            .setFooter(`Poll closed at ${interaction.createdAt} by ${interaction.member.displayName}`)
                        try {
                            await interaction.update({
                                    embeds: [embed],
                                    components: [],
                                })
                                .then((message) => console.log(`${chalk.red('- close poll:')} ${chalk.gray(`${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}]`)} closed the poll ${chalk.gray(`"poll-${interaction.message.id}"`)}.`))
                        } catch (err) {
                            console.log(`${chalk.red('! CLOSE POLL ERR')} \n ${err}`)
                            await interaction.reply({
                                content: 'Sorry there was an issue closing the pole, if this persists please contact blink inside of the pollbot discord (use /help)',
                                ephemeral: true,
                            })
                        }
                        try {
                            await db.exec(`DROP TABLE "poll-${interaction.message.id}";`);
                            await db.exec(`DROP TABLE "user-${interaction.message.id}";`);
                        } catch (err) {
                            console.log('close error')
                        }
                    } else {
                        interaction.reply({
                                content: "Sorry you don't have the \`MANAGE_GUILD\` permission or \"Poll Manager\" role.",
                                ephemeral: true
                            })
                            .then((message) => console.log(`${chalk.yellow('! close poll:')} ${chalk.gray(`${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}]`)} tried to close the poll ${chalk.gray(`"poll-${interaction.message.id}"`)}`))
                            .catch(console.error);
                    }
                } catch (err) {
                    console.log("close poll err: " + err);
                }
            }
        }
    });
})();

ap.on('error', (err) => {
    console.log(`${chalk.red('! top.gg post err:')} \n ${err}`)
});

client.login(process.env.discord_token);