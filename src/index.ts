// Copyright (c) 2026 Simple Solutions.
// Licensed under the MIT License. See LICENSE in the project root for details.

import dns from 'dns';
import { ShardingManager } from 'discord.js';
import { AutoPoster } from 'topgg-autoposter';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { logger } from './lib/logger';
import { checkDbConnectionWithRetry } from './lib/db';
import { I18n } from './lib/i18n';
import { fork, ChildProcess } from 'child_process';
import { setGlobalDispatcher, Agent } from 'undici';

dns.setDefaultResultOrder('ipv4first');
dotenv.config();
I18n.init();

// 1. Configure Global Undici Dispatcher (Increase Timeout)
setGlobalDispatcher(new Agent({
    connect: {
        timeout: 30000 // 30 seconds
    }
}));

// 0. Verify Database Connection Before Startup
(async () => {
    logger.info('[Manager] Verifying database connection...');
    const dbHealthy = await checkDbConnectionWithRetry(5, 1000);
    if (!dbHealthy) {
        logger.error('[Manager] Database connection failed after retries. Exiting.');
        process.exit(1);
    }

    // Continue with normal startup after DB is verified
    startServices();
})();

function startServices() {

    const token = process.env.DISCORD_TOKEN;

    if (!token) {
        logger.error("DISCORD_TOKEN is not defined in the environment variables.");
        process.exit(1);
    }

    // Detect if we are running in TS-Node (Development) or Node (Production)
    const isTsNode = (process as any)[Symbol.for('ts-node.register.instance')] || process.env.TS_NODE_DEV;
    const extension = isTsNode ? 'ts' : 'js';
    const botFile = path.join(__dirname, `bot.${extension}`);
    const dashboardServiceFile = path.join(__dirname, 'services', `DashboardService.${extension}`);

    let shuttingDown = false;

    const spawnSupervisedService = (
        label: string,
        filePath: string,
        inheritStdio = false
    ): { stop: () => void } => {
        let child: ChildProcess | null = null;
        let restartTimer: NodeJS.Timeout | null = null;
        let attempt = 0;

        const launch = () => {
            if (shuttingDown) return;
            const startedAt = Date.now();
            logger.info(`[Manager] Spawning ${label}...`);
            const proc = fork(filePath, [], {
                execArgv: isTsNode ? ['-r', 'ts-node/register'] : [],
                ...(inheritStdio ? { stdio: 'inherit' as const } : {}),
            });
            child = proc;

            proc.on('spawn', () => {
                logger.info(`[Manager] ${label} process spawned.`);
            });

            proc.on('error', (err) => {
                logger.error(`[Manager] ${label} failed:`, err);
            });

            proc.on('close', (code, signal) => {
                if (child === proc) {
                    child = null;
                }
                if (shuttingDown) return;
                if (Date.now() - startedAt >= 60_000) {
                    attempt = 0;
                }
                attempt++;
                const delayMs = Math.min(2000 * 2 ** (attempt - 1), 30_000);
                logger.error(`[Manager] ${label} exited (code=${code}, signal=${signal}). Respawning in ${delayMs / 1000}s...`);
                restartTimer = setTimeout(() => {
                    restartTimer = null;
                    launch();
                }, delayMs);
                if (typeof restartTimer.unref === 'function') {
                    restartTimer.unref();
                }
            });
        };

        launch();

        return {
            stop: () => {
                if (restartTimer) {
                    clearTimeout(restartTimer);
                    restartTimer = null;
                }
                if (child) {
                    child.kill();
                    child = null;
                }
            },
        };
    };

    // 2. Spawn & Supervise (optionally) Dashboard Service
    const dashboardDir = path.join(__dirname, '..', 'dashboard');
    const enableDashboardEnv = process.env.ENABLE_DASHBOARD;
    const shouldStartDashboard = enableDashboardEnv === 'false'
        ? false
        : enableDashboardEnv === 'true' || fs.existsSync(dashboardDir);

    let dashboardSupervisor: { stop: () => void } | null = null;
    if (shouldStartDashboard) {
        dashboardSupervisor = spawnSupervisedService('Dashboard Service', dashboardServiceFile, true);
    } else if (enableDashboardEnv === 'false') {
        logger.info('[Manager] Dashboard Service disabled via ENABLE_DASHBOARD=false.');
    } else {
        logger.info('[Manager] dashboard/ directory not present — running in bot-only mode (Dashboard Service skipped).');
    }

    // 3. Spawn Shards (in-process @napi-rs/canvas needs zero external warmup)
    const manager = new ShardingManager(botFile, {
        token: token,
        totalShards: 'auto',
        // Pass execution args to shard if using ts-node
        ...(isTsNode ? { execArgv: ['-r', 'ts-node/register'] } : {})
    });

    manager.on('shardCreate', shard => logger.info(`[Manager] Launched shard ${shard.id}`));

    // Bot-list posting is skipped in dev mode: the real API keys may be
    // present in a local .env, and a dev run must never report the test
    // bot's stats to the live Top.gg/DiscordForge listings.
    const devOnlyMode = process.env.DEV_ONLY_MODE === 'true';
    if (devOnlyMode) {
        logger.info('[Manager] DEV_ONLY_MODE — skipping Top.gg/DiscordForge stat posting.');
    }

    // Integrated Top.gg AutoPoster
    const topggToken = process.env.TOPGG_TOKEN;
    if (topggToken && !devOnlyMode) {
        const ap = AutoPoster(topggToken, manager);
        ap.on('posted', () => {
            logger.debug('[AutoPoster] Posted stats to Top.gg!');
        });
        ap.on('error', (err: any) => {
            logger.error('[AutoPoster] Error posting stats:', err);
        });
    }

    // DiscordForge stats + heartbeat + command sync (own client, no SDK)
    const discordForgeKey = process.env.DISCORDFORGE_API_KEY;
    if (discordForgeKey && !devOnlyMode) {
        import('./services/BotListService').then(({ BotListService }) => {
            new BotListService(manager, discordForgeKey).start();
        }).catch(err => {
            logger.error('[Manager] Failed to start BotListService:', err);
        });
    } else {
        logger.info('[Manager] DISCORDFORGE_API_KEY not set — DiscordForge posting disabled.');
    }

    // 4. Start Webhook Server (Top.gg & Cloudflare Tunnel)
    setTimeout(() => {
        logger.info(`[Manager] Checking Tunnel Tokens: Webhook=${process.env.WEBHOOK_CLOUDFLARED_TOKEN ? 'EXISTS' : 'MISSING'}, Main=${process.env.MAIN_CLOUDFLARED_TOKEN ? 'EXISTS' : 'MISSING'}`);
        import('./webhook').then(({ startWebhookServer, setShardingManager }) => {
            setShardingManager(manager);
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

    spawnShardsWithRetry(manager);

    // Handle Shutdown
    const handleShutdown = (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info(`[Manager] ${signal} received. Killing Services...`);
        dashboardSupervisor?.stop();
        process.exit(0);
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
} // End of startServices function

// Spawn shards with retries. The manager fetches the recommended shard count from
// Discord before spawning; if that fails (e.g. DNS not ready right after boot) and
// we merely log it, the manager keeps running with zero shards while the dashboard
// and tunnels look healthy. Retry transient failures, and exit on give-up so the
// service manager restarts the whole process.
async function spawnShardsWithRetry(manager: ShardingManager, maxAttempts = 5) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await manager.spawn({ timeout: 300000 }); // 5 minute timeout per attempt
            return;
        } catch (error) {
            logger.error(`[Manager] Shard spawn attempt ${attempt}/${maxAttempts} failed:`, error);

            // Retrying spawn() on a partially spawned manager is unreliable —
            // restart the whole process cleanly instead.
            if (manager.shards.size > 0) {
                logger.error('[Manager] Shards partially spawned. Exiting for a clean restart.');
                process.exit(1);
            }

            if (attempt < maxAttempts) {
                const delayMs = Math.min(5000 * 2 ** (attempt - 1), 60000);
                logger.warn(`[Manager] Retrying shard spawn in ${delayMs / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }

    logger.error('[Manager] All shard spawn attempts failed. Exiting so the service manager can restart the bot.');
    process.exit(1);
}
