import express from 'express';
import { Webhook } from '@top-gg/sdk';
import { tunnel } from 'cloudflared';
import { logger } from './lib/logger';
import { supabase } from './lib/db';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = 5000;

// Top.gg Webhook
const webhook = new Webhook(process.env.TOPGG_WEBHOOK_AUTH || 'default_auth');

app.get('/health', (req, res) => {
    res.status(200).send('OK');
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

// ... (existing imports except cloudflared)

export async function startWebhookServer() {
    app.listen(port, () => {
        logger.info(`[Webhook] Server listening on port ${port}`);
    });

    if (process.env.CLOUDFLARED_TOKEN) {
        logger.info('[Webhook] Found CLOUDFLARED_TOKEN, attempting to start tunnel via binary...');

        // Dynamically locate the cloudflared binary from the npm package
        // This ensures it works on Linux, macOS, and Windows regardless of CWD
        const cloudflaredDir = path.dirname(require.resolve('cloudflared'));
        const binaryName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
        const binaryPath = path.join(cloudflaredDir, 'bin', binaryName);

        try {
            const child = spawn(binaryPath, ['tunnel', 'run', '--token', process.env.CLOUDFLARED_TOKEN]);

            child.stdout.on('data', (data) => {
                logger.info(`[cloudflared] ${data.toString().trim()}`);
            });

            child.stderr.on('data', (data) => {
                // cloudflared often logs info to stderr
                logger.info(`[cloudflared] ${data.toString().trim()}`);
            });

            child.on('error', (err) => {
                logger.error('[Webhook] Failed to spawn cloudflared binary:', err);
            });

            child.on('close', (code) => {
                logger.warn(`[Webhook] Cloudflare Tunnel process exited with code ${code}`);
            });

            // Handle shutdown
            process.on('SIGINT', () => {
                logger.info('[Webhook] Stopping Cloudflare Tunnel...');
                child.kill();
            });
            process.on('SIGTERM', () => {
                logger.info('[Webhook] Stopping Cloudflare Tunnel...');
                child.kill();
            });

        } catch (error) {
            logger.error('[Webhook] Error starting tunnel:', error);
        }
    } else {
        logger.warn('[Webhook] No CLOUDFLARED_TOKEN provided. Webhook is not publicly accessible via Tunnel.');
    }
}
