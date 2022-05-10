const chalk = require('chalk');
module.exports = {
    name: 'guildDelete',
    once: false,
    execute(guild) {
        console.log(`${chalk.blue('- guild remove:')} "${guild.name}" [${guild.id}](${guild.memberCount}) at ${Date(Date.now())}`);
    },
};