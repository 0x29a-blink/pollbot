module.exports = {
    name: 'guildDelete',
    once: false,
    execute(guild) {
        console.log(`[ [1;34mBOT INFO - GUILD REMOVED[0m ] "${guild.name}" [${guild.id}](${guild.memberCount}) at ${Date(Date.now())}`);
    },
};