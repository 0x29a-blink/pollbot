import { Router, Request, Response } from 'express';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';
import { getShardingManager } from '../webhook';

const router = Router();

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const BOT_TOKEN = process.env.DISCORD_TOKEN;
const MANAGE_GUILD = 0x20; // 32

// Permission flags for channel access
const SEND_MESSAGES = 0x800n; // 2048
const ATTACH_FILES = 0x8000n; // 32768
const VIEW_CHANNEL = 0x400n; // 1024

// Cache TTL: 30 minutes for guild-specific data
const GUILD_DATA_CACHE_TTL = 30 * 60 * 1000;
// Refresh cooldown: 5 minutes
const REFRESH_COOLDOWN = 5 * 60 * 1000;

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

        // Get bot's member info to determine permissions
        const tokenParts = BOT_TOKEN!.split('.');
        const botId = Buffer.from(tokenParts[0] || '', 'base64').toString();
        const memberRes = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/members/${botId}`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` },
        });

        let botRoleIds: string[] = [];
        if (memberRes.ok) {
            const member = await memberRes.json();
            botRoleIds = member.roles || [];
        }

        // Calculate bot permissions per channel
        const processedChannels: CachedChannel[] = channels
            .filter(ch => ch.type === 0 || ch.type === 5) // Text channels and announcement channels
            .map(ch => {
                const canPost = canBotPostInChannel(ch, roles, botRoleIds, guildId);
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
 * Helper: Check if bot can post in a channel
 */
function canBotPostInChannel(
    channel: DiscordChannel,
    roles: DiscordRole[],
    botRoleIds: string[],
    guildId: string
): boolean {
    // Start with base permissions from roles
    let allow = 0n;
    let deny = 0n;

    // Get @everyone role permissions (guildId is the @everyone role id)
    const everyoneRole = roles.find(r => r.id === guildId);
    if (everyoneRole) {
        allow |= BigInt(everyoneRole.permissions);
    }

    // Add bot's role permissions
    for (const roleId of botRoleIds) {
        const role = roles.find(r => r.id === roleId);
        if (role) {
            allow |= BigInt(role.permissions);
        }
    }

    // Apply channel permission overwrites
    if (channel.permission_overwrites) {
        // First apply role overwrites
        for (const overwrite of channel.permission_overwrites) {
            if (overwrite.type === 0) { // Role overwrite
                if (overwrite.id === guildId || botRoleIds.includes(overwrite.id)) {
                    deny |= BigInt(overwrite.deny);
                    allow |= BigInt(overwrite.allow);
                }
            }
        }
        // Then apply member-specific overwrites (would need bot member id)
    }

    // Check required permissions
    const finalPerms = (allow & ~deny);
    const hasViewChannel = (finalPerms & VIEW_CHANNEL) !== 0n;
    const hasSendMessages = (finalPerms & SEND_MESSAGES) !== 0n;
    const hasAttachFiles = (finalPerms & ATTACH_FILES) !== 0n;

    return hasViewChannel && hasSendMessages && hasAttachFiles;
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

/**
 * Helper: Verify user has Manage Guild permission
 */
async function verifyUserPermission(sessionId: string, guildId: string): Promise<{ valid: boolean; userId?: string; error?: string; status?: number }> {
    const { data: session, error: sessionError } = await supabase
        .from('dashboard_sessions')
        .select('user_id, access_token, expires_at, cached_guilds')
        .eq('id', sessionId)
        .single();

    if (sessionError || !session) {
        return { valid: false, error: 'Invalid session', status: 401 };
    }

    if (new Date(session.expires_at).getTime() < Date.now()) {
        return { valid: false, error: 'Session expired', status: 401 };
    }

    // Check cached guilds for permission
    if (session.cached_guilds) {
        const guilds = session.cached_guilds as any[];
        const guild = guilds.find(g => g.id === guildId);
        if (guild) {
            const permissions = BigInt(guild.permissions);
            const hasManageGuild = (permissions & BigInt(MANAGE_GUILD)) !== 0n || guild.owner;
            if (hasManageGuild) {
                return { valid: true, userId: session.user_id };
            }
        }
    }

    return { valid: false, error: 'You need Manage Server permission', status: 403 };
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /api/user/guilds/:id/channels
 * Returns cached channels for a guild with bot permission status
 */
router.get('/guilds/:id/channels', async (req: Request, res: Response) => {
    const guildId = req.params.id;
    const authHeader = req.headers.authorization;
    const sessionId = authHeader?.replace('Bearer ', '');

    if (!sessionId || !guildId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const permCheck = await verifyUserPermission(sessionId, guildId);
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
    const guildId = req.params.id;
    const authHeader = req.headers.authorization;
    const sessionId = authHeader?.replace('Bearer ', '');

    if (!sessionId || !guildId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const permCheck = await verifyUserPermission(sessionId, guildId);
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
    const guildId = req.params.id;
    const authHeader = req.headers.authorization;
    const sessionId = authHeader?.replace('Bearer ', '');

    if (!sessionId || !guildId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const permCheck = await verifyUserPermission(sessionId, guildId);
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
}

/**
 * POST /api/user/polls
 * Create a new poll - renders image, posts to Discord, saves to database
 */
router.post('/polls', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const sessionId = authHeader?.replace('Bearer ', '');

    if (!sessionId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const body = req.body as CreatePollRequest;

    // Validate required fields
    if (!body.guild_id || !body.channel_id || !body.title || !body.options || body.options.length < 2) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const permCheck = await verifyUserPermission(sessionId, body.guild_id);
    if (!permCheck.valid) {
        return res.status(permCheck.status || 403).json({ error: permCheck.error });
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
        // Import dependencies for rendering and sharding
        const { Renderer } = await import('../lib/renderer');
        const { getShardingManager } = await import('../webhook');

        const shardingManager = getShardingManager();
        if (!shardingManager) {
            return res.status(503).json({ error: 'Bot not ready, please try again' });
        }

        // Get user info for creator display
        const { data: userData } = await supabase
            .from('users')
            .select('username')
            .eq('id', permCheck.userId)
            .single();

        const creatorName = userData?.username || 'Unknown';

        // Render poll image
        const imageBuffer = await Renderer.renderPoll({
            title: body.title,
            description: body.description || '',
            options: body.options,
            votes: body.options.map(() => 0),
            totalVotes: 0,
            creator: creatorName,
            closed: false,
        });

        // Convert buffer to base64 for transmission to shard
        const imageBase64 = imageBuffer.toString('base64');

        // Build poll settings
        const settings = {
            public: body.settings?.public ?? true,
            allow_thread: body.settings?.allow_thread ?? false,
            allow_close: body.settings?.allow_close ?? true,
            allow_exports: body.settings?.allow_exports ?? true,
            max_votes: body.settings?.max_votes ?? 1,
            min_votes: body.settings?.min_votes ?? 1,
            allowed_roles: body.settings?.allowed_roles ?? [],
            vote_weights: body.settings?.vote_weights ?? {},
            role_metadata: body.settings?.role_metadata,
        };

        // Post message to Discord via shard
        // We use broadcastEval to find the shard that has this guild and post there
        const pollData = {
            channelId: body.channel_id,
            guildId: body.guild_id,
            title: body.title,
            description: body.description || '',
            options: body.options,
            settings,
            creatorId: permCheck.userId,
            creatorName,
            imageBase64,
        };

        const results = await shardingManager.broadcastEval(
            async (client, context) => {
                const guild = client.guilds.cache.get(context.guildId);
                if (!guild) return null;

                const channel = guild.channels.cache.get(context.channelId);
                if (!channel || !channel.isTextBased()) return null;

                // Import discord.js components
                const { AttachmentBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

                // Create attachment from base64
                const imageBuffer = Buffer.from(context.imageBase64, 'base64');
                const attachment = new AttachmentBuilder(imageBuffer, { name: 'poll.png' });

                // Build select menu options
                const selectOptions = context.options.map((opt: string, i: number) => ({
                    label: opt.substring(0, 100),
                    value: i.toString(),
                    description: `Vote for option ${i + 1}`,
                }));

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('poll_vote')
                    .setPlaceholder('Select your vote(s)')
                    .setMinValues(context.settings.min_votes)
                    .setMaxValues(Math.min(context.settings.max_votes, selectOptions.length))
                    .addOptions(selectOptions);

                const row = new ActionRowBuilder().addComponents(selectMenu);

                // Send the poll message
                const message = await (channel as any).send({
                    files: [attachment],
                    components: [row],
                });

                return {
                    messageId: message.id,
                    channelId: message.channel.id,
                };
            },
            { context: pollData }
        );

        // Find the successful result
        const successResult = results.find(r => r !== null);
        if (!successResult) {
            return res.status(500).json({ error: 'Failed to post poll to Discord' });
        }

        // Save poll to database
        const { data: savedPoll, error: dbError } = await supabase
            .from('polls')
            .insert({
                message_id: successResult.messageId,
                channel_id: successResult.channelId,
                guild_id: body.guild_id,
                creator_id: permCheck.userId,
                title: body.title,
                description: body.description || '',
                options: body.options,
                settings,
                active: true,
            })
            .select()
            .single();

        if (dbError) {
            logger.error('[PollManagement] Failed to save poll to database:', dbError);
            return res.status(500).json({ error: 'Poll posted but failed to save to database' });
        }

        logger.info(`[PollManagement] Poll created by ${permCheck.userId} in guild ${body.guild_id}: ${successResult.messageId}`);

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
    const authHeader = req.headers.authorization;
    const sessionId = authHeader?.replace('Bearer ', '');
    const { pollId } = req.params;
    const { active } = req.body as { active: boolean };

    if (!sessionId) {
        return res.status(401).json({ error: 'Unauthorized' });
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
            .single();

        if (pollError || !pollData) {
            return res.status(404).json({ error: 'Poll not found' });
        }

        // 2. Verify user has permission on this guild
        const permCheck = await verifyUserPermission(sessionId, pollData.guild_id);
        if (!permCheck.valid) {
            return res.status(403).json({ error: permCheck.error || 'Permission denied' });
        }

        // 3. Update database
        const { error: updateError } = await supabase
            .from('polls')
            .update({ active })
            .eq('message_id', pollId);

        if (updateError) {
            logger.error('[PollManagement] Failed to update poll status:', updateError);
            return res.status(500).json({ error: 'Failed to update poll status' });
        }

        // 4. Get vote data for re-rendering
        const { data: voteCounts } = await supabase
            .from('votes')
            .select('option_index')
            .eq('poll_id', pollId);

        const counts = new Array(pollData.options.length).fill(0);
        if (voteCounts) {
            voteCounts.forEach((v: any) => {
                if (v.option_index >= 0 && v.option_index < counts.length) counts[v.option_index]++;
            });
        }
        const totalVotes = voteCounts ? voteCounts.length : 0;

        // 5. Get user info for creator display
        const { data: userData } = await supabase
            .from('users')
            .select('username')
            .eq('id', pollData.creator_id)
            .single();

        const creatorName = userData?.username || 'Unknown';

        // 6. Update Discord message via broadcastEval
        const { Renderer } = await import('../lib/renderer');
        const { getShardingManager } = await import('../webhook');

        const shardingManager = getShardingManager();
        if (!shardingManager) {
            // Still return success since DB was updated
            logger.warn('[PollManagement] Sharding manager not available, Discord message not updated');
            return res.json({ ...pollData, active });
        }

        const showVotes = !active || (pollData.settings && pollData.settings.public);

        const renderOptions: any = {
            title: pollData.title,
            description: pollData.description || '',
            options: pollData.options,
            totalVotes,
            creator: creatorName,
            closed: !active,
        };

        if (showVotes) {
            renderOptions.votes = counts;
        }

        const imageBuffer = await Renderer.renderPoll(renderOptions);
        const imageBase64 = imageBuffer.toString('base64');

        const updateContext = {
            channelId: pollData.channel_id,
            messageId: pollId,
            imageBase64,
            active,
            options: pollData.options,
            settings: pollData.settings,
        };

        const broadcastResults = await shardingManager.broadcastEval(
            async (client, context) => {
                const { channelId, messageId, imageBase64, active, options, settings } = context;
                const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = await import('discord.js');

                const channel = client.channels.cache.get(channelId);
                if (!channel || !channel.isTextBased()) return { success: false, error: 'Channel not found' };

                try {
                    const message = await (channel as any).messages.fetch(messageId);
                    if (!message) return { success: false, error: 'Message not found' };

                    const imageBufferFromBase64 = Buffer.from(imageBase64, 'base64');
                    const attachment = new AttachmentBuilder(imageBufferFromBase64, { name: 'poll.png' });

                    const components: any[] = [];

                    if (active) {
                        // Active poll: show vote menu + optional close button
                        const maxVotes = Math.min(settings?.max_votes || 1, options.length);
                        const minVotes = Math.min(settings?.min_votes || 1, maxVotes);

                        const selectOptions = options.map((opt: string, i: number) => ({
                            label: opt.substring(0, 100),
                            value: i.toString(),
                            description: `Vote for option ${i + 1}`,
                        }));

                        const selectMenu = new StringSelectMenuBuilder()
                            .setCustomId('poll_vote')
                            .setPlaceholder('Select your choice(s)...')
                            .setMinValues(minVotes)
                            .setMaxValues(maxVotes)
                            .addOptions(selectOptions);

                        components.push(new ActionRowBuilder().addComponents(selectMenu));

                        if (settings?.allow_close !== false) {
                            const closeButton = new ButtonBuilder()
                                .setCustomId('poll_close')
                                .setLabel('Close Poll')
                                .setStyle(ButtonStyle.Secondary);

                            const detailsButton = new ButtonBuilder()
                                .setCustomId('view_details')
                                .setLabel('View Details')
                                .setStyle(ButtonStyle.Secondary);

                            components.push(new ActionRowBuilder().addComponents(closeButton, detailsButton));
                        }
                    } else {
                        // Closed poll: show reopen button
                        const reopenButton = new ButtonBuilder()
                            .setCustomId('poll_reopen')
                            .setLabel('Reopen Poll')
                            .setStyle(ButtonStyle.Primary);

                        const detailsButton = new ButtonBuilder()
                            .setCustomId('view_details')
                            .setLabel('View Details')
                            .setStyle(ButtonStyle.Secondary);

                        components.push(new ActionRowBuilder().addComponents(reopenButton, detailsButton));
                    }

                    await message.edit({
                        files: [attachment],
                        components,
                    });

                    return { success: true };
                } catch (err: any) {
                    // Check if message was deleted (Unknown Message error)
                    if (err.code === 10008 || err.message?.includes('Unknown Message')) {
                        return { success: false, error: 'message_deleted' };
                    }
                    return { success: false, error: err.message };
                }
            },
            { context: updateContext }
        );

        // Check if any shard reported the message as deleted
        const results = Array.isArray(broadcastResults) ? broadcastResults : [broadcastResults];
        const messageDeleted = results.some((r: any) => r?.error === 'message_deleted');

        if (messageDeleted) {
            logger.warn(`[PollManagement] Poll ${pollId} Discord message was deleted`);

            // Persist the discord_deleted flag to database so it survives page refreshes
            await supabase
                .from('polls')
                .update({ discord_deleted: true })
                .eq('message_id', pollId);

            return res.status(410).json({
                error: 'Discord message deleted',
                message_deleted: true,
                poll: { ...pollData, discord_deleted: true }
            });
        }

        logger.info(`[PollManagement] Poll ${pollId} status updated to ${active ? 'active' : 'closed'} by ${permCheck.userId}`);

        return res.json({ ...pollData, active });
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
    const authHeader = req.headers.authorization;
    const sessionId = authHeader?.replace('Bearer ', '');
    const { pollId } = req.params;

    if (!sessionId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // 1. Fetch poll to verify it exists and get guild_id
        const { data: pollData, error: pollError } = await supabase
            .from('polls')
            .select('guild_id, title')
            .eq('message_id', pollId)
            .single();

        if (pollError || !pollData) {
            return res.status(404).json({ error: 'Poll not found' });
        }

        // 2. Verify user has permission
        const permCheck = await verifyUserPermission(sessionId, pollData.guild_id);
        if (!permCheck.valid) {
            return res.status(403).json({ error: permCheck.error || 'Permission denied' });
        }

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
    const authHeader = req.headers.authorization;
    const sessionId = authHeader?.replace('Bearer ', '');
    const { pollId } = req.params;
    const { settings: newSettings } = req.body as {
        settings: {
            public?: boolean;
            allow_close?: boolean;
            allow_exports?: boolean;
            allowed_roles?: string[];
            vote_weights?: Record<string, number>;
            role_metadata?: Record<string, { name: string; color: number }>;
        };
    };

    if (!sessionId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!newSettings || typeof newSettings !== 'object') {
        return res.status(400).json({ error: 'settings object required' });
    }

    try {
        // 1. Fetch poll
        const { data: pollData, error: pollError } = await supabase
            .from('polls')
            .select('*')
            .eq('message_id', pollId)
            .single();

        if (pollError || !pollData) {
            return res.status(404).json({ error: 'Poll not found' });
        }

        // 2. Verify permissions
        const permCheck = await verifyUserPermission(sessionId, pollData.guild_id);
        if (!permCheck.valid) {
            return res.status(403).json({ error: permCheck.error || 'Permission denied' });
        }

        // 3. Merge settings (only allowed fields)
        const currentSettings = pollData.settings || {};
        const updatedSettings = {
            ...currentSettings,
            public: newSettings.public ?? currentSettings.public,
            allow_close: newSettings.allow_close ?? currentSettings.allow_close,
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

        // 5. Recalculate vote weights if vote_weights changed
        const oldWeights = JSON.stringify(currentSettings.vote_weights || {});
        const newWeightsStr = JSON.stringify(updatedSettings.vote_weights || {});

        if (oldWeights !== newWeightsStr) {
            logger.info(`[PollManagement] Vote weights changed for poll ${pollId}, recalculating...`);

            // Get all unique voters for this poll
            const { data: votes } = await supabase
                .from('votes')
                .select('user_id')
                .eq('poll_id', pollId);

            if (votes && votes.length > 0) {
                const uniqueUserIds = [...new Set(votes.map(v => v.user_id))];

                const shardingManager = getShardingManager();
                if (shardingManager) {
                    // Use broadcastEval to get member roles for each user
                    const memberWeights = await shardingManager.broadcastEval(
                        async (client: any, context: { guildId: string; userIds: string[]; voteWeights: Record<string, number> }) => {
                            const { guildId, userIds, voteWeights } = context;
                            const guild = client.guilds.cache.get(guildId);
                            if (!guild) return [];

                            const results: Array<{ userId: string; weight: number }> = [];

                            for (const userId of userIds) {
                                try {
                                    const member = await guild.members.fetch(userId).catch(() => null);
                                    if (member) {
                                        // Calculate weight based on member roles
                                        let maxWeight = 1;
                                        for (const roleId of member.roles.cache.keys()) {
                                            const roleWeight = voteWeights[roleId];
                                            if (roleWeight && roleWeight > maxWeight) {
                                                maxWeight = roleWeight;
                                            }
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
                                voteWeights: updatedSettings.vote_weights || {},
                            }
                        }
                    );

                    // Flatten results from all shards
                    const flatResults = (Array.isArray(memberWeights) ? memberWeights : [memberWeights])
                        .flat()
                        .filter((r): r is { userId: string; weight: number } => r !== null && typeof r === 'object');

                    // Build a map of userId -> weight
                    const weightMap = new Map<string, number>();
                    for (const result of flatResults) {
                        weightMap.set(result.userId, result.weight);
                    }

                    // Update votes with new weights
                    for (const userId of uniqueUserIds) {
                        const newWeight = weightMap.get(userId) || 1;
                        await supabase
                            .from('votes')
                            .update({ weight: newWeight })
                            .eq('poll_id', pollId)
                            .eq('user_id', userId);
                    }

                    logger.info(`[PollManagement] Recalculated weights for ${uniqueUserIds.length} voters on poll ${pollId}`);

                    // Update Discord message with new vote counts
                    // First, get updated vote counts
                    const { data: allVotes } = await supabase
                        .from('votes')
                        .select('option_index, weight')
                        .eq('poll_id', pollId);

                    const newVoteCounts: number[] = pollData.options.map(() => 0);
                    (allVotes || []).forEach((v: { option_index: number; weight: number }) => {
                        newVoteCounts[v.option_index] = (newVoteCounts[v.option_index] || 0) + (v.weight || 1);
                    });

                    // Calculate total votes
                    const totalVotes = newVoteCounts.reduce((a, b) => a + b, 0);

                    // Get creator name for rendering
                    const { data: userData } = await supabase
                        .from('discord_users')
                        .select('username')
                        .eq('id', pollData.creator_id)
                        .single();
                    const creatorName = userData?.username || 'Unknown';

                    // Render updated poll image
                    const { Renderer } = await import('../lib/renderer');
                    const showVotes = !pollData.active || updatedSettings.public !== false;

                    const renderOptions: any = {
                        title: pollData.title,
                        description: pollData.description || '',
                        options: pollData.options,
                        totalVotes,
                        creator: creatorName,
                        closed: !pollData.active,
                    };

                    if (showVotes) {
                        renderOptions.votes = newVoteCounts;
                    }

                    const imageBuffer = await Renderer.renderPoll(renderOptions);
                    const imageBase64 = imageBuffer.toString('base64');

                    // Update Discord message
                    await shardingManager.broadcastEval(
                        async (client: any, context: any) => {
                            const { channelId, messageId, imageBase64 } = context;
                            const { AttachmentBuilder } = await import('discord.js');

                            const channel = client.channels.cache.get(channelId);
                            if (!channel || !channel.isTextBased()) return null;

                            try {
                                const message = await (channel as any).messages.fetch(messageId);
                                if (!message) return null;

                                const imageBufferFromBase64 = Buffer.from(imageBase64, 'base64');
                                const attachment = new AttachmentBuilder(imageBufferFromBase64, { name: 'poll.png' });

                                await message.edit({ files: [attachment] });
                                return { success: true };
                            } catch {
                                return null;
                            }
                        },
                        {
                            context: {
                                channelId: pollData.channel_id,
                                messageId: pollId,
                                imageBase64,
                            }
                        }
                    );

                    logger.info(`[PollManagement] Updated Discord message for poll ${pollId} after weight recalculation`);
                }
            }
        }

        logger.info(`[PollManagement] Poll ${pollId} settings updated by ${permCheck.userId}`);

        return res.json({ ...pollData, settings: updatedSettings });
    } catch (error) {
        logger.error('[PollManagement] Error updating poll settings:', error);
        return res.status(500).json({ error: 'Failed to update poll settings' });
    }
});

export const pollManagementRouter = router;



