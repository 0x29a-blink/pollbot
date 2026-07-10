/** Allowed auto-close durations. Key = option value, ms = offset. */
export const POLL_DURATIONS: Record<string, number> = {
    '1h': 3600_000,
    '6h': 6 * 3600_000,
    '12h': 12 * 3600_000,
    '24h': 24 * 3600_000,
    '48h': 48 * 3600_000,
    '7d': 7 * 24 * 3600_000,
};

/** Returns an ISO timestamp now+duration, or null for unknown keys. */
export function endsAtFromDuration(key: string, now: Date = new Date()): string | null {
    const ms = POLL_DURATIONS[key];
    return ms ? new Date(now.getTime() + ms).toISOString() : null;
}

/** Validates a client-supplied ends_at: parseable date, in the future, ≤ 90 days out. */
export function validateEndsAt(value: string, now: Date = new Date()): boolean {
    const t = Date.parse(value);
    if (Number.isNaN(t)) return false;
    return t > now.getTime() && t <= now.getTime() + 90 * 24 * 3600_000;
}
