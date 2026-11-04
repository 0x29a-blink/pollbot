/**
 * Formatting helpers shared by every dashboard screen, so a count, a date or a
 * missing value looks the same everywhere.
 *
 * Rules: counts get thousands separators and no decimals; percentages one
 * decimal; a real zero prints as "0"; a missing value is an em dash (render it
 * in a grey tone). Never coerce a missing value to 0.
 */

export const DASH = '\u2014';

/** Coerce Postgres BIGINT-as-string / null / undefined into a number or null. */
export function toNum(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}

/** 12,345 - or an em dash when the value is unknown. */
export function fmtCount(value: unknown): string {
    const n = toNum(value);
    return n === null ? DASH : Math.round(n).toLocaleString('en-US');
}

/** 12.3k / 1.2M for capacity lines only. */
export function fmtCompact(value: unknown): string {
    const n = toNum(value);
    if (n === null) return DASH;
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** 42.0% - one decimal; a zero total gives 0.0%. */
export function fmtPct(part: number, total: number): string {
    if (!total) return '0.0%';
    return `${((part / total) * 100).toFixed(1)}%`;
}

/** "1 poll" / "3 polls" */
export function plural(n: number, one: string, many = `${one}s`): string {
    return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

/** Nov 3, 2026 */
export function fmtDate(iso: string | null | undefined): string {
    if (!iso) return DASH;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return DASH;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Nov 3, 2026, 9:14 PM */
export function fmtDateTime(iso: string | null | undefined): string {
    if (!iso) return DASH;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return DASH;
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** 9:14 PM */
export function fmtTime(date: Date | null | undefined): string {
    if (!date) return DASH;
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "just now", "5 min ago", "3 h ago", "Yesterday", "6 days ago", then the date. */
export function fmtRelative(iso: string | null | undefined, now: number = Date.now()): string {
    if (!iso) return DASH;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return DASH;
    const diff = now - t;
    const future = diff < 0;
    const abs = Math.abs(diff);
    const min = Math.round(abs / 60_000);
    const hr = Math.round(abs / 3_600_000);
    const day = Math.round(abs / 86_400_000);
    if (min < 1) return future ? 'in under a minute' : 'just now';
    if (min < 60) return future ? `in ${min} min` : `${min} min ago`;
    if (hr < 24) return future ? `in ${hr} h` : `${hr} h ago`;
    if (day === 1) return future ? 'tomorrow' : 'yesterday';
    if (day < 7) return future ? `in ${day} days` : `${day} days ago`;
    return fmtDate(iso);
}

/** Discord role colour int -> hex (0 = default grey). */
export function roleHex(color: number): string {
    if (!color) return '#99aab5';
    return `#${color.toString(16).padStart(6, '0')}`;
}
