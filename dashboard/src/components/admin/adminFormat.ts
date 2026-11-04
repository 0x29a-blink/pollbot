/** Formatting helpers for the admin screens and charts. */

/* ---------------------------------------------------------------- dates */

/** "Nov 3" for a `YYYY-MM-DD` day, read as a UTC date (never shifted a day). */
export function fmtDayUTC(day: string): string {
    const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return day;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** The last `n` UTC days as `YYYY-MM-DD`, oldest first, ending today. */
export function lastDaysUTC(n: number): string[] {
    const out: string[] = [];
    const today = new Date();
    const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    for (let i = n - 1; i >= 0; i--) out.push(new Date(base - i * 86_400_000).toISOString().slice(0, 10));
    return out;
}

/** "00:00" ... "23:00" */
export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Short Discord snowflake for grey meta text: "1000000…0001". */
export function shortId(id: string | null | undefined): string {
    if (!id) return '';
    return id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

/** Locale code -> "English (US)" style name, falling back to the code. */
export function localeName(code: string | null | undefined): string {
    if (!code) return 'Unknown';
    try {
        const dn = new Intl.DisplayNames(['en'], { type: 'language' });
        return dn.of(code) || code;
    } catch {
        return code;
    }
}

const NICE = [1, 2, 2.5, 5];

/** Smallest integer "nice" step (1, 2, 2.5, 5 x 10^n) that is >= raw. */
function niceStep(raw: number): number {
    let mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
    for (;;) {
        for (const m of NICE) {
            const s = m * mag;
            if (s >= raw && Number.isInteger(s)) return s;
        }
        mag *= 10;
    }
}

/**
 * Props for a count Y axis: zero baseline, 3-5 round, even intervals with the
 * top tick above the maximum, integer ticks with thousands separators, and a
 * fixed 0-4 scale when every value is zero (the zero line is still drawn).
 */
export function countAxis(max: number) {
    let ticks: number[];
    if (!(max > 0)) {
        ticks = [0, 1, 2, 3, 4];
    } else {
        let step = niceStep(max / 5);
        let n = Math.floor(max / step) + 1;
        while (n > 5) {
            step = niceStep(step + 1);
            n = Math.floor(max / step) + 1;
        }
        ticks = Array.from({ length: n + 1 }, (_, i) => i * step);
    }
    return {
        domain: [0, ticks[ticks.length - 1]] as [number, number],
        ticks,
        interval: 0 as const,
        allowDecimals: false,
        tickFormatter: (v: number) => v.toLocaleString('en-US'),
    };
}
