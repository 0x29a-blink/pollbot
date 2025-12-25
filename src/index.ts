import { ShardingManager } from 'discord.js';
import dotenv from 'dotenv';
import path from 'path';
import { logger } from './lib/logger';

dotenv.config();

const token = process.env.DISCORD_TOKEN;

if (!token) {
    logger.error("DISCORD_TOKEN is not defined in the environment variables.");
    process.exit(1);
}

// Detect if we are running in TS-Node (Development) or Node (Production)
const isTsNode = (process as any)[Symbol.for('ts-node.register.instance')] || process.env.TS_NODE_DEV;
const extension = isTsNode ? 'ts' : 'js';
const botFile = path.join(__dirname, `bot.${extension}`);

const manager = new ShardingManager(botFile, {
    token: token,
    totalShards: 'auto',
    // Pass execution args to shard if using ts-node
    ...(isTsNode ? { execArgv: ['-r', 'ts-node/register'] } : {})
});

manager.on('shardCreate', shard => logger.info(`[Manager] Launched shard ${shard.id}`));

manager.spawn({ timeout: 60000 }).catch(error => {
    logger.error('[Manager] Failed to spawn shards:', error);
});
