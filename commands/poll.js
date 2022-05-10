//
// Imports
//
const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageActionRow, MessageButton, MessageEmbed, MessageSelectMenu, Permissions, ThreadManager } = require('discord.js');
const chalk = require('chalk');
var moment = require('moment');
var { open } = require('sqlite');
var sqlite3 = require('sqlite3').verbose();

const button = new MessageActionRow()
    .addComponents(
        new MessageButton()
        .setCustomId("closepoll")
        .setLabel('Close Poll')
        .setStyle('DANGER'),
    );

module.exports = {
    data: new SlashCommandBuilder()
        .setName('poll')
        .setDescription('Create a new poll.')
        .addStringOption(option =>
            option.setName('title')
            .setDescription('The title for the embed.')
            .setRequired(true))
        .addStringOption(option =>
            option.setName('description')
            .setDescription('The descrption for the embed. Create a newline using \\n')
            .setRequired(true))
        .addStringOption(option =>
            option.setName('items')
            .setDescription('Items to vote on. SEPARATE EACH ITEM WITH A COMMA (,)')
            .setRequired(true))
        .addBooleanOption(option =>
            option.setName('public')
            .setDescription('Allows you to make the results of the poll public at all times, even before you close the poll.')
            .setRequired(true))
        .addBooleanOption(option =>
            option.setName('thread')
            .setDescription('Attach a thread to the poll?')
            .setRequired(false)),



    async execute(interaction) {
        const pollList = interaction.options.getString('items');
        const embedTitle = interaction.options.getString('title');
        const embedDescription = interaction.options.getString('description').replaceAll('\\n', '\n');
        const createThread = interaction.options.getBoolean('thread');
        const publicPoll = interaction.options.getBoolean('public');

        console.log(`${chalk.magenta('+ cmd run:')} poll / ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}] (${chalk.magenta.italic(`/poll title: ${embedTitle} description: ${embedDescription.replaceAll('\n', '\\n')} items: ${pollList} public: ${publicPoll} thread: ${createThread}`)})`);

        (async () => {
            const db = await open({
                filename: './data/main.db',
                driver: sqlite3.Database
            })
            let roleName = "Poll Manager";
            if (interaction.guild.roles.cache.find(role => role.name == roleName) || interaction.member.permissions.has(Permissions.FLAGS['MANAGE_GUILD'])) {
                if (interaction.member.roles.cache.some(role => role.name === roleName) || interaction.member.permissions.has(Permissions.FLAGS['MANAGE_GUILD'])) {
                    db.run("UPDATE Info SET Count = Count + 1 WHERE rowid = 1");

                    const pollListArr = pollList.split(",");
                    const labelArr = pollListArr.map(x => ({
                        label: x,
                        value: x,
                        voteCount: 0
                    }));
                    if (pollListArr.length > 25) {
                        interaction.reply({
                                content: `Sorry! The poll you tried to create has more than 25 items(${pollListArr.length}) unfortunately this is an API limitation and not my own, please remove some items from the poll.`,
                                ephemeral: true,
                            })
                            .then(console.log(`${chalk.red('! poll length:')} ${chalk.gray(`${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}]`)} tried to create a poll with too many items[${pollListArr.length}].`));
                    } else {
                        const selectionMenu = new MessageActionRow()
                            .addComponents(
                                new MessageSelectMenu()
                                .setCustomId('poll')
                                .setPlaceholder('Please Select An Item!')
                                .addOptions(labelArr),
                            );
                        const embed = new MessageEmbed()
                            .setColor('#ff6633')
                            .setTitle(embedTitle)
                            .setURL('https://top.gg/bot/911731627498041374')
                            .setDescription(embedDescription);

                        try {
                            await interaction.reply({
                                embeds: [embed],
                                components: [selectionMenu, button, ]
                            });
                        } catch (err) {
                            return interaction.reply({
                                content: 'Could not create vote, please make sure there are no duplicates or ping blink#0140 in the support discord with your command input for help if you\'re unable to figure it out.',
                                ephemeral: true,
                            });
                        }

                        // ----------------------------------------------------------------
                        const message = await interaction.fetchReply()

                        await db.exec(`CREATE TABLE "poll-${message.id}" ("lastInteraction" TEXT, "commandInput" TEXT, "guildName" TEXT, "guildId" INTEGER, "channelName" TEXT, "channelId" INTEGER, "pollTitle" TEXT, "pollDesc" TEXT, "pollItem" TEXT, "voteCount" INTEGER, "publicPoll" TEXT)`);
                        await db.exec(`CREATE TABLE "user-${message.id}" ("userName" TEXT, "userId" INTEGER, "pollItem" TEXT)`);

                        console.log(`${chalk.green('+ created:')} ${chalk.gray(`${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}]`)} created the poll ${chalk.gray(`"./data/main.db:poll-${message.id}" & "./data/main.db:user-${message.id}"`)}`);
                        let date = moment();
                        let placeholders = pollListArr.map((movie) => `(${interaction.guild.id}, ${interaction.channel.id}, ?, 0)`).join(',');
                        let sql = `INSERT INTO "poll-${message.id}"(guildId, channelId, pollItem, voteCount) VALUES ${placeholders}`;
                        let sql2 = `UPDATE "poll-${message.id}" SET lastInteraction = ?, commandInput = ?, guildName = ?, channelName = ?, pollTitle = ?, pollDesc = ?, publicPoll = ?`;
                        try {
                            await db.run(sql, pollListArr);
                            await db.run(sql2, `${date}`, `/poll title: ${embedTitle} description: ${embedDescription} items: ${pollList}`, `${interaction.guild.name}`, `${interaction.channel.name}`, `${embedTitle}`, `${embedDescription}`, `${publicPoll}`);
                        } catch (err) {
                            console.log(chalk.red("ERR"));
                            console.log(err);
                        }

                        if (createThread == true) {
                            if (interaction.channel.permissionsFor(interaction.applicationId).has(['MANAGE_THREADS'])) {
                                const thread = await interaction.channel.threads.create({
                                    startMessage: message.id,
                                    name: `${embedTitle}`,
                                    autoArchiveDuration: 1440,
                                    reason: 'Thread created for a poll.',
                                });
                            } else {
                                const threadEmbed = new MessageEmbed()
                                    .setColor('#ff6633')
                                    .setTitle(`Thread Creation Error`)
                                    .setDescription(`An error occured while creating the thread for the poll.\n\nPlease add the \`MANAGE_THREADS\` permission to access this feature.`)
                                    .setImage('https://support.discord.com/hc/article_attachments/4406694690711/image1.png')
                                    .setTimestamp();
                                await interaction.followUp({
                                    embeds: [threadEmbed],
                                    ephemeral: true,
                                });
                                console.log(chalk.red("Couldn't create thread."));
                            }
                        }
                    }
                } else {
                    interaction.reply({
                            content: "Sorry you don't have the \`MANAGE_GUILD\` permission or \"Poll Manager\" role.",
                            ephemeral: true,
                        })
                        .then(console.log(`${chalk.yellow('! no role:')} ${chalk.gray(`${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}]`)} tried to create a poll.`))
                        .catch(console.error);
                }
            } else {
                if (interaction.channel.permissionsFor(interaction.applicationId).has(['MANAGE_ROLES'])) {
                    interaction.guild.roles.create({
                        name: roleName,
                        color: "#ff6633",
                        reason: "Automatically creating \"Poll Manager\" for bot functions."
                    }).then(role => {
                        interaction.reply({
                                content: "It appears you don't have the permission \`MANAGE_GUILD\` to create a poll, I've created the role \`\"Poll Manager\"\` for you to utilize instead. Simply add the role to yourself and anyone else that you want to have permissions to create and close polls.",
                                ephemeral: true,
                            })
                            .then(console.log(`${chalk.green('+ role create:')} created the "Poll Manager" role in ${chalk.gray(`${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) / ${interaction.member.displayName}[${interaction.member.id}]`)}`))
                            .catch(console.error);
                    });
                } else {
                    interaction.reply({
                            content: `Sorry! You don't have the \`MANAGE_GUILD\` permission and I don't have permissions to create the \`\"Poll Manager\"\` role for you.\nPlease ask an administrator to run the \`/poll\` command for you or ask them to create the \`\"Poll Manager\"\` role and apply it to you.`,
                            ephemeral: true,
                        })
                        .then(console.log(`${chalk.red(`! missing permissions:`)} to create the "Poll Manager" role in ${chalk.gray(`${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}]`)}"`))
                        .catch(console.error);
                }
            }
        })()
    },
};