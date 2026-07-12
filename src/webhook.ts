import express from 'express';
import cookieParser from 'cookie-parser';
import { tunnel } from 'cloudflared';
import { logger } from './lib/logger';
import { supabase } from './lib/db';
import { classifyVoteWebhook, BotListVoteEvent } from './lib/botListVotes';
import { dashboardAuthRouter } from './webapp/dashboardAuth';
import { ensureCsrfToken, validateCsrfToken, getCsrfTokenHandler } from './webapp/csrf';
import dotenv from 'dotenv';
import { ShardingManager } from 'discord.js';

dotenv.config();

const app = express();
const port = 5000;

// Middleware. The raw body is kept for the /vote route: Top.gg v1 webhooks
// are authenticated by an HMAC over the exact bytes received.
app.use(express.json({
    verify: (req, _res, buf) => {
        (req as any).rawBody = buf;
    }
}));
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

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Admin-only endpoint to sync all guilds from Discord
// This triggers all shards to re-fetch guild data
const ADMIN_IDS = (process.env.DISCORD_ADMIN_IDS || '').split(',').map(id => id.trim()).filter(Boolean);

// Resolve the admin user behind a request, or null. Supports both cookie and
// header auth like the dashboard's apiFetch.
async function getAdminUserId(req: express.Request): Promise<string | null> {
    const cookieSession = req.cookies?.['pollbot_session'];
    const headerSession = req.headers.authorization?.replace('Bearer ', '');
    const sessionId = cookieSession || headerSession;
    if (!sessionId) return null;

    const { data: session } = await supabase
        .from('dashboard_sessions')
        .select('user_id')
        .eq('id', sessionId)
        .single();

    if (!session || !ADMIN_IDS.includes(session.user_id)) return null;
    return session.user_id;
}

app.post('/api/admin/sync-guilds', async (req, res) => {
    const adminUserId = await getAdminUserId(req);
    if (!adminUserId) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    if (!shardingManager) {
        logger.warn('[Webhook] Sync requested but ShardingManager not available');
        return res.status(503).json({ error: 'Bot not ready, try again later' });
    }

    try {
        logger.info(`[Webhook] Admin sync triggered by user ${adminUserId}`);

        // Send the sync trigger from the manager to each shard process. The
        // shard-side GuildSyncService listens on process 'message' for messages
        // FROM the manager, so we must use shard.send() here. (The previous
        // broadcastEval + process.send ran inside the shard and delivered the
        // message back to the manager, where nothing listens — a silent no-op.)
        await Promise.all(
            [...shardingManager.shards.values()].map(shard =>
                shard.send({ type: 'SYNC_ALL_GUILDS' }).catch(err =>
                    logger.warn(`[Webhook] Failed to signal shard ${shard.id} to sync:`, err)
                )
            )
        );

        return res.json({ success: true, message: 'Guild sync initiated on all shards' });
    } catch (error) {
        logger.error('[Webhook] Failed to trigger sync:', error);
        return res.status(500).json({ error: 'Failed to trigger sync' });
    }
});

// Admin-only voter analytics. get_top_botlist_voters returns per-user rows
// (ids + usernames), so it is service_role-only in Postgres and must be
// reached through this authenticated route — never the anon key.
app.get('/api/admin/vote-analytics', async (req, res) => {
    const adminUserId = await getAdminUserId(req);
    if (!adminUserId) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const days = Math.min(Math.max(parseInt(String(req.query.days), 10) || 30, 1), 365);

    try {
        const [topVoters, totals] = await Promise.all([
            supabase.rpc('get_top_botlist_voters', { p_days: days, p_limit: 10 }),
            supabase.rpc('get_botlist_vote_totals'),
        ]);

        if (topVoters.error || totals.error) {
            logger.error('[Webhook] Vote analytics query failed:', topVoters.error || totals.error);
            return res.status(500).json({ error: 'Failed to load vote analytics' });
        }

        return res.json({
            days,
            topVoters: topVoters.data ?? [],
            totals: totals.data ?? [],
        });
    } catch (error) {
        logger.error('[Webhook] Vote analytics failed:', error);
        return res.status(500).json({ error: 'Failed to load vote analytics' });
    }
});

// Unified bot-list vote webhook (Top.gg legacy v0, Top.gg v1 signed events,
// and DiscordForge all POST to the same public URL). Secrets/signatures are
// the ONLY authenticity check on this route (CSRF is intentionally skipped
// for it), so we require real secrets rather than falling back to guessable
// defaults. With no secret configured the route is not registered at all —
// better a disabled webhook than one that lets anyone grant premium.
const VOTE_WEBHOOK_SECRETS = {
    topggAuth: process.env.TOPGG_WEBHOOK_AUTH || undefined,
    topggSignatureSecret: process.env.TOPGG_WEBHOOK_SECRET || undefined,
    discordForgeAuth: process.env.DISCORDFORGE_WEBHOOK_AUTH || undefined,
};

async function recordBotListVote(vote: BotListVoteEvent): Promise<void> {
    // Full event row (test votes included, flagged) for voter analytics.
    const { error: insertError } = await supabase
        .from('botlist_votes')
        .insert({
            source: vote.source,
            user_id: vote.userId,
            username: vote.username ?? null,
            avatar_url: vote.avatarUrl ?? null,
            weight: vote.weight,
            is_test: vote.isTest,
            is_weekend: vote.isWeekend ?? null,
            weekly_votes: vote.weeklyVotes ?? null,
            total_votes: vote.totalVotes ?? null,
            query: vote.query ?? null,
        });

    if (insertError) {
        logger.error(`[Webhook] Failed to record ${vote.source} vote for user ${vote.userId}:`, insertError);
    }

    // Test votes must not grant the premium window.
    if (vote.isTest) return;

    const userUpdate: Record<string, string> = {
        id: vote.userId,
        last_vote_at: new Date().toISOString(),
    };
    // Enrich the user record when the list told us who voted, but never
    // blank out fields the payload didn't include.
    if (vote.username) userUpdate.username = vote.username;
    if (vote.avatarUrl) userUpdate.avatar_url = vote.avatarUrl;

    const { error: upsertError } = await supabase
        .from('users')
        .upsert(userUpdate, { onConflict: 'id' });

    if (upsertError) {
        logger.error(`[Webhook] Failed to update vote timestamp for user ${vote.userId}:`, upsertError);
    }
}

if (VOTE_WEBHOOK_SECRETS.topggAuth || VOTE_WEBHOOK_SECRETS.topggSignatureSecret || VOTE_WEBHOOK_SECRETS.discordForgeAuth) {
    app.post('/vote', async (req, res) => {
        const result = classifyVoteWebhook(
            {
                authorization: req.headers.authorization,
                'x-topgg-signature': req.headers['x-topgg-signature'] as string | undefined,
            },
            (req as any).rawBody ?? Buffer.alloc(0),
            req.body,
            VOTE_WEBHOOK_SECRETS
        );

        if (!result.ok) {
            // 204 = authentic but nothing to record (e.g. Top.gg ping events).
            if (result.status === 204) {
                logger.info(`[Webhook] ${result.reason}`);
                return res.status(204).end();
            }
            logger.warn(`[Webhook] Rejected vote webhook (${result.status}): ${result.reason}`);
            return res.status(result.status).json({ error: result.reason });
        }

        const vote = result.event;
        logger.info(`[Webhook] Received ${vote.source} vote from user ${vote.userId}${vote.isTest ? ' (test)' : ''}`);

        try {
            await recordBotListVote(vote);
        } catch (err) {
            // Swallow: both lists retry on non-2xx, and a retried delivery
            // would double-count the vote in analytics.
            logger.error(`[Webhook] Unexpected error processing ${vote.source} vote for user ${vote.userId}:`, err);
        }

        return res.status(200).json({ success: true });
    });

    const enabled = [
        VOTE_WEBHOOK_SECRETS.topggAuth ? 'Top.gg v0' : null,
        VOTE_WEBHOOK_SECRETS.topggSignatureSecret ? 'Top.gg v1' : null,
        VOTE_WEBHOOK_SECRETS.discordForgeAuth ? 'DiscordForge' : null,
    ].filter(Boolean).join(', ');
    logger.info(`[Webhook] /vote endpoint enabled for: ${enabled}`);
} else {
    logger.warn('[Webhook] No vote webhook secrets set (TOPGG_WEBHOOK_AUTH / TOPGG_WEBHOOK_SECRET / DISCORDFORGE_WEBHOOK_AUTH) — the /vote endpoint is DISABLED.');
}

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
