import { Router, Request, Response } from 'express';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';
import { canMemberPostPollInChannel, upsertGuildRow } from '../lib/guildUtils';
import { aggregateVotes, fetchAllPollVotes, getVoteCountsForPoll } from '../lib/voteUtils';
import { cancelPendingRender } from '../lib/renderQueue';
import { PollManager } from '../lib/pollManager';
import { validateCreatePoll, validateUpdatePollSettings } from './validation';
import { trackUsage } from '../lib/usageTracker';
import { getShardingManager } from '../webhook';
import { shardIdForGuild } from '../lib/shardUtils';
import { getSessionIdFromRequest, getValidDashboardSession, refreshAccessToken } from './dashboardAuth';

const router = Router();

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const BOT_TOKEN = process.env.DISCORD_TOKEN;
const MANAGE_GUILD = 0x20; // 32
const SNOWFLAKE_RE = /^\d{17,20}$/;

// Cache TTL: 30 minutes for guild-specific data
const GUILD_DATA_CACHE_TTL = 30 * 60 * 1000;
// Refresh cooldown: 5 minutes
const REFRESH_COOLDOWN = 5 * 60 * 1000;

// Rate limiting for poll mutations
const POLL_CREATE_LIMIT = 10; // max polls per window
const POLL_CREATE_WINDOW = 10 * 60 * 1000; // 10 minutes
const POLL_MUTATION_LIMIT = 30; // max status changes/deletes/edits per window  
const POLL_MUTATION_WINDOW = 60 * 1000; // 1 minute

// Rate limit tracking: Map<userId, { count: number, windowStart: number }>
const pollCreateRates = new Map<string, { count: number; windowStart: number }>();
const pollMutationRates = new Map<string, { count: number; windowStart: number }>();

/**
 * Check rate limit for a user action
 * Returns true if allowed, false if rate limited
 */
function checkRateLimit(
    userId: string,
    rateMap: Map<string, { count: number; windowStart: number }>,
    limit: number,
    windowMs: number
): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const userRate = rateMap.get(userId);

    if (!userRate || now - userRate.windowStart > windowMs) {
        // New window
        rateMap.set(userId, { count: 1, windowStart: now });
        return { allowed: true };
    }

    if (userRate.count >= limit) {
        const retryAfter = Math.ceil((userRate.windowStart + windowMs - now) / 1000);
        return { allowed: false, retryAfter };
    }

    userRate.count++;
    return { allowed: true };
}

// Cleanup stale rate limit and cache entries periodically
const rateCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, rate] of pollCreateRates) {
        if (now - rate.windowStart > POLL_CREATE_WINDOW * 2) {
            pollCreateRates.delete(key);
        }
    }
    for (const [key, rate] of pollMutationRates) {
        if (now - rate.windowStart > POLL_MUTATION_WINDOW * 2) {
            pollMutationRates.delete(key);
        }
    }
    for (const [key, entry] of mutationPermissionCache) {
        if (now - entry.timestamp > MUTATION_PERMISSION_TTL * 2) {
            mutationPermissionCache.delete(key);
        }
    }
    for (const [key, entry] of guildDataCache) {
        if (now - entry.timestamp > GUILD_DATA_CACHE_TTL * 2) {
            guildDataCache.delete(key);
        }
    }
}, 60000);
rateCleanupTimer.unref();

interface CachedGuildData {
    channels: CachedChannel[];
    roles: CachedRole[];
    cached_at: string;
}

interface CachedChannel {
    id: string;
    name: string;
    type: number; // 0 = text, 2 = voice, etc.
    position: number;
    parent_id: string | null;
    bot_can_post: boolean;
}

interface CachedRole {
    id: string;
    name: string;
    color: number;
    position: number;
    managed: boolean; // Bot/integration roles
}

interface DiscordChannel {
    id: string;
    name: string;
    type: number;
    position: number;
    parent_id?: string;
    permission_overwrites?: PermissionOverwrite[];
}

interface PermissionOverwrite {
    id: string;
    type: number; // 0 = role, 1 = member
    allow: string;
    deny: string;
}

interface DiscordRole {
    id: string;
    name: string;
    color: number;
    position: number;
    managed: boolean;
    permissions: string;
}

// In-memory cache for guild data (keyed by guildId)
const guildDataCache = new Map<string, { data: CachedGuildData; timestamp: number }>();

/**
 * Helper: Fetch channels and roles for a guild using bot token
 */
async function fetchGuildData(guildId: string): Promise<CachedGuildData | null> {
    if (!BOT_TOKEN) {
        logger.error('[PollManagement] BOT_TOKEN not configured');
        return null;
    }

    try {
        // Fetch channels
        const channelsRes = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/channels`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` },
        });

        if (!channelsRes.ok) {
            logger.error(`[PollManagement] Failed to fetch channels: ${channelsRes.status}`);
            return null;
        }

        const channels: DiscordChannel[] = await channelsRes.json();

        // Fetch roles
        const rolesRes = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/roles`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` },
        });

        if (!rolesRes.ok) {
            logger.error(`[PollManagement] Failed to fetch roles: ${rolesRes.status}`);
            return null;
        }

        const roles: DiscordRole[] = await rolesRes.json();

        // Get bot's member info and guild owner_id to determine channel permissions accurately
        const tokenParts = BOT_TOKEN!.split('.');
        const botId = Buffer.from(tokenParts[0] || '', 'base64').toString();
        const [memberRes, guildRes] = await Promise.all([
            fetch(`${DISCORD_API_BASE}/guilds/${guildId}/members/${botId}`, {
                headers: { Authorization: `Bot ${BOT_TOKEN}` },
            }),
            fetch(`${DISCORD_API_BASE}/guilds/${guildId}`, {
                headers: { Authorization: `Bot ${BOT_TOKEN}` },
            }),
        ]);

        let botRoleIds: string[] = [];
        if (memberRes.ok) {
            const member = await memberRes.json();
            botRoleIds = member.roles || [];
        }

        let guildOwnerId: string | undefined;
        if (guildRes.ok) {
            const guildObj = await guildRes.json();
            guildOwnerId = guildObj.owner_id;
        }

        // Calculate bot permissions per channel using Discord's full overwrite hierarchy
        const processedChannels: CachedChannel[] = channels
            .filter(ch => ch.type === 0 || ch.type === 5) // Text channels and announcement channels
            .map(ch => {
                const canPost = canMemberPostPollInChannel({
                    guildId,
                    memberId: botId,
                    isGuildOwner: Boolean(guildOwnerId && guildOwnerId === botId),
                    roles,
                    memberRoleIds: botRoleIds,
                    overwrites: ch.permission_overwrites,
                });
                return {
                    id: ch.id,
                    name: ch.name,
                    type: ch.type,
                    position: ch.position,
                    parent_id: ch.parent_id || null,
                    bot_can_post: canPost,
                };
            })
            .sort((a, b) => a.position - b.position);

        // Process roles (exclude @everyone for display, but include for restrictions)
        const processedRoles: CachedRole[] = roles
            .filter(r => !r.managed) // Exclude bot/integration managed roles
            .map(r => ({
                id: r.id,
                name: r.name,
                color: r.color,
                position: r.position,
                managed: r.managed,
            }))
            .sort((a, b) => b.position - a.position); // Highest first

        const cachedData: CachedGuildData = {
            channels: processedChannels,
            roles: processedRoles,
            cached_at: new Date().toISOString(),
        };

        // Store in memory cache
        guildDataCache.set(guildId, { data: cachedData, timestamp: Date.now() });

        logger.info(`[PollManagement] Cached ${processedChannels.length} channels and ${processedRoles.length} roles for guild ${guildId}`);

        return cachedData;
    } catch (error) {
        logger.error('[PollManagement] Error fetching guild data:', error);
        return null;
    }
}

/**
 * Helper: Get cached guild data or fetch if stale
 */
async function getGuildData(guildId: string, forceRefresh = false): Promise<CachedGuildData | null> {
    const cached = guildDataCache.get(guildId);

    if (!forceRefresh && cached && Date.now() - cached.timestamp < GUILD_DATA_CACHE_TTL) {
        return cached.data;
    }

    return fetchGuildData(guildId);
}

// Short-TTL cache of live Manage-Guild checks, so mutations re-verify against
// current Discord permissions (not just the login-time cached_guilds snapshot)
// without hammering the Discord API. Key: `${userId}:${guildId}`.
const mutationPermissionCache = new Map<string, { allowed: boolean; timestamp: number }>();
const MUTATION_PERMISSION_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Helper: Verify the session user currently has Manage Guild on the target guild.
 *
 * Poll mutations (create/close/delete/edit) are sensitive, so this verifies
 * against Discord live (cached for 5 minutes) rather than trusting the possibly
 * days-old `cached_guilds` snapshot taken at login. If Discord is unreachable it
 * falls back to that snapshot so a Discord outage does not lock legitimate users
 * out of managing their polls.
 */
async function verifyUserPermission(req: Request, guildId: string): Promise<{ valid: boolean; userId?: string; error?: string; status?: number }> {
    const session = await getValidDashboardSession(req);
    if (!session) {
        return { valid: false, error: 'Unauthorized', status: 401 };
    }

    const denied = { valid: false as const, error: 'You need Manage Server permission', status: 403 };
    const cacheKey = `${session.user_id}:${guildId}`;
    const cached = mutationPermissionCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < MUTATION_PERMISSION_TTL) {
        return cached.allowed ? { valid: true, userId: session.user_id } : denied;
    }

    // Live-verify against Discord using the session's access token (auto-refreshing on 401).
    try {
        let resp = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
        });

        if (resp.status === 401) {
            const refreshed = await refreshAccessToken(session.id);
            if (refreshed) {
                session.access_token = refreshed;
                resp = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
                    headers: { Authorization: `Bearer ${refreshed}` },
                });
            }
        }

        if (resp.ok) {
            const userGuilds = await resp.json() as Array<{ id: string; permissions: string; owner?: boolean }>;
            const guild = userGuilds.find(g => g.id === guildId);
            const allowed = !!guild && ((BigInt(guild.permissions) & BigInt(MANAGE_GUILD)) !== BigInt(0) || !!guild.owner);
            mutationPermissionCache.set(cacheKey, { allowed, timestamp: Date.now() });
            return allowed ? { valid: true, userId: session.user_id } : denied;
        }

        logger.warn(`[PollManagement] Live permission check failed (status ${resp.status}); falling back to cached guilds`);
    } catch (err) {
        logger.warn('[PollManagement] Live permission check error; falling back to cached guilds:', err);
    }

    // Fallback (only reached when Discord is unreachable): login-time snapshot.
    if (session.cached_guilds) {
        const guilds = session.cached_guilds as any[];
        const guild = guilds.find(g => g.id === guildId);
        if (guild) {
            const permissions = BigInt(guild.permissions);
            const hasManageGuild = (permissions & BigInt(MANAGE_GUILD)) !== BigInt(0) || guild.owner;
            if (hasManageGuild) {
                return { valid: true, userId: session.user_id };
            }
        }
    }

    return denied;
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /api/user/guilds/:id/channels
 * Returns cached channels for a guild with bot permission status
 */
router.get('/guilds/:id/channels', async (req: Request, res: Response) => {
    const guildId = req.params.id as string;
    const sessionId = getSessionIdFromRequest(req);

    if (!sessionId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!guildId || !SNOWFLAKE_RE.test(guildId)) {
        return res.status(400).json({ error: 'Valid guild ID is required' });
    }

    const permCheck = await verifyUserPermission(req, guildId);
    if (!permCheck.valid) {
        return res.status(permCheck.status || 403).json({ error: permCheck.error });
    }

    const guildData = await getGuildData(guildId);
    if (!guildData) {
        return res.status(502).json({ error: 'Failed to fetch channel data' });
    }

    return res.json({
        channels: guildData.channels,
        cached_at: guildData.cached_at,
    });
});

/**
 * GET /api/user/guilds/:id/roles
 * Returns cached roles for a guild
 */
router.get('/guilds/:id/roles', async (req: Request, res: Response) => {
    const guildId = req.params.id as string;
    const sessionId = getSessionIdFromRequest(req);

    if (!sessionId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!guildId || !SNOWFLAKE_RE.test(guildId)) {
        return res.status(400).json({ error: 'Valid guild ID is required' });
    }

    const permCheck = await verifyUserPermission(req, guildId);
    if (!permCheck.valid) {
        return res.status(permCheck.status || 403).json({ error: permCheck.error });
    }

    const guildData = await getGuildData(guildId);
    if (!guildData) {
        return res.status(502).json({ error: 'Failed to fetch role data' });
    }

    return res.json({
        roles: guildData.roles,
        cached_at: guildData.cached_at,
    });
});

/**
 * POST /api/user/guilds/:id/refresh
 * Force refresh channels and roles for a guild (5-min cooldown)
 */
router.post('/guilds/:id/refresh', async (req: Request, res: Response) => {
    const guildId = req.params.id as string;
    const sessionId = getSessionIdFromRequest(req);

    if (!sessionId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!guildId || !SNOWFLAKE_RE.test(guildId)) {
        return res.status(400).json({ error: 'Valid guild ID is required' });
    }

    const permCheck = await verifyUserPermission(req, guildId);
    if (!permCheck.valid) {
        return res.status(permCheck.status || 403).json({ error: permCheck.error });
    }

    // Check cooldown
    const cached = guildDataCache.get(guildId);
    if (cached) {
        const timeSinceCache = Date.now() - cached.timestamp;
        if (timeSinceCache < REFRESH_COOLDOWN) {
            const retryAfter = Math.ceil((REFRESH_COOLDOWN - timeSinceCache) / 1000);
            return res.status(429).json({
                error: 'Rate limited',
                retryAfter,
                message: `Please wait ${retryAfter} seconds before refreshing again`,
            });
        }
    }

    const guildData = await fetchGuildData(guildId);
    if (!guildData) {
        return res.status(502).json({ error: 'Failed to refresh guild data' });
    }

    logger.info(`[PollManagement] Manual refresh of guild ${guildId} by user ${permCheck.userId}`);

    return res.json({
        channels: guildData.channels,
        roles: guildData.roles,
        cached_at: guildData.cached_at,
    });
});

// ============================================================================
// POLL CRUD OPERATIONS
// ============================================================================

interface CreatePollRequest {
    guild_id: string;
    channel_id: string;
    title: string;
    description: string;
    options: string[];
    settings: {
        public?: boolean;
        allow_thread?: boolean;
        allow_close?: boolean;
        allow_exports?: boolean;
        max_votes?: number;
        min_votes?: number;
        allowed_roles?: string[];
        vote_weights?: Record<string, number>;
        role_metadata?: Record<string, { name: string; color: number }>;
    };
    /** Optional auto-close time (validated in validation.ts). */
    ends_at?: string | null;
}

/**
 * Helper: Load server-level button & locale settings for a guild.
 */
async function getGuildPollSettings(guildId: string): Promise<{
    serverAllowsButtons: boolean;
    serverLocale: string;
    globalWeights: Record<string, number>;
}> {
    const { data: guildSettings } = await supabase
        .from('guild_settings')
        .select('allow_poll_buttons, locale, vote_weights')
        .eq('guild_id', guildId)
        .maybeSingle();

    return {
        serverAllowsButtons: guildSettings?.allow_poll_buttons ?? true,
        serverLocale: guildSettings?.locale || 'en',
        globalWeights: (guildSettings?.vote_weights as Record<string, number>) || {},
    };
}

/**
 * Helper: Resolve Discord mentions (<@id>, <@&id>, <#id>) on the shard owning `guildId`.
 */
async function resolveMentionsOnShard(
    guildId: string,
    title: string,
    description: string,
    options: string[]
): Promise<{ title: string; description: string; options: string[] }> {
    const manager = getShardingManager();
    if (!manager) {
        return { title, description, options };
    }

    try {
        const results = await manager.broadcastEval(
            async (client, context) => {
                const guild = client.guilds.cache.get(context.guildId);
                if (!guild) return null;

                const allTexts = [context.title, context.description, ...context.options];
                const combined = allTexts.join('\n');
                if (!combined) {
                    return { title: context.title, description: context.description, options: context.options };
                }

                const replacements = new Map<string, string>();

                for (const match of combined.matchAll(/<@!?(\d+)>/g)) {
                    const fullMatch = match[0];
                    const id = match[1];
                    if (!fullMatch || !id || replacements.has(fullMatch)) continue;
                    const member = await guild.members.fetch(id).catch(() => null);
                    if (member) {
                        replacements.set(fullMatch, `@${member.displayName}`);
                    } else {
                        const user = await guild.client.users.fetch(id).catch(() => null);
                        if (user) replacements.set(fullMatch, `@${user.username}`);
                    }
                }

                for (const match of combined.matchAll(/<@&(\d+)>/g)) {
                    const fullMatch = match[0];
                    const id = match[1];
                    if (!fullMatch || !id || replacements.has(fullMatch)) continue;
                    const role = await guild.roles.fetch(id).catch(() => null);
                    if (role) replacements.set(fullMatch, `@${role.name}`);
                }

                for (const match of combined.matchAll(/<#(\d+)>/g)) {
                    const fullMatch = match[0];
                    const id = match[1];
                    if (!fullMatch || !id || replacements.has(fullMatch)) continue;
                    const channel = await guild.channels.fetch(id).catch(() => null);
                    if (channel && 'name' in channel && channel.name) {
                        replacements.set(fullMatch, `#${channel.name}`);
                    }
                }

                const applyReplacements = (str: string): string => {
                    if (!str) return str;
                    let out = str;
                    for (const [key, val] of replacements) {
                        out = out.split(key).join(val);
                    }
                    return out;
                };

                return {
                    title: applyReplacements(context.title),
                    description: applyReplacements(context.description),
                    options: context.options.map(applyReplacements),
                };
            },
            { context: { guildId, title, description, options } }
        );
        const match = results.find(r => r !== null);
        return match || { title, description, options };
    } catch (err) {
        logger.warn(`[PollManagement] Failed to resolve mentions on shard for guild ${guildId}:`, err);
        return { title, description, options };
    }
}

const CREATOR_LOOKUP_TIMEOUT_MS = 3000;

/**
 * Helper: Resolve the creator name shown on the rendered poll image the same
 * way the bot does (src/lib/pollManager.ts: `client.users.fetch(id).tag`),
 * evaluated on the shard that owns `guildId` (cache hit there is likeliest).
 * Falls back to the `users` table (dashboard logins only), then 'Unknown'.
 * Fail-safe: bounded by a timeout and never throws.
 */
async function resolveCreatorName(creatorId: string | null | undefined, guildId: string): Promise<string> {
    if (!creatorId || !SNOWFLAKE_RE.test(creatorId)) return 'Unknown';

    const manager = getShardingManager();
    if (manager && manager.shards.size > 0) {
        try {
            const totalShards = typeof manager.totalShards === 'number' ? manager.totalShards : manager.shards.size;
            const owningShard = shardIdForGuild(guildId, totalShards);
            const shard = manager.shards.has(owningShard) ? owningShard : manager.shards.keys().next().value;

            let timer: NodeJS.Timeout | undefined;
            const timeout = new Promise<null>(resolve => {
                timer = setTimeout(() => resolve(null), CREATOR_LOOKUP_TIMEOUT_MS);
                timer.unref();
            });
            const lookup = manager.broadcastEval(
                async (client, context) => {
                    const user = await client.users.fetch(context.creatorId).catch(() => null);
                    return user ? user.tag : null;
                },
                { context: { creatorId }, shard: shard as number }
            ).catch((err: unknown) => {
                logger.warn(`[PollManagement] Creator lookup failed for ${creatorId}:`, err);
                return null;
            });

            const tag = await Promise.race([lookup, timeout]);
            if (timer) clearTimeout(timer);
            if (typeof tag === 'string' && tag) return tag;
        } catch (err) {
            logger.warn(`[PollManagement] Creator lookup failed for ${creatorId}:`, err);
        }
    }

    try {
        const { data: userData } = await supabase
            .from('users')
            .select('username')
            .eq('id', creatorId)
            .maybeSingle();
        if (userData?.username) return userData.username;
    } catch (err) {
        logger.warn(`[PollManagement] users-table creator lookup failed for ${creatorId}:`, err);
    }

    return 'Unknown';
}

/**
 * POST /api/user/polls
 * Create a new poll - renders image, posts to Discord, saves to database
 */
router.post('/polls', async (req: Request, res: Response) => {
    const sessionId = getSessionIdFromRequest(req);
    if (!sessionId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Validate and sanitize the request body (snowflake formats, length caps,
    // vote/weight bounds). Replaces the previous presence-only checks.
    const validation = validateCreatePoll(req.body);
    if (!validation.success) {
        return res.status(400).json({ error: 'Invalid poll data', details: validation.errors });
    }
    const body = validation.data as CreatePollRequest;

    const permCheck = await verifyUserPermission(req, body.guild_id);
    if (!permCheck.valid) {
        return res.status(permCheck.status || 403).json({ error: permCheck.error });
    }

    // Rate limit check for poll creation
    const rateCheck = checkRateLimit(permCheck.userId!, pollCreateRates, POLL_CREATE_LIMIT, POLL_CREATE_WINDOW);
    if (!rateCheck.allowed) {
        return res.status(429).json({
            error: 'Rate limited',
            retryAfter: rateCheck.retryAfter,
            message: `You can create up to ${POLL_CREATE_LIMIT} polls every ${POLL_CREATE_WINDOW / 60000} minutes`,
        });
    }

    // Verify channel exists and bot can post
    const guildData = await getGuildData(body.guild_id);
    if (!guildData) {
        return res.status(502).json({ error: 'Failed to verify channel access' });
    }

    const channel = guildData.channels.find(ch => ch.id === body.channel_id);
    if (!channel) {
        return res.status(400).json({ error: 'Channel not found' });
    }
    if (!channel.bot_can_post) {
        return res.status(400).json({ error: 'Bot cannot post in this channel' });
    }

    try {
        const { Renderer } = await import('../lib/renderer');

        const shardingManager = getShardingManager();
        if (!shardingManager) {
            return res.status(503).json({ error: 'Bot not ready, please try again' });
        }

        const { serverAllowsButtons, serverLocale } = await getGuildPollSettings(body.guild_id);

        // Get user info for creator display (same resolution as the bot)
        const creatorName = await resolveCreatorName(permCheck.userId, body.guild_id);

        // Build poll settings (respecting guild-level allow_poll_buttons)
        const isPublic = body.settings?.public ?? true;
        const allowClose = serverAllowsButtons ? (body.settings?.allow_close ?? true) : false;
        const minVotes = body.settings?.min_votes ?? 1;
        const maxVotes = Math.min(body.settings?.max_votes ?? Math.max(1, minVotes), body.options.length);
        let createThread = body.settings?.allow_thread ?? false;

        // Resolve mentions against guild cache before rendering
        const resolved = await resolveMentionsOnShard(
            body.guild_id,
            body.title,
            body.description || '',
            body.options
        );

        // Render poll image (mirroring /poll: omit votes array when private)
        const renderOptions: any = {
            title: resolved.title,
            description: resolved.description,
            options: resolved.options,
            totalVotes: 0,
            creator: creatorName,
            closed: false,
            locale: serverLocale,
        };
        if (isPublic) {
            renderOptions.votes = body.options.map(() => 0);
        }

        const imageBuffer = await Renderer.renderPoll(renderOptions);
        const imageBase64 = imageBuffer.toString('base64');

        // Build localized components (Select Menu + Close Poll + View Details)
        const serializedComponents = PollManager.buildPollComponents({
            options: body.options,
            settings: {
                min_votes: minVotes,
                max_votes: maxVotes,
                allow_close: allowClose,
            },
            active: true,
            serverAllowsButtons,
            serverLocale,
        }).map(row => row.toJSON());

        const pollData = {
            channelId: body.channel_id,
            guildId: body.guild_id,
            title: body.title,
            imageBase64,
            components: serializedComponents,
            createThread,
        };

        const results = await shardingManager.broadcastEval(
            async (client, context) => {
                const guild = client.guilds.cache.get(context.guildId);
                if (!guild) return null;

                const targetChannel = guild.channels.cache.get(context.channelId)
                    ?? await guild.channels.fetch(context.channelId).catch(() => null);
                if (!targetChannel || !targetChannel.isTextBased()) return null;

                const { AttachmentBuilder } = require('discord.js');
                const imgBuf = Buffer.from(context.imageBase64, 'base64');
                const attachment = new AttachmentBuilder(imgBuf, { name: 'poll.png' });

                const message = await (targetChannel as any).send({
                    files: [attachment],
                    components: context.components,
                });

                let threadStarted = false;
                if (context.createThread && typeof message.startThread === 'function') {
                    try {
                        await message.startThread({
                            name: context.title.substring(0, 100),
                            autoArchiveDuration: 1440,
                        });
                        threadStarted = true;
                    } catch {
                        threadStarted = false;
                    }
                }

                return {
                    messageId: message.id,
                    channelId: message.channel.id,
                    threadStarted,
                    guild: {
                        id: guild.id,
                        name: guild.name,
                        member_count: guild.memberCount,
                        icon_url: guild.iconURL({ forceStatic: false }) || null,
                        locale: guild.preferredLocale,
                        joined_at: guild.joinedAt?.toISOString() || new Date().toISOString(),
                    },
                };
            },
            { context: pollData }
        );

        const successResult = results.find(r => r !== null);
        if (!successResult) {
            return res.status(500).json({ error: 'Failed to post poll to Discord' });
        }

        if (createThread && !successResult.threadStarted) {
            createThread = false;
        }

        const settings = {
            public: isPublic,
            allow_thread: createThread,
            allow_close: allowClose,
            allow_exports: body.settings?.allow_exports ?? true,
            max_votes: maxVotes,
            min_votes: minVotes,
            allowed_roles: body.settings?.allowed_roles ?? [],
            vote_weights: body.settings?.vote_weights ?? {},
            role_metadata: body.settings?.role_metadata,
        };

        // Save poll to database
        const pollRow = {
            message_id: successResult.messageId,
            channel_id: successResult.channelId,
            guild_id: body.guild_id,
            creator_id: permCheck.userId,
            title: body.title,
            description: body.description || '',
            options: body.options,
            settings,
            active: true,
            ends_at: body.ends_at ?? null,
        };

        let { data: savedPoll, error: dbError } = await supabase
            .from('polls')
            .insert(pollRow)
            .select()
            .single();

        // FK violation (23503): the guild row can be missing if the bot joined this
        // guild while offline or the sync failed. Sync it and retry once.
        if (dbError?.code === '23503' && successResult.guild) {
            logger.warn(`[PollManagement] Guild ${body.guild_id} missing from guilds table. Syncing and retrying poll insert...`);
            if (await upsertGuildRow(successResult.guild)) {
                ({ data: savedPoll, error: dbError } = await supabase
                    .from('polls')
                    .insert(pollRow)
                    .select()
                    .single());
            }
        }

        if (dbError) {
            logger.error('[PollManagement] Failed to save poll to database:', dbError);
            return res.status(500).json({ error: 'Poll posted but failed to save to database' });
        }

        logger.info(`[PollManagement] Poll created by ${permCheck.userId} in guild ${body.guild_id}: ${successResult.messageId}`);
        trackUsage({ source: 'dashboard', event_type: 'poll_create', guild_id: body.guild_id, user_id: permCheck.userId });

        return res.json({
            ...savedPoll,
            vote_counts: {},
            total_votes: 0,
        });
    } catch (error) {
        logger.error('[PollManagement] Error creating poll:', error);
        return res.status(500).json({ error: 'Failed to create poll' });
    }
});

/**
 * PATCH /api/user/polls/:pollId/status
 * Close or reopen a poll from the dashboard
 */
router.patch('/polls/:pollId/status', async (req: Request, res: Response) => {
    const sessionId = getSessionIdFromRequest(req);
    const pollId = req.params.pollId as string;
    const { active } = req.body as { active: boolean };

    if (!sessionId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!pollId || !SNOWFLAKE_RE.test(pollId)) {
        return res.status(400).json({ error: 'Valid poll ID is required' });
    }

    if (typeof active !== 'boolean') {
        return res.status(400).json({ error: 'active must be a boolean' });
    }

    try {
        // 1. Fetch poll and verify it exists
        const { data: pollData, error: pollError } = await supabase
            .from('polls')
            .select('*')
            .eq('message_id', pollId)
            .maybeSingle();

        if (pollError || !pollData) {
            return res.status(404).json({ error: 'Poll not found' });
        }

        // 2. Verify user has permission on this guild
        const permCheck = await verifyUserPermission(req, pollData.guild_id);
        if (!permCheck.valid) {
            return res.status(permCheck.status || 403).json({ error: permCheck.error || 'Permission denied' });
        }

        // Rate limit check for poll mutations
        const rateCheck = checkRateLimit(permCheck.userId!, pollMutationRates, POLL_MUTATION_LIMIT, POLL_MUTATION_WINDOW);
        if (!rateCheck.allowed) {
            return res.status(429).json({
                error: 'Rate limited',
                retryAfter: rateCheck.retryAfter,
                message: `Too many requests. Please wait ${rateCheck.retryAfter} seconds.`,
            });
        }

        cancelPendingRender(pollId);

        // 3. Get vote data for re-rendering (weighted — consistent with /close)
        const voteAgg = await aggregateVotes(pollId, pollData.options.length);
        if (voteAgg.error) {
            return res.status(500).json({ error: 'Failed to load vote data' });
        }
        const counts = voteAgg.counts;
        const totalVotes = voteAgg.totalWeight;

        const { serverAllowsButtons, serverLocale } = await getGuildPollSettings(pollData.guild_id);

        // 4. Get user info for creator display (same resolution as the bot)
        const creatorName = await resolveCreatorName(pollData.creator_id, pollData.guild_id);

        const dbUpdate: Record<string, any> = { active };
        if (active && pollData.ends_at && new Date(pollData.ends_at).getTime() <= Date.now()) {
            dbUpdate.ends_at = null;
        }

        // 5. Update Discord message via broadcastEval FIRST (matching PollManager.setPollStatus)
        const { Renderer } = await import('../lib/renderer');
        const shardingManager = getShardingManager();
        if (!shardingManager) {
            const { error: updateError } = await supabase
                .from('polls')
                .update(dbUpdate)
                .eq('message_id', pollId);
            if (updateError) {
                logger.error('[PollManagement] Failed to update poll status:', updateError);
                return res.status(500).json({ error: 'Failed to update poll status' });
            }
            logger.warn('[PollManagement] Sharding manager not available, Discord message not updated');
            trackUsage({ source: 'dashboard', event_type: active ? 'poll_reopen' : 'poll_close', guild_id: pollData.guild_id, user_id: permCheck.userId });
            return res.json({ ...pollData, ...dbUpdate });
        }

        const resolved = await resolveMentionsOnShard(
            pollData.guild_id,
            pollData.title,
            pollData.description || '',
            pollData.options
        );

        const showVotes = !active || (pollData.settings && pollData.settings.public !== false);

        const renderOptions: any = {
            title: resolved.title,
            description: resolved.description,
            options: resolved.options,
            totalVotes,
            creator: creatorName,
            closed: !active,
            locale: serverLocale,
        };

        if (showVotes) {
            renderOptions.votes = counts;
        }

        const imageBuffer = await Renderer.renderPoll(renderOptions);
        const imageBase64 = imageBuffer.toString('base64');

        const serializedComponents = PollManager.buildPollComponents({
            options: pollData.options,
            settings: pollData.settings,
            active,
            serverAllowsButtons,
            serverLocale,
        }).map(row => row.toJSON());

        const updateContext = {
            guildId: pollData.guild_id,
            channelId: pollData.channel_id,
            messageId: pollId,
            imageBase64,
            components: serializedComponents,
        };

        const broadcastResults = await shardingManager.broadcastEval(
            async (client, context) => {
                const { guildId, channelId, messageId, imageBase64, components } = context;
                if (!client.guilds.cache.has(guildId)) return null;

                const { AttachmentBuilder } = await import('discord.js');

                try {
                    const channel = client.channels.cache.get(channelId)
                        ?? await client.channels.fetch(channelId);
                    if (!channel || !channel.isTextBased()) {
                        return { success: false, error: 'Channel not found' };
                    }

                    const message = await (channel as any).messages.fetch(messageId);
                    if (!message) return { success: false, error: 'Message not found' };

                    const imageBufferFromBase64 = Buffer.from(imageBase64, 'base64');
                    const attachment = new AttachmentBuilder(imageBufferFromBase64, { name: 'poll.png' });

                    await message.edit({
                        files: [attachment],
                        components,
                    });

                    return { success: true };
                } catch (err: any) {
                    if (err.code === 10008 || err.message?.includes('Unknown Message')) {
                        return { success: false, error: 'message_deleted' };
                    }
                    if (err.code === 10003) {
                        return { success: false, error: 'message_deleted' };
                    }
                    if (err.code === 50001 || err.code === 50013) {
                        const missingPerms: string[] = [];
                        if (err.code === 50001) {
                            missingPerms.push('View Channel');
                        } else {
                            const errMsg = err.message?.toLowerCase() || '';
                            if (errMsg.includes('send') || errMsg.includes('message')) {
                                missingPerms.push('Send Messages');
                            }
                            if (errMsg.includes('attach') || errMsg.includes('file')) {
                                missingPerms.push('Attach Files');
                            }
                            if (errMsg.includes('embed')) {
                                missingPerms.push('Embed Links');
                            }
                            if (missingPerms.length === 0) {
                                missingPerms.push('Send Messages', 'Attach Files');
                            }
                        }
                        return {
                            success: false,
                            error: 'missing_permissions',
                            missing_permissions: missingPerms,
                            error_code: err.code,
                        };
                    }
                    return { success: false, error: err.message };
                }
            },
            { context: updateContext }
        );

        const results = (Array.isArray(broadcastResults) ? broadcastResults : [broadcastResults]).filter(r => r !== null);
        const messageDeleted = results.some((r: any) => r?.error === 'message_deleted');

        if (messageDeleted) {
            logger.warn(`[PollManagement] Poll ${pollId} Discord message was deleted`);

            await supabase
                .from('polls')
                .update({ active: false, discord_deleted: true })
                .eq('message_id', pollId);

            return res.status(410).json({
                error: 'Discord message deleted',
                message_deleted: true,
                poll: { ...pollData, active: false, discord_deleted: true }
            });
        }

        const permissionError = results.find((r: any) => r?.error === 'missing_permissions');
        if (permissionError) {
            logger.warn(`[PollManagement] Poll ${pollId} has permission issues: ${JSON.stringify(permissionError.missing_permissions)}`);

            return res.status(403).json({
                error: 'Bot missing permissions',
                permission_error: true,
                missing_permissions: permissionError.missing_permissions || ['View Channel', 'Send Messages', 'Attach Files'],
                channel_id: pollData.channel_id,
                poll: pollData
            });
        }

        const succeeded = results.some((r: any) => r?.success === true);
        if (!succeeded) {
            logger.error(`[PollManagement] Failed to update Discord message for poll ${pollId}:`, results);
            return res.status(502).json({ error: 'Failed to update poll message on Discord' });
        }

        // 6. Persist status change in DB after Discord edit succeeded
        const { error: updateError } = await supabase
            .from('polls')
            .update(dbUpdate)
            .eq('message_id', pollId);

        if (updateError) {
            logger.error('[PollManagement] Failed to update poll status in DB after Discord edit:', updateError);
            return res.status(500).json({ error: 'Failed to update poll status' });
        }

        logger.info(`[PollManagement] Poll ${pollId} status updated to ${active ? 'active' : 'closed'} by ${permCheck.userId}`);
        trackUsage({ source: 'dashboard', event_type: active ? 'poll_reopen' : 'poll_close', guild_id: pollData.guild_id, user_id: permCheck.userId });

        return res.json({ ...pollData, ...dbUpdate });
    } catch (error) {
        logger.error('[PollManagement] Error updating poll status:', error);
        return res.status(500).json({ error: 'Failed to update poll status' });
    }
});

/**
 * DELETE /api/user/polls/:pollId
 * Delete a poll from the database (useful for orphaned polls where Discord message was deleted)
 */
router.delete('/polls/:pollId', async (req: Request, res: Response) => {
    const sessionId = getSessionIdFromRequest(req);
    const pollId = req.params.pollId as string;

    if (!sessionId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!pollId || !SNOWFLAKE_RE.test(pollId)) {
        return res.status(400).json({ error: 'Valid poll ID is required' });
    }

    try {
        // 1. Fetch poll to verify it exists and get guild_id
        const { data: pollData, error: pollError } = await supabase
            .from('polls')
            .select('guild_id, title')
            .eq('message_id', pollId)
            .maybeSingle();

        if (pollError || !pollData) {
            return res.status(404).json({ error: 'Poll not found' });
        }

        // 2. Verify user has permission
        const permCheck = await verifyUserPermission(req, pollData.guild_id);
        if (!permCheck.valid) {
            return res.status(permCheck.status || 403).json({ error: permCheck.error || 'Permission denied' });
        }

        // Rate limit check for poll mutations
        const rateCheck = checkRateLimit(permCheck.userId!, pollMutationRates, POLL_MUTATION_LIMIT, POLL_MUTATION_WINDOW);
        if (!rateCheck.allowed) {
            return res.status(429).json({
                error: 'Rate limited',
                retryAfter: rateCheck.retryAfter,
                message: `Too many requests. Please wait ${rateCheck.retryAfter} seconds.`,
            });
        }

        cancelPendingRender(pollId);

        // 3. Delete votes first (foreign key constraint)
        await supabase
            .from('votes')
            .delete()
            .eq('poll_id', pollId);

        // 4. Delete the poll
        const { error: deleteError } = await supabase
            .from('polls')
            .delete()
            .eq('message_id', pollId);

        if (deleteError) {
            logger.error('[PollManagement] Failed to delete poll:', deleteError);
            return res.status(500).json({ error: 'Failed to delete poll' });
        }

        logger.info(`[PollManagement] Poll ${pollId} (${pollData.title}) deleted by ${permCheck.userId}`);
        trackUsage({ source: 'dashboard', event_type: 'poll_delete', guild_id: pollData.guild_id, user_id: permCheck.userId });

        return res.json({ success: true, deleted: pollId });
    } catch (error) {
        logger.error('[PollManagement] Error deleting poll:', error);
        return res.status(500).json({ error: 'Failed to delete poll' });
    }
});

/**
 * PATCH /api/user/polls/:pollId
 * Edit poll settings (not title/options to preserve vote integrity)
 */
router.patch('/polls/:pollId', async (req: Request, res: Response) => {
    const sessionId = getSessionIdFromRequest(req);
    const pollId = req.params.pollId as string;
    const { settings: rawSettings } = req.body as { settings?: unknown };

    if (!sessionId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!pollId || !SNOWFLAKE_RE.test(pollId)) {
        return res.status(400).json({ error: 'Valid poll ID is required' });
    }

    if (!rawSettings || typeof rawSettings !== 'object') {
        return res.status(400).json({ error: 'settings object required' });
    }

    const settingsValidation = validateUpdatePollSettings(rawSettings);
    if (!settingsValidation.success || !settingsValidation.data) {
        return res.status(400).json({ error: 'Invalid settings', details: settingsValidation.errors });
    }
    const newSettings = settingsValidation.data;

    try {
        // 1. Fetch poll
        const { data: pollData, error: pollError } = await supabase
            .from('polls')
            .select('*')
            .eq('message_id', pollId)
            .maybeSingle();

        if (pollError || !pollData) {
            return res.status(404).json({ error: 'Poll not found' });
        }

        // 2. Verify permissions
        const permCheck = await verifyUserPermission(req, pollData.guild_id);
        if (!permCheck.valid) {
            return res.status(permCheck.status || 403).json({ error: permCheck.error || 'Permission denied' });
        }

        // Rate limit check for poll mutations
        const rateCheck = checkRateLimit(permCheck.userId!, pollMutationRates, POLL_MUTATION_LIMIT, POLL_MUTATION_WINDOW);
        if (!rateCheck.allowed) {
            return res.status(429).json({
                error: 'Rate limited',
                retryAfter: rateCheck.retryAfter,
                message: `Too many requests. Please wait ${rateCheck.retryAfter} seconds.`,
            });
        }

        cancelPendingRender(pollId);

        const { serverAllowsButtons, serverLocale, globalWeights } = await getGuildPollSettings(pollData.guild_id);

        // 3. Merge validated settings (only allowed fields)
        const currentSettings = pollData.settings || {};
        const requestedAllowClose = newSettings.allow_close ?? currentSettings.allow_close;
        const updatedSettings = {
            ...currentSettings,
            public: newSettings.public ?? currentSettings.public,
            allow_close: serverAllowsButtons ? requestedAllowClose : false,
            allow_exports: newSettings.allow_exports ?? currentSettings.allow_exports,
            allowed_roles: newSettings.allowed_roles ?? currentSettings.allowed_roles,
            vote_weights: newSettings.vote_weights ?? currentSettings.vote_weights,
            role_metadata: newSettings.role_metadata ?? currentSettings.role_metadata,
        };

        // 4. Update database
        const { error: updateError } = await supabase
            .from('polls')
            .update({ settings: updatedSettings })
            .eq('message_id', pollId);

        if (updateError) {
            logger.error('[PollManagement] Failed to update poll settings:', updateError);
            return res.status(500).json({ error: 'Failed to update poll settings' });
        }

        const shardingManager = getShardingManager();

        // 5. Recalculate vote weights if vote_weights changed (combining global + poll weights)
        const oldWeights = JSON.stringify(currentSettings.vote_weights || {});
        const newWeightsStr = JSON.stringify(updatedSettings.vote_weights || {});
        const weightsChanged = oldWeights !== newWeightsStr;
        const publicChanged = (currentSettings.public !== false) !== (updatedSettings.public !== false);
        const allowCloseChanged = (currentSettings.allow_close !== false) !== (updatedSettings.allow_close !== false);

        if (weightsChanged) {
            logger.info(`[PollManagement] Vote weights changed for poll ${pollId}, recalculating...`);

            const { data: votes } = await fetchAllPollVotes(pollId);

            if (votes && votes.length > 0 && shardingManager) {
                const uniqueUserIds = [...new Set(votes.map(v => v.user_id))];

                const memberWeights = await shardingManager.broadcastEval(
                    async (
                        client: any,
                        context: {
                            guildId: string;
                            userIds: string[];
                            globalWeights: Record<string, number>;
                            pollWeights: Record<string, number>;
                        }
                    ) => {
                        const { guildId, userIds, globalWeights: gWeights, pollWeights: pWeights } = context;
                        const guild = client.guilds.cache.get(guildId);
                        if (!guild) return [];

                        const results: Array<{ userId: string; weight: number }> = [];

                        for (const userId of userIds) {
                            try {
                                const member = await guild.members.fetch(userId).catch(() => null);
                                if (member) {
                                    let maxWeight = 1;
                                    for (const roleId of member.roles.cache.keys()) {
                                        const gw = gWeights[roleId];
                                        if (gw && gw > maxWeight) maxWeight = gw;
                                        const pw = pWeights[roleId];
                                        if (pw && pw > maxWeight) maxWeight = pw;
                                    }
                                    results.push({ userId, weight: maxWeight });
                                }
                            } catch {
                                // Member not found, keep default weight
                            }
                        }

                        return results;
                    },
                    {
                        context: {
                            guildId: pollData.guild_id,
                            userIds: uniqueUserIds,
                            globalWeights,
                            pollWeights: updatedSettings.vote_weights || {},
                        }
                    }
                );

                const flatResults = (Array.isArray(memberWeights) ? memberWeights : [memberWeights])
                    .flat()
                    .filter((r): r is { userId: string; weight: number } => r !== null && typeof r === 'object');

                const weightMap = new Map<string, number>();
                for (const result of flatResults) {
                    weightMap.set(result.userId, result.weight);
                }

                for (const userId of uniqueUserIds) {
                    const newWeight = weightMap.get(userId) || 1;
                    await supabase
                        .from('votes')
                        .update({ weight: newWeight })
                        .eq('poll_id', pollId)
                        .eq('user_id', userId);
                }

                logger.info(`[PollManagement] Recalculated weights for ${uniqueUserIds.length} voters on poll ${pollId}`);
            }
        }

        // 6. Re-render and update Discord message whenever visual/component settings changed
        if ((weightsChanged || publicChanged || allowCloseChanged) && shardingManager && !pollData.discord_deleted) {
            const updatedAgg = await aggregateVotes(pollId, pollData.options.length);
            if (updatedAgg.error) {
                throw new Error('Failed to aggregate votes for poll settings update');
            }

            const creatorName = await resolveCreatorName(pollData.creator_id, pollData.guild_id);

            const resolved = await resolveMentionsOnShard(
                pollData.guild_id,
                pollData.title,
                pollData.description || '',
                pollData.options
            );

            const { Renderer } = await import('../lib/renderer');
            const showVotes = !pollData.active || updatedSettings.public !== false;

            const renderOptions: any = {
                title: resolved.title,
                description: resolved.description,
                options: resolved.options,
                totalVotes: updatedAgg.totalWeight,
                creator: creatorName,
                closed: !pollData.active,
                locale: serverLocale,
            };

            if (showVotes) {
                renderOptions.votes = updatedAgg.counts;
            }

            const imageBuffer = await Renderer.renderPoll(renderOptions);
            const imageBase64 = imageBuffer.toString('base64');

            const serializedComponents = PollManager.buildPollComponents({
                options: pollData.options,
                settings: updatedSettings,
                active: pollData.active,
                serverAllowsButtons,
                serverLocale,
            }).map(row => row.toJSON());

            await shardingManager.broadcastEval(
                async (client: any, context: any) => {
                    const { guildId, channelId, messageId, imageBase64: imgB64, components } = context;
                    if (!client.guilds.cache.has(guildId)) return null;
                    const { AttachmentBuilder } = await import('discord.js');

                    try {
                        const channel = client.channels.cache.get(channelId)
                            ?? await client.channels.fetch(channelId);
                        if (!channel || !channel.isTextBased()) return null;

                        const message = await (channel as any).messages.fetch(messageId);
                        if (!message) return null;

                        const imageBufferFromBase64 = Buffer.from(imgB64, 'base64');
                        const attachment = new AttachmentBuilder(imageBufferFromBase64, { name: 'poll.png' });

                        await message.edit({ files: [attachment], components });
                        return { success: true };
                    } catch {
                        return null;
                    }
                },
                {
                    context: {
                        guildId: pollData.guild_id,
                        channelId: pollData.channel_id,
                        messageId: pollId,
                        imageBase64,
                        components: serializedComponents,
                    }
                }
            );

            logger.info(`[PollManagement] Updated Discord message for poll ${pollId} after settings edit`);
        }

        const { voteCounts, totalVotes, uniqueVoters, error: countsError } = await getVoteCountsForPoll(
            pollId,
            pollData.options as string[]
        );

        logger.info(`[PollManagement] Poll ${pollId} settings updated by ${permCheck.userId}`);
        trackUsage({ source: 'dashboard', event_type: 'poll_edit', guild_id: pollData.guild_id, user_id: permCheck.userId });

        return res.json({
            ...pollData,
            settings: updatedSettings,
            vote_counts: countsError ? null : voteCounts,
            total_votes: countsError ? null : totalVotes,
            unique_voters: countsError ? null : uniqueVoters,
            counts_error: countsError,
        });
    } catch (error) {
        logger.error('[PollManagement] Error updating poll settings:', error);
        return res.status(500).json({ error: 'Failed to update poll settings' });
    }
});

export const pollManagementRouter = router;



