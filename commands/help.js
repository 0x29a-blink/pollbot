const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageActionRow, MessageEmbed, MessageButton, } = require('discord.js');
const chalk = require('chalk');

const button = new MessageActionRow()
    .addComponents(
        new MessageButton()
        .setLabel('Support Discord')
        .setURL('https://discord.gg/hUge5epA')
        .setStyle('LINK'),
        new MessageButton()
        .setLabel('GitHub')
        .setURL('https://github.com/0x29a-blink/pollbot')
        .setStyle('LINK'),

        new MessageButton()
        .setLabel('Ko-Fi')
        .setURL('https://ko-fi.com/0x29a')
        .setStyle('LINK'),
    );

module.exports = {

    data: new SlashCommandBuilder()
        .setDefaultPermission(true)
        .setName('help')
        .setDescription('Information on creating votes / helpful links.'),
    async execute(interaction) {
        const embed = new MessageEmbed()
            .setColor('#ff6633')
            .setTitle('Simple Poll Bot Help')
            .setThumbnail(`https://i.imgur.com/MsYPWMV.png`)
            .setAuthor('blink#0140', 'https://i.imgur.com/C0ZRGdo.gif', 'https://twitch.tv/dotblink')
            .setDescription(`All information is avaliable on our [GitHub](https://github.com/0x29a-blink/pollbot) or the [Support Discord](https://discord.gg/VZkY8mDJGh).`)
            .setFooter('very useful help command.')
        console.log(`${chalk.magenta('+ cmd run:')} help / ${interaction.guild.name}[${interaction.guild.id}](${interaction.guild.memberCount}) ${interaction.member.displayName}[${interaction.member.id}]`);
        return interaction.reply({
            embeds: [embed],
            components: [button, ],
        });
    },
};