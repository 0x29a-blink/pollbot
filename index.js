require('dotenv').config();
const { ShardingManager } = require('discord.js');
const { AutoPoster } = require('topgg-autoposter');

const manager = new ShardingManager('./bot.js', { token: process.env.discord_token });
const poster = AutoPoster(process.env.topgg_token, manager);

manager.on('shardCreate', shard => console.log(`Launched shard #${shard.id}`));
manager.spawn();

poster.on('posted', (stats) => {
    console.log('[ [1;34mTOP.GG STATS[0m ] \n' + stats + '\n[ [1;35mEND[0m ]');
});

poster.on('err', (err) => {
    console.log('[ [1;31mTOP.GG STATS[0m ] \n' + err + '\n[ [1;35mERROR END[0m ]');
});