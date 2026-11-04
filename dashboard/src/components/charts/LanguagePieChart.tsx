import React, { useEffect, useState } from 'react';
import { adminSupabase } from '../../lib/supabase';
import { Panel, InlineError, ShareBar } from '../ui/primitives';
import { ChartSummary } from '../admin/adminUi';
import { localeName } from '../admin/adminFormat';
import { fmtCount, fmtPct, plural, toNum } from '../../lib/format';

interface LocaleRow {
    locale: string;
    servers: number;
}

/** Rows shown in the list; anything past the top (ROWS - 1) folds into "Other". */
const ROWS = 5;
const ROW_H = 44;

/**
 * Servers by Discord locale as a sorted bar list. Counts come from the
 * get_guild_locale_counts RPC; before that migration is applied it falls
 * back to tallying the guilds table client-side (PostgREST returns at most
 * 1,000 rows, which the card then says).
 */
export const LanguageBreakdown: React.FC<{ refreshKey?: number; className?: string; height?: number }> = ({ refreshKey = 0, className = '', height = ROWS * ROW_H }) => {
    const [rows, setRows] = useState<LocaleRow[] | null>(null);
    const [sampled, setSampled] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const rpc = await adminSupabase.rpc('get_guild_locale_counts');
                if (cancelled) return;
                if (!rpc.error && Array.isArray(rpc.data)) {
                    setRows((rpc.data as { locale: string | null; servers: number | string }[])
                        .map(r => ({ locale: r.locale || 'en-US', servers: toNum(r.servers) ?? 0 }))
                        .sort((a, b) => b.servers - a.servers));
                    setSampled(false);
                    setError(null);
                    return;
                }
                // Fallback: the pre-migration client-side tally.
                const { data, error: qError } = await adminSupabase.from('guilds').select('locale').is('left_at', null);
                if (cancelled) return;
                if (qError || !Array.isArray(data)) {
                    setError("Couldn't load server languages.");
                    return;
                }
                const counts = new Map<string, number>();
                for (const g of data as { locale: string | null }[]) {
                    const loc = g.locale || 'en-US';
                    counts.set(loc, (counts.get(loc) ?? 0) + 1);
                }
                setRows([...counts.entries()].map(([locale, servers]) => ({ locale, servers })).sort((a, b) => b.servers - a.servers));
                setSampled(data.length >= 1000);
                setError(null);
            } catch (err) {
                console.error('Error fetching languages:', err);
                if (!cancelled) setError("Couldn't load server languages.");
            }
        })();
        return () => { cancelled = true; };
    }, [refreshKey, retry]);

    const total = (rows ?? []).reduce((s, r) => s + r.servers, 0);
    const shown: { key: string; label: string; code: string | null; servers: number }[] = [];
    if (rows) {
        const head = rows.length > ROWS ? rows.slice(0, ROWS - 1) : rows;
        head.forEach(r => shown.push({ key: r.locale, label: localeName(r.locale), code: r.locale, servers: r.servers }));
        if (rows.length > ROWS) {
            const rest = rows.slice(ROWS - 1);
            shown.push({ key: '__other', label: `Other (${rest.length} languages)`, code: null, servers: rest.reduce((s, r) => s + r.servers, 0) });
        }
    }
    const max = shown.reduce((m, r) => Math.max(m, r.servers), 0);
    const loading = rows === null && !error;

    return (
        <Panel title="Server languages" meta={sampled ? 'first 1,000 servers' : 'Discord locale'} className={`min-w-0 ${className}`} bodyClassName="px-5 pb-4">
            <ChartSummary
                loading={loading}
                value={fmtCount(rows?.length ?? 0)}
                caption={rows?.length === 1 ? `language across ${plural(total, 'server')}` : `languages across ${plural(total, 'server')}`}
            />
            <div style={{ height }}>
                {error ? (
                    <div className="h-full flex items-center"><InlineError message={error} onRetry={() => { setError(null); setRows(null); setRetry(n => n + 1); }} className="w-full" /></div>
                ) : loading ? (
                    <ul aria-busy="true">
                        {Array.from({ length: ROWS }, (_, i) => (
                            <li key={i} className="flex flex-col justify-center gap-2" style={{ height: ROW_H }}>
                                <div className="skeleton h-3.5 w-32" />
                                <div className="skeleton h-1 w-full" />
                            </li>
                        ))}
                    </ul>
                ) : shown.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-sm text-faint border border-dashed border-line rounded-lg">No servers yet.</div>
                ) : (
                    <ul>
                        {shown.map(r => (
                            <li key={r.key} className="flex flex-col justify-center gap-1.5" style={{ height: ROW_H }}>
                                <div className="flex items-baseline gap-2 text-sm min-w-0">
                                    <span className="text-ink truncate">{r.label}</span>
                                    {r.code && <span className="text-xs text-faint shrink-0">{r.code}</span>}
                                    <span className="ml-auto num text-ink shrink-0">{fmtCount(r.servers)}</span>
                                    <span className="num text-xs text-faint w-12 text-right shrink-0">{fmtPct(r.servers, total)}</span>
                                </div>
                                <ShareBar value={r.servers} max={max} tone="data" height={4} />
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </Panel>
    );
};

/** Kept for older imports; the language card is a bar list now, not a pie. */
export const LanguagePieChart = LanguageBreakdown;
