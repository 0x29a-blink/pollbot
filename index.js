require('dotenv').config();
const { ShardingManager } = require('discord.js');
const { AutoPoster } = require('topgg-autoposter');
const { chalk, log, logerr } = require('./logger');

const manager = new ShardingManager('./bot.js', {
	token: process.env.discord_token,
});
const poster = AutoPoster(process.env.topgg_token, manager);

manager.on('shardCreate', shard => log(chalk`{green Launched Shard #${shard.id + 1}}`));
manager.spawn();

poster.on('posted', (stats) => {
	log(chalk`{green [ TOP.GG STATS ] ${JSON.stringify(stats)}}`);
});

poster.on('err', (err) => {
	logerr(chalk`{red [ TOP.GG STATS ERROR ]}\n${JSON.stringify(err)}\n{red [ END ]}`);
});