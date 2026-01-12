import express from 'express';
import cookieParser from 'cookie-parser';
import { Webhook } from '@top-gg/sdk';
import { tunnel } from 'cloudflared';
import { logger } from './lib/logger';
import { supabase } from './lib/db';
import { dashboardAuthRouter } from './webapp/dashboardAuth';
import { ensureCsrfToken, validateCsrfToken, getCsrfTokenHandler } from './webapp/csrf';
import dotenv from 'dotenv';
import { ShardingManager } from 'discord.js';

dotenv.config();

const app = express();
const port = 5000;

// Middleware
app.use(express.json());
app.use(cookieParser()); // Required for httpOnly session cookies
app.use(ensureCsrfToken); // Ensure CSRF token cookie is set
app.use(validateCsrfToken); // Validate CSRF token on mutation requests

// Store reference to sharding manager for sync operations
let shardingManager: ShardingManager | null = null;

export function setShardingManager(manager: ShardingManager) {
    shardingManager = manager;
}

export function getShardingManager(): ShardingManager | null {
    return shardingManager;
}

// Dashboard Auth Routes (Discord OAuth)
app.use('/api/auth', dashboardAuthRouter);

// CSRF Token endpoint
app.get('/api/auth/csrf', getCsrfTokenHandler);

// User Guilds Routes (user's manageable servers)
import { userGuildsRouter } from './webapp/userGuilds';
app.use('/api/user', userGuildsRouter);

// User Polls Routes (user's polls in a server)
import { userPollsRouter } from './webapp/userPolls';
app.use('/api/user', userPollsRouter);

// Poll Management Routes (channels, roles, poll CRUD)
import { pollManagementRouter } from './webapp/pollManagement';
app.use('/api/user', pollManagementRouter);

// Top.gg Webhook
const webhook = new Webhook(process.env.TOPGG_WEBHOOK_AUTH || 'default_auth');

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Admin-only endpoint to sync all guilds from Discord
// This triggers all shards to re-fetch guild data
const ADMIN_IDS = (process.env.DISCORD_ADMIN_IDS || '').split(',').map(id => id.trim()).filter(Boolean);

app.post('/api/admin/sync-guilds', async (req, res) => {
    // Support both cookie and header auth
    const cookieSession = req.cookies?.['pollbot_session'];
    const authHeader = req.headers.authorization;
    const headerSession = authHeader?.replace('Bearer ', '');
    const sessionId = cookieSession || headerSession;

    if (!sessionId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check session and admin status
    const { data: session } = await supabase
        .from('dashboard_sessions')
        .select('user_id')
        .eq('id', sessionId)
        .single();

    if (!session || !ADMIN_IDS.includes(session.user_id)) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (!shardingManager) {
        logger.warn('[Webhook] Sync requested but ShardingManager not available');
        return res.status(503).json({ error: 'Bot not ready, try again later' });
    }

    try {
        logger.info(`[Webhook] Admin sync triggered by user ${session.user_id}`);

        // Broadcast to all shards to sync their guilds
        await shardingManager.broadcastEval(client => {
            // Send message to trigger sync in GuildSyncService
            process.send?.({ type: 'SYNC_ALL_GUILDS' });
            return true;
        });

        return res.json({ success: true, message: 'Guild sync initiated on all shards' });
    } catch (error) {
        logger.error('[Webhook] Failed to trigger sync:', error);
        return res.status(500).json({ error: 'Failed to trigger sync' });
    }
});

app.post('/vote', webhook.listener(async (vote) => {
    logger.info(`[Webhook] Received vote from user: ${vote.user}`);

    try {
        const { error } = await supabase
            .from('users')
            .upsert({
                id: vote.user,
                last_vote_at: new Date().toISOString()
            }, {
                onConflict: 'id'
            });

        if (error) {
            logger.error(`[Webhook] Failed to update vote timestamp for user ${vote.user}:`, error);
        } else {
            logger.info(`[Webhook] Successfully updated vote timestamp for user ${vote.user}`);
        }
    } catch (err) {
        logger.error(`[Webhook] Unexpected error processing vote for user ${vote.user}:`, err);
    }
}));

import { spawn } from 'child_process';
import path from 'path';


export async function startWebhookServer() {
    app.listen(port, () => {
        logger.info(`[Webhook] Server listening on port ${port}`);
    });

    // Dynamically locate the cloudflared binary from the npm package
    const cloudflaredDir = path.dirname(require.resolve('cloudflared'));
    const binaryName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
    const binaryPath = path.join(cloudflaredDir, '..', 'bin', binaryName);

    // Helper to start a tunnel
    const startTunnel = (token: string, name: string) => {
        try {
            const child = spawn(binaryPath, ['tunnel', 'run', '--token', token]);

            child.stdout.on('data', (data) => {
                logger.info(`[cloudflared:${name}] ${data.toString().trim()}`);
            });

            child.stderr.on('data', (data) => {
                logger.info(`[cloudflared:${name}] ${data.toString().trim()}`);
            });

            child.on('error', (err) => {
                logger.error(`[cloudflared:${name}] Failed to spawn:`, err);
            });

            child.on('close', (code) => {
                logger.warn(`[cloudflared:${name}] Process exited with code ${code}`);
            });

            // Handle shutdown
            const cleanup = () => {
                logger.info(`[cloudflared:${name}] Stopping tunnel...`);
                child.kill();
            };
            process.on('SIGINT', cleanup);
            process.on('SIGTERM', cleanup);

            return child;
        } catch (error) {
            logger.error(`[cloudflared:${name}] Error starting tunnel:`, error);
            return null;
        }
    };

    // Start webhook tunnel (Top.gg)
    if (process.env.WEBHOOK_CLOUDFLARED_TOKEN) {
        logger.info('[Webhook] Starting webhook tunnel (WEBHOOK_CLOUDFLARED_TOKEN)...');
        startTunnel(process.env.WEBHOOK_CLOUDFLARED_TOKEN, 'webhook');
    } else {
        logger.warn('[Webhook] No WEBHOOK_CLOUDFLARED_TOKEN provided. Webhook not accessible via tunnel.');
    }

    // Start main tunnel (Dashboard at pollbot.win)
    if (process.env.MAIN_CLOUDFLARED_TOKEN) {
        logger.info('[Webhook] Starting main tunnel (MAIN_CLOUDFLARED_TOKEN)...');
        startTunnel(process.env.MAIN_CLOUDFLARED_TOKEN, 'main');
    } else {
        logger.warn('[Webhook] No MAIN_CLOUDFLARED_TOKEN provided. Dashboard not accessible via tunnel.');
    }
}
