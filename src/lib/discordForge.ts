import { logger } from './logger';

// Hand-rolled DiscordForge REST client. We deliberately do NOT depend on the
// discordforge-sdk package (too new to trust); the endpoints, headers, and
// retry behavior below were taken from the official API docs
// (https://discordforge.org/support/developers#api) and verified against the
// SDK source (https://github.com/discordforge/sdk — src/client.ts). Only the
// DiscordForge API key is ever sent; never the Discord bot token.

const BASE_URL = 'https://discordforge.org';

export interface DiscordForgeStats {
    server_count: number;
    shard_count?: number;
    user_count?: number;
    voice_connections?: number;
}

export interface DiscordForgeVoteCheck {
    hasVoted: boolean;
    votedAt?: string;
    nextVoteAt?: string;
}

export interface DiscordForgeHeartbeatResponse {
    success?: boolean;
    message?: string;
    status?: string;
    uptimeChecks?: number;
    uptimeOnline?: number;
}

export interface DiscordForgeClientOptions {
    /** Request timeout in ms (default 10s, matching the SDK). */
    timeout?: number;
    /** Max attempts per request including the first (default 3). */
    retries?: number;
    /**
     * Max `retry-after` seconds to sleep inline on 429 before throwing
     * immediately so callers don't stall for 5+ minutes (default 15s).
     */
    maxRetryAfterSeconds?: number;
}

export class DiscordForgeError extends Error {
    constructor(
        message: string,
        public readonly status?: number,
        public readonly retryAfter?: number
    ) {
        super(message);
        this.name = 'DiscordForgeError';
    }
}

export class DiscordForgeClient {
    private readonly timeout: number;
    private readonly retries: number;
    private readonly maxRetryAfterSeconds: number;

    constructor(private readonly apiKey: string, options: DiscordForgeClientOptions = {}) {
        if (!apiKey) throw new DiscordForgeError('DiscordForge API key is required');
        this.timeout = options.timeout ?? 10_000;
        this.retries = Math.max(1, options.retries ?? 3);
        this.maxRetryAfterSeconds = options.maxRetryAfterSeconds ?? 15;
    }

    /**
     * POST /api/v1/bots/stats — rate limited to 1 request / 5 minutes.
     */
    async postStats(stats: DiscordForgeStats): Promise<void> {
        await this.request('POST', '/api/v1/bots/stats', stats, 'bearer');
    }

    /**
     * POST /api/v1/bots/heartbeat — keeps the bot marked online under
     * DiscordForge's push-based uptime monitor. Safe to call every 60s:
     * DiscordForge records 1 uptime check per 5-minute window and responds
     * 200 OK ("Heartbeat received (rate-limited)") to intermediate pings.
     */
    async heartbeat(status: 'online' | 'idle' | 'dnd' = 'online'): Promise<DiscordForgeHeartbeatResponse | undefined> {
        return await this.request<DiscordForgeHeartbeatResponse>('POST', '/api/v1/bots/heartbeat', { status }, 'bearer');
    }

    /**
     * POST /api/v1/bots/commands — sync slash commands to the listing.
     * Accepts Discord API command JSON; capped at 200 commands server-side.
     */
    async syncCommands(commands: unknown[]): Promise<void> {
        await this.request('POST', '/api/v1/bots/commands', { commands: commands.slice(0, 200) }, 'bearer');
    }

    /**
     * GET /api/bots/:id/votes/check?userId= — has this user voted in the last
     * vote window? Rate limited to 60 requests / minute.
     */
    async checkVote(botId: string, userId: string): Promise<DiscordForgeVoteCheck> {
        return await this.request<DiscordForgeVoteCheck>(
            'GET',
            `/api/bots/${encodeURIComponent(botId)}/votes/check?userId=${encodeURIComponent(userId)}`,
            undefined,
            'raw'
        );
    }

    private redact(value: string): string {
        return this.apiKey ? value.split(this.apiKey).join('[REDACTED]') : value;
    }

    private async request<T = unknown>(
        method: 'GET' | 'POST',
        path: string,
        body?: unknown,
        authMode: 'bearer' | 'raw' = 'bearer'
    ): Promise<T> {
        let lastError: Error | undefined;

        for (let attempt = 1; attempt <= this.retries; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.timeout);

            try {
                const res = await fetch(`${BASE_URL}${path}`, {
                    method,
                    headers: {
                        'Authorization': authMode === 'bearer' ? `Bearer ${this.apiKey}` : this.apiKey,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'User-Agent': 'PollBot (https://pollbot.win)',
                    },
                    body: body === undefined ? null : JSON.stringify(body),
                    signal: controller.signal,
                });

                if (res.status === 429) {
                    const retryAfter = Number(res.headers.get('retry-after')) || 3;
                    lastError = new DiscordForgeError(`Rate limited on ${path} (retry-after ${retryAfter}s)`, 429, retryAfter);
                    if (attempt < this.retries && retryAfter <= this.maxRetryAfterSeconds) {
                        logger.warn(`[DiscordForge] 429 on ${path}, retrying in ${retryAfter}s (attempt ${attempt}/${this.retries})`);
                        await sleep(retryAfter * 1000);
                        continue;
                    }
                    throw lastError;
                }

                if (!res.ok) {
                    const text = this.redact(await res.text().catch(() => ''));
                    throw new DiscordForgeError(`DiscordForge ${method} ${path} failed: ${res.status} ${text.slice(0, 200)}`, res.status);
                }

                const contentType = res.headers.get('content-type') || '';
                if (contentType.includes('application/json')) {
                    return await res.json() as T;
                }
                return undefined as T;
            } catch (err) {
                if (err instanceof DiscordForgeError) {
                    lastError = err;
                } else {
                    const msg = err instanceof Error ? err.message : String(err);
                    lastError = new Error(this.redact(msg));
                }
                // 4xx won't succeed on retry (eligible 429 retries already continued above).
                if (err instanceof DiscordForgeError && err.status && err.status < 500) {
                    throw err;
                }
                if (attempt < this.retries) {
                    await sleep(3000);
                    continue;
                }
            } finally {
                clearTimeout(timer);
            }
        }

        throw lastError ?? new DiscordForgeError(`DiscordForge ${method} ${path} failed`);
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
