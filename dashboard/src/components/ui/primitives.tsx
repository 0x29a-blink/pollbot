import React from 'react';
import { AlertCircle, RefreshCw, Search, X } from 'lucide-react';
import { DASH } from '../../lib/format';

/* ==========================================================================
   Small building blocks shared by every app screen. Styling lives in
   index.css (.panel, .btn, .chip, .field ...); these only fix structure.
   ========================================================================== */

/** Page title row: a noun h1, one grey sentence about the data, actions on the right. */
export const PageHeader: React.FC<{
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    leading?: React.ReactNode;
    actions?: React.ReactNode;
}> = ({ title, subtitle, leading, actions }) => (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 mb-6">
        <div className="flex items-center gap-4 min-w-0">
            {leading}
            <div className="min-w-0">
                <h1 className="font-[family-name:var(--font-display)] text-[28px] leading-9 font-semibold text-ink truncate">{title}</h1>
                {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
            </div>
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
);

/** A card with an optional header row. */
export const Panel: React.FC<{
    title?: React.ReactNode;
    meta?: React.ReactNode;
    actions?: React.ReactNode;
    className?: string;
    bodyClassName?: string;
    children: React.ReactNode;
    as?: 'section' | 'div';
    id?: string;
}> = ({ title, meta, actions, className = '', bodyClassName = '', children, as = 'section', id }) => {
    const Tag = as;
    return (
        <Tag className={`panel ${className}`} id={id}>
            {(title || actions || meta) && (
                <header className="panel-head">
                    <div className="min-w-0 flex items-baseline gap-2">
                        {title && <h2 className="panel-title truncate">{title}</h2>}
                        {meta && <span className="panel-meta truncate">{meta}</span>}
                    </div>
                    {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
                </header>
            )}
            <div className={bodyClassName}>{children}</div>
        </Tag>
    );
};

export type KpiTone = 'brand' | 'cyan' | 'positive' | 'warning';

const KPI_DOT: Record<KpiTone, string> = {
    brand: 'bg-brand',
    cyan: 'bg-cyan',
    positive: 'bg-positive',
    warning: 'bg-warning',
};

const KPI_BAR: Record<KpiTone, string> = {
    brand: 'border-t-2 border-t-brand',
    cyan: 'border-t-2 border-t-cyan',
    positive: 'border-t-2 border-t-positive',
    warning: 'border-t-2 border-t-warning',
};

/** One cell of a divided KPI strip: semantic indicator dot + label over crisp tabular value. */
export const Kpi: React.FC<{
    label: string;
    value: React.ReactNode;
    unit?: string;
    caption?: React.ReactNode;
    lead?: boolean;
    loading?: boolean;
    tone?: KpiTone;
}> = ({ label, value, unit, caption, lead = false, loading = false, tone }) => (
    <div className={`px-5 py-4 min-w-0 ${tone ? KPI_BAR[tone] : ''}`}>
        <div className="flex items-center gap-2 text-[13px] text-faint min-w-0">
            {tone && <span aria-hidden="true" className={`w-2 h-2 rounded-full shrink-0 ${KPI_DOT[tone]}`} />}
            <span className="truncate">{label}</span>
        </div>
        {loading ? (
            <div className={`skeleton mt-2 ${lead ? 'h-8 w-28' : 'h-7 w-20'}`} />
        ) : (
            <div className={`num mt-1 font-semibold text-ink ${lead ? 'text-[32px] leading-10' : 'text-2xl leading-8'}`}>
                {value}
                {unit && <span className="text-sm font-normal text-faint ml-1">{unit}</span>}
            </div>
        )}
        {caption && <div className="text-xs text-faint mt-1 truncate">{caption}</div>}
    </div>
);

export const KpiStrip: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <div className={`panel kpi-strip ${className}`}>{children}</div>
);

/** Grey em dash for a missing value. */
export const Dash: React.FC<{ title?: string }> = ({ title = 'Not available' }) => (
    <span className="text-faint" title={title}>{DASH}</span>
);

/** Curated M3/Discord tonal tiles for servers without a custom Discord icon. */
const GUILD_TILES: readonly { bg: string; fg: string }[] = [
    { bg: '#2d356b', fg: '#d8deff' }, // PollBot blurple
    { bg: '#1d3c52', fg: '#bfe8ff' }, // Fluenty sky-cyan
    { bg: '#1d403c', fg: '#b8f2e8' }, // Teal
    { bg: '#214031', fg: '#c2f2d6' }, // Emerald
    { bg: '#45361e', fg: '#ffe3ad' }, // Gold
    { bg: '#472834', fg: '#ffd0dc' }, // Rose
    { bg: '#2a3558', fg: '#cdd9ff' }, // Cornflower
];

/** Server icon as Discord draws it: the icon, or initials on a stable tonal tile. */
export const GuildIcon: React.FC<{
    name: string;
    iconUrl: string | null | undefined;
    size?: number;
    radius?: string;
    className?: string;
}> = ({ name, iconUrl, size = 40, radius = '30%', className = '' }) => {
    const initials = name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .map(w => w[0])
        .join('')
        .slice(0, 3) || '?';
    if (iconUrl) {
        return (
            <img
                src={iconUrl}
                alt=""
                width={size}
                height={size}
                loading="lazy"
                className={`shrink-0 object-cover bg-raised ${className}`}
                style={{ width: size, height: size, borderRadius: radius }}
            />
        );
    }
    const seed = name.split('').reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 11);
    const tile = GUILD_TILES[seed % GUILD_TILES.length];
    return (
        <div
            aria-hidden="true"
            className={`shrink-0 flex items-center justify-center font-semibold select-none ${className}`}
            style={{
                width: size,
                height: size,
                borderRadius: radius,
                fontSize: Math.max(11, Math.round(size * 0.34)),
                backgroundColor: tile.bg,
                color: tile.fg,
            }}
        >
            {initials}
        </div>
    );
};

/** Person avatar: the Discord avatar, or a stable tonal tint with an initial. */
export const Avatar: React.FC<{ name: string; url?: string | null; size?: number; id?: string }> = ({ name, url, size = 28, id }) => {
    if (url) {
        return <img src={url} alt="" width={size} height={size} loading="lazy" className="rounded-full shrink-0 bg-raised object-cover" style={{ width: size, height: size }} />;
    }
    const seed = (id || name).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const tile = GUILD_TILES[seed % GUILD_TILES.length];
    return (
        <div
            aria-hidden="true"
            className="rounded-full shrink-0 flex items-center justify-center font-medium"
            style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: tile.bg, color: tile.fg }}
        >
            {(name || '?').charAt(0).toUpperCase()}
        </div>
    );
};

/** Poll lifecycle as one status mark. */
export const PollStatusChip: React.FC<{ active: boolean; deleted?: boolean; endsAt?: string | null }> = ({ active, deleted, endsAt }) => {
    if (deleted) return <span className="chip chip-warning chip-dot">Message deleted</span>;
    if (!active) return <span className="chip chip-dot">Closed</span>;
    if (endsAt) return <span className="chip chip-positive chip-dot">Open · closes {new Date(endsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>;
    return <span className="chip chip-positive chip-dot">Open</span>;
};

/** Toolbar search with a leading icon and a clear button. */
export const SearchField: React.FC<{
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
    label?: string;
    className?: string;
}> = ({ value, onChange, placeholder, label, className = '' }) => (
    <div className={`relative ${className}`}>
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-faint pointer-events-none" aria-hidden="true" />
        <input
            type="search"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            aria-label={label || placeholder}
            className="field pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
            <button
                type="button"
                onClick={() => onChange('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded flex items-center justify-center text-faint hover:text-ink hover:bg-[var(--state-hover)]"
            >
                <X className="w-3.5 h-3.5" />
            </button>
        )}
    </div>
);

/** Error inside the block that failed, with a retry. */
export const InlineError: React.FC<{ message: string; onRetry?: () => void; className?: string }> = ({ message, onRetry, className = '' }) => (
    <div className={`flex items-center gap-3 px-5 py-4 text-sm text-muted ${className}`} role="alert">
        <AlertCircle className="w-4 h-4 text-negative shrink-0" aria-hidden="true" />
        <span className="flex-1">{message}</span>
        {onRetry && (
            <button type="button" onClick={onRetry} className="btn btn-ghost btn-sm">
                Retry
            </button>
        )}
    </div>
);

/** Empty block: keeps its frame, says one sentence, offers the next step. */
export const EmptyBlock: React.FC<{ title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }> = ({ title, children, action, className = '' }) => (
    <div className={`px-5 py-10 text-center ${className}`}>
        <p className="text-sm font-semibold text-ink">{title}</p>
        {children && <p className="text-sm text-faint mt-1 max-w-md mx-auto">{children}</p>}
        {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
);

/** "Updated 9:14 PM" with a refresh button. */
export const Freshness: React.FC<{
    updatedAt: Date | null;
    onRefresh?: () => void;
    refreshing?: boolean;
    disabled?: boolean;
    label?: string;
    title?: string;
}> = ({ updatedAt, onRefresh, refreshing = false, disabled = false, label, title }) => (
    <div className="flex items-center gap-1 text-xs text-faint">
        <span className="num">{label ?? (updatedAt ? `Updated ${updatedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'Not loaded yet')}</span>
        {onRefresh && (
            <button
                type="button"
                onClick={onRefresh}
                disabled={disabled || refreshing}
                aria-label="Refresh"
                title={title || 'Refresh'}
                className="btn btn-ghost btn-sm btn-icon"
            >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
        )}
    </div>
);

/** A thin horizontal share bar at the true ratio (no stub at zero). */
export const ShareBar: React.FC<{ value: number; max: number; tone?: 'data' | 'cyan' | 'muted'; height?: number }> = ({ value, max, tone = 'data', height = 4 }) => {
    const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    const barClass = tone === 'cyan' ? 'bg-cyan' : tone === 'data' ? 'bg-data' : 'bg-[#4b5494]';
    return (
        <div className="w-full rounded-full bg-[#22252e] overflow-hidden" style={{ height }} aria-hidden="true">
            {pct > 0 && <div className={`h-full rounded-full ${barClass}`} style={{ width: `${pct}%` }} />}
        </div>
    );
};
