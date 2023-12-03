const { ActionRowBuilder, ButtonBuilder, EmbedBuilder, SlashCommandBuilder, StringSelectMenuBuilder, PermissionsBitField } = require('discord.js');
const locale = require('../../localization/localization.json');
const pool = require('../../db.js');
const moment = require('moment');


function createLocalizations(property) {
  return Object.fromEntries(Object.entries(locale).map(([key, value]) => [key, value[property]]));
}
function findDuplicates(array) {
    const set = new Set(array);
    return array.length !== set.size;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('poll')
        .setNameLocalizations(createLocalizations('pollCommandName'))
        .setDescription('Create a new poll.')
        .setDescriptionLocalizations(createLocalizations('pollCommandDescription'))
        .addStringOption(option =>
            option.setName('title')
            .setNameLocalizations(createLocalizations('pollOptionTitleName'))
            .setDescription('Sets the title of the poll.')
            .setDescriptionLocalizations(createLocalizations('pollOptionTitleDescription'))
            .setRequired(true))
        .addStringOption(option =>
            option.setName('description')
            .setNameLocalizations(createLocalizations('pollOptionDescriptionName'))
            .setDescription('The polls description... Create a newline in the poll description by typing \\n')
            .setDescriptionLocalizations(createLocalizations('pollOptionDescriptionDescription'))
            .setRequired(true))
        .addStringOption(option =>
            option.setName('items')
            .setNameLocalizations(createLocalizations('pollOptionItemsName'))
            .setDescription('Items to vote on. SEPARATE EACH ITEM WITH A COMMA ( , )')
            .setDescriptionLocalizations(createLocalizations('pollOptionItemsDescription'))
            .setRequired(true))
        .addBooleanOption(option =>
            option.setName('public')
            .setNameLocalizations(createLocalizations('pollOptionPublicName'))
            .setDescription('Allows you to make the results of the poll public at all times, even before you close the poll.')
            .setDescriptionLocalizations(createLocalizations('pollOptionPublicDescription'))
            .setRequired(true))
        .addBooleanOption(option =>
            option.setName('thread')
            .setNameLocalizations(createLocalizations('pollOptionThreadName'))
            .setDescription('Attach a thread to the poll?')
            .setDescriptionLocalizations(createLocalizations('pollOptionThreadDescription'))
            .setRequired(false)),

    async execute(interaction) {
        function getLocalization(property) {
            const selectedLocale = locale[interaction.locale] || locale['en-US'];
            return selectedLocale[property] || locale['en-US'][property];
        }

        const button = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                .setCustomId('closepoll')
                .setLabel(getLocalization('closePollLabel'))
                .setStyle('Danger'),
            );
        const pollItems = interaction.options.getString('items');
        const embedTitle = interaction.options.getString('title');
        const embedDescription = interaction.options.getString('description').replaceAll('\\n', '\n');
        const createThread = interaction.options.getBoolean('thread');
        const viewVotes = interaction.options.getBoolean('public');
        const pollManager = 'Poll Manager';

        const memberHasRole = interaction.member.roles.cache.some(role => role.name === pollManager);
        const memberHasManageGuild = interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild);
        const appHasManageRoles = interaction.channel.permissionsFor(interaction.applicationId).has(PermissionsBitField.Flags.ManageRoles);
        const appHasManageThreads = interaction.channel.permissionsFor(interaction.applicationId).has(PermissionsBitField.Flags.ManageThreads);
        const appHasCreatePublicThreads = interaction.channel.permissionsFor(interaction.applicationId).has(PermissionsBitField.Flags.CreatePublicThreads);
        const appHasCreatePrivateThreads = interaction.channel.permissionsFor(interaction.applicationId).has(PermissionsBitField.Flags.CreatePrivateThreads);
        const guildHasPollManagerRole = interaction.guild.roles.cache.find(role => role.name == pollManager);
        const pollListArr = pollItems.split(',');
        const labelArr = pollListArr.map(x => ({ label: x, value: x, voteCount: 0 }));

        console.log(`[ [1;31mPoll Create Exec[0m ] ${interaction.member.displayName}[${interaction.member.id}] ran the following command [1;46m/poll title: ${embedTitle} description: ${embedDescription.replaceAll('\n', '\\n')} items: ${pollItems} public: ${viewVotes} thread: ${createThread}[0m in ${interaction.guild.name}[${interaction.guild.id}](${interaction.guildMemberCount})`);

        if (!guildHasPollManagerRole && !memberHasManageGuild && !appHasManageRoles) {
            interaction.reply({
                content: getLocalization('memberNoPermsAndGuildHasNoRole'),
                ephemeral: true,
            })
            .catch(console.error);
            console.log(`[ [1;31mPoll Create Info[0m ] Attempted to create the "Poll Manager" role in but has no permissions ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) / ${interaction.member.displayName}[${interaction.member.id}]"`);

            return 0;
        }

        if (!memberHasRole && !memberHasManageGuild && !guildHasPollManagerRole && appHasManageRoles) {
            interaction.guild.roles.create({
                name: pollManager,
                color: '#ff6633',
                reason: getLocalization('roleCreateReason'),
            }).catch(console.error);
            interaction.reply({
                content: getLocalization('memberNoPermsAndServerNoRoleCreated'),
                ephemeral: true,
            })
            .catch(console.error);
            console.log(`[ [1;36mPoll Create Info[0m ] Created the "Poll Manager" role in [1;43m${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount})[0m for [1;43m${interaction.member.displayName}[${interaction.member.id}][0m`);

            return 0;
        }

        if (!memberHasManageGuild && !memberHasRole) {
            interaction.reply({
                content: getLocalization('memberNoPermsNoRole'),
                ephemeral: true,
            })
            .catch(console.error);
            console.log(`[ [1;33mPoll Create Info[0m ] ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}] tried to create a poll without role or permissions.`);

            return 0;
        }
        // Update the pollsCreated table.
        try {
            await pool.query('UPDATE botInfo SET pollsCreated = pollsCreated + 1 WHERE name = \'main\';');
        } catch (error) {
            console.error(`[ [1;31mPOLL CREATE ERROR[0m ] Database error in updating pollsCreated.\n${error}\n [1;35mERROR END[0m`);
        }

        if (pollListArr.length > 25) {
            interaction.reply({
                    content: getLocalization('pollTooManyItems').replace('$1', pollListArr.length),
                    ephemeral: true,
                });
            console.log(`[ [1;31mPoll Create Info[0m ] ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id} tried to create a poll with too many items [${pollListArr.length}].`);

            return 0;
        }
        if (findDuplicates(pollListArr) === true) {
            interaction.reply({
                content: getLocalization('pollHasDuplicates'),
                ephemeral: true,
            });
            console.log(`[ [1;31mPoll Create Info[0m ] ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id} created a poll with duplicate items [${pollListArr}]`);

            return 0;
        }
        if (pollListArr.some(i => i.length > 100) === true) {
            interaction.reply({
                content: getLocalization('pollItemTooLong'),
                ephemeral: true,
            });
            console.log(`[ [1;31mPoll Create Info[0m ] ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id} tried to create a poll item with too many characters.`);

            return 0;
        }
        if (pollListArr.some(i => i.replace(/\s/g, '').length < 1) === true) {
            interaction.reply({
                content: getLocalization('pollItemTooShort'),
                ephemeral: true,
            });
            console.log(`[ [1;31mPoll Create Info[0m ] ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id} tried to create a poll item with too few characters.`);

            return 0;
        }
        if (embedTitle.length > 256) {
            interaction.reply({
                content: getLocalization('embedTitleTooLong'),
                ephemeral: true,
            });
            console.log(`[ [1;31mPoll Create Info[0m ] ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id} tried to create a poll embed title with too many characters [${embedTitle.length}]`);

            return 0;
        }
        if (embedDescription.length > 4096) {
            interaction.reply({
                content: getLocalization('embedDescriptionTooLong'),
                ephemeral: true,
            });
            console.log(`[ [1;31mPoll Create Info[0m ] ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id} tried to create a poll embed description with too many characters [${embedDescription.length}]`);

            return 0;
        }

        const selectionMenu = new ActionRowBuilder()
                .addComponents(new StringSelectMenuBuilder()
                .setCustomId('poll')
                .setPlaceholder('Please Select An Item!')
                .addOptions(labelArr),
                );
        const embed = new EmbedBuilder()
            .setColor('#ff6633')
            .setTitle(embedTitle)
            .setURL('https://top.gg/bot/911731627498041374')
            .setDescription(embedDescription);

        try {
            await interaction.reply({
                embeds: [embed],
                components: [selectionMenu, button ],
            });
        } catch (error) {
            console.error(`[ [1;31mPOLL CREATE ERROR[0m ] Could not send reply to user.\n${error}\n [1;35mERROR END[0m`);
            return interaction.reply({
                content: getLocalization('couldNotCreateMessageBody'),
                ephemeral: true,
            });
        }

        const message = await interaction.fetchReply();

        /*
            CREATE TABLE IF NOT EXISTS polls (
                messageId           BIGINT,             // message.id
                pollGuildName       VARCHAR(100),       // interaction.guild.name
                pollGuildId         BIGINT,             // interaction.guild.id

                pollChannelName     VARCHAR(100),       // interaction.channel.name
                pollChannelId       BIGINT,             // interaction.channel.id

                pollTitle           VARCHAR(256),       // embedTitle
                pollDescription     VARCHAR(4096),      // embedDescription

                pollItem            VARCHAR(100),       // for (const item of pollListArr)
                pollVoteCount       INT DEFAULT 0,      // 0
                pollViewVotesFlag   BOOLEAN,            // viewVotes

                pollVoteUserName    VARCHAR(32),        // null
                pollVoteUserId      BIGINT,             // null
                pollVoteUserItem    VARCHAR(100)        /null
                lastInteraction     TIMESTAMP,          // moment().format('MM-DD-YYYY HH:mm:ss')
                id                  INTEGER,            // NOT NULL DEFAULT nextval('polls_id_seq'::regclass),

                CONSTRAINT
                        polls_pkey  PRIMARY KEY (id)
            )
        */
        for (const item of pollListArr) {
            try {
                await pool.query(`INSERT INTO polls (messageId, pollGuildName, pollGuildId, pollChannelName, pollChannelId, pollTitle, pollDescription, pollItem, pollViewVotesFlag, lastInteraction) VALUES(${message.id}, $1, ${interaction.guild.id}, $2, ${interaction.channel.id}, $3, $4, $5, ${viewVotes}, '${moment().format('MM-DD-YYYY HH:mm:ss')}')`, [interaction.guild.name, interaction.channel.name, embedTitle, embedDescription, item]);
            } catch (error) {
                console.error(`[ [1;31mPOLL CREATE ERROR[0m ] Could not insert new poll items into database.\n${error}\n [1;35mERROR END[0m`);

                interaction.followUp({
                    content: 'There was an error querying your poll, please reach out on the support server to try and get this issue solved.',
                    ephemeral: true,
                });

                return 0;
            }
        }

        if (createThread == true) {
            if (appHasManageThreads && appHasCreatePublicThreads && appHasCreatePrivateThreads) {
                await interaction.channel.threads.create({
                    startMessage: message.id,
                    name: `${embedTitle}`,
                    autoArchiveDuration: 1440,
                    reason: getLocalization('threadCreateReason'),
                });
            } else {
                const threadEmbed = new EmbedBuilder()
                    .setColor('#ff6633')
                    .setTitle(getLocalization('threadCreateErrorTitle'))
                    .setDescription(getLocalization('threadCreateErrorDescription'))
                    .setImage('https://support.discord.com/hc/article_attachments/4406694690711/image1.png')
                    .setTimestamp();
                await interaction.followUp({
                    embeds: [threadEmbed],
                    ephemeral: true,
                });
                console.log(`[ [1;31mPOLL CREATE ERROR[0m ] Couldn't create thread. ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) / ${interaction.member.displayName}[${interaction.member.id}]`);
            }
        }
    },
};