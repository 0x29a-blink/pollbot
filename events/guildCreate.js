const chalk = require('chalk');
module.exports = {
    name: 'guildCreate',
    once: false,
    execute(guild) {
        console.log(`${chalk.blue('+ guild add:')} "${guild.name}" [${guild.id}](${guild.memberCount}) at ${Date(Date.now())}`);
    },
};