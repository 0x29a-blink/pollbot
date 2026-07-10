import { supabase } from './db';
import { logger } from './logger';

export type UsageSource = 'bot' | 'dashboard';

export interface UsageEvent {
    source: UsageSource;
    event_type: string;   // 'command:poll' | 'vote' | 'poll_create' | 'poll_close' | ...
    guild_id?: string | null | undefined;
    user_id?: string | null | undefined;
}

/**
 * Fire-and-forget usage telemetry. NEVER awaited by callers and NEVER throws —
 * a telemetry failure must not affect the action being recorded. Safe to call
 * before the usage_events migration is applied (failures are logged at debug).
 */
export function trackUsage(event: UsageEvent): void {
    void supabase
        .from('usage_events')
        .insert({ ...event })
        .then(({ error }) => {
            if (error) logger.debug(`[UsageTracker] insert failed (${event.event_type}): ${error.message}`);
        });
}
