import { Client, Events } from 'discord.js';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';
import { PollManager } from '../lib/pollManager';
import { shardIdForGuild } from '../lib/shardUtils';

const TICK_MS = 60_000;
// Drain cap per tick per shard; a large backlog clears at this rate.
const BATCH_LIMIT = 25;

/**
 * Auto-closes polls whose ends_at has passed. Runs on every shard; each
 * shard only processes polls whose guild belongs to it, so no coordination
 * is needed and message edits always happen on the owning shard.
 */
export class PollSchedulerService {
    private client: Client;
    private running = false;

    constructor(client: Client) {
        this.client = client;
        this.client.once(Events.ClientReady, () => {
            const timer = setInterval(() => this.tick(), TICK_MS);
            timer.unref();
            logger.info('[PollScheduler] Started (60s tick).');
        });
    }

    private async tick() {
        if (this.running) return; // don't overlap slow ticks
        this.running = true;
        try {
            const { data: due, error } = await supabase
                .from('polls')
                .select('*')
                .lte('ends_at', new Date().toISOString())
                .eq('active', true)
                .not('ends_at', 'is', null)
                .limit(BATCH_LIMIT);
            if (error || !due) {
                if (error) logger.error('[PollScheduler] Query failed:', error);
                return;
            }

            const shardIds = this.client.shard?.ids ?? [0];
            const shardCount = this.client.shard?.count ?? 1;
            const mine = due.filter(p => shardIds.includes(shardIdForGuild(p.guild_id, shardCount)));

            for (const poll of mine) {
                try {
                    await PollManager.autoClosePoll(this.client, poll);
                    logger.info(`[PollScheduler] Auto-closed poll ${poll.message_id} (guild ${poll.guild_id}).`);
                } catch (err) {
                    logger.error(`[PollScheduler] Failed to auto-close ${poll.message_id}:`, err);
                }
            }
        } finally {
            this.running = false;
        }
    }
}
