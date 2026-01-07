import { ShardingManager } from 'discord.js';
import { AutoPoster } from 'topgg-autoposter';
import dotenv from 'dotenv';
import path from 'path';
import { logger } from './lib/logger';
import { fork, ChildProcess } from 'child_process';
import { setGlobalDispatcher, Agent } from 'undici';

dotenv.config();

// 1. Configure Global Undici Dispatcher (Increase Timeout)
setGlobalDispatcher(new Agent({
    connect: {
        timeout: 30000 // 30 seconds
    }
}));

const token = process.env.DISCORD_TOKEN;

if (!token) {
    logger.error("DISCORD_TOKEN is not defined in the environment variables.");
    process.exit(1);
}

// Detect if we are running in TS-Node (Development) or Node (Production)
const isTsNode = (process as any)[Symbol.for('ts-node.register.instance')] || process.env.TS_NODE_DEV;
const extension = isTsNode ? 'ts' : 'js';
const botFile = path.join(__dirname, `bot.${extension}`);
const renderServiceFile = path.join(__dirname, 'services', `renderService.${extension}`);

// 2. Spawn Render Service
logger.info('[Manager] Spawning Render Service...');

const renderService: ChildProcess = fork(renderServiceFile, [], {
    execArgv: isTsNode ? ['-r', 'ts-node/register'] : []
});

renderService.on('spawn', () => {
    logger.info('[Manager] Render Service process spawned.');
});

renderService.on('error', (err) => {
    logger.error('[Manager] Render Service failed:', err);
});

// 3. Spawn Shards (Delayed to allow Render Service to warm up)
// Ideally we wait for a signal, but a short delay is usually sufficient/simpler for now.
setTimeout(() => {
    const manager = new ShardingManager(botFile, {
        token: token,
        totalShards: 'auto',
        // Pass execution args to shard if using ts-node
        ...(isTsNode ? { execArgv: ['-r', 'ts-node/register'] } : {})
    });

    manager.on('shardCreate', shard => logger.info(`[Manager] Launched shard ${shard.id}`));

    // Integrated Top.gg AutoPoster
    const topggToken = process.env.TOPGG_TOKEN;
    if (topggToken) {
        const ap = AutoPoster(topggToken, manager);
        ap.on('posted', () => {
            logger.debug('[AutoPoster] Posted stats to Top.gg!');
        });
        ap.on('error', (err: any) => {
            logger.error('[AutoPoster] Error posting stats:', err);
        });
    }

    // 4. Start Webhook Server (Top.gg & Cloudflare Tunnel)
    setTimeout(() => {
        logger.info(`[Manager] Checking CLOUDFLARED_TOKEN: ${process.env.CLOUDFLARED_TOKEN ? 'EXISTS (' + process.env.CLOUDFLARED_TOKEN.substring(0, 5) + '...)' : 'MISSING'}`);
        import('./webhook').then(({ startWebhookServer }) => {
            startWebhookServer();
        }).catch(err => {
            logger.error('[Manager] Failed to start Webhook Server:', err);
        });
    }, 5000); // Start after shards to ensure bot is ready-ish

    // 5. Start Telemetry Tunnel
    if (process.env.TELEMETRY_TOKEN) {
        import('./services/TelemetryTunnelService').then(({ TelemetryTunnelService }) => {
            new TelemetryTunnelService();
        }).catch(err => {
            logger.error('[Manager] Failed to start Telemetry Tunnel:', err);
        });
    }

    // Increase Timeout to 5 MINUTES
    manager.spawn({ timeout: 300000 }).catch(error => {
        logger.error('[Manager] Failed to spawn shards:', error);
    });
}, 2000); // Wait 2s for Render Service

// Handle Shutdown
process.on('SIGINT', () => {
    logger.info('[Manager] SIGINT received. Killing Render Service...');
    renderService.kill();
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('[Manager] SIGTERM received. Killing Render Service...');
    renderService.kill();
    process.exit(0);
});
