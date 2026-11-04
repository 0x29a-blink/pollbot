import React from 'react';
import { InlineError } from '../ui/primitives';

/* ==========================================================================
   Small pieces shared by the bot-owner (admin) screens and their charts.
   Styling comes from index.css (.segmented, .skeleton, .panel ...).
   ========================================================================== */

/** M3 segmented control for filters and chart switches. */
export function Segmented<T extends string | number>({
    value,
    options,
    onChange,
    label,
    disabled = false,
    className = '',
}: {
    value: T;
    options: { value: T; label: React.ReactNode; disabled?: boolean; title?: string }[];
    onChange: (v: T) => void;
    label: string;
    disabled?: boolean;
    className?: string;
}) {
    return (
        <div className={`segmented shrink-0 ${className}`} role="group" aria-label={label}>
            {options.map(o => (
                <button
                    key={String(o.value)}
                    type="button"
                    aria-pressed={value === o.value}
                    disabled={disabled || o.disabled}
                    title={o.title}
                    onClick={() => onChange(o.value)}
                    className="whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

/** Small dot legend for a card header (multi-series charts only). */
export const DotLegend: React.FC<{ items: { label: string; color: string }[] }> = ({ items }) => (
    <ul className="flex items-center gap-3 text-xs text-faint">
        {items.map(i => (
            <li key={i.label} className="flex items-center gap-1.5 whitespace-nowrap">
                <span aria-hidden="true" className="w-2 h-2 rounded-full" style={{ background: i.color }} />
                {i.label}
            </li>
        ))}
    </ul>
);

/**
 * The plot area of a chart card. Keeps the frame at its real height in every
 * state: a flat skeleton while the first load runs, the error with a retry,
 * and - when every value is zero - the drawn (zero) chart with one sentence.
 */
export const ChartBody: React.FC<{
    height: number;
    loading: boolean;
    error?: string | null;
    onRetry?: () => void;
    empty?: boolean;
    emptyText?: string;
    className?: string;
    children: React.ReactNode;
}> = ({ height, loading, error, onRetry, empty = false, emptyText, className = '', children }) => {
    if (error) {
        return (
            <div className={`flex items-center ${className}`} style={{ height }}>
                <InlineError message={error} onRetry={onRetry} className="w-full" />
            </div>
        );
    }
    if (loading) {
        return (
            <div className={className} style={{ height }} aria-busy="true" aria-label="Loading chart">
                <div className="skeleton w-full h-full" />
            </div>
        );
    }
    return (
        <div className={`relative min-w-0 ${className}`} style={{ height }}>
            {children}
            {empty && emptyText && (
                <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-faint pointer-events-none px-6">
                    {emptyText}
                </p>
            )}
        </div>
    );
};

/** One headline figure over the chart: value in ink, a grey caption beside it. */
export const ChartSummary: React.FC<{ value: React.ReactNode; caption: React.ReactNode; loading?: boolean }> = ({ value, caption, loading = false }) => (
    <div className="h-11 flex items-baseline gap-2 min-w-0">
        {loading ? (
            <div className="skeleton h-6 w-40 self-center" />
        ) : (
            <>
                <span className="num text-xl leading-7 font-semibold text-ink">{value}</span>
                <span className="text-[13px] text-faint truncate">{caption}</span>
            </>
        )}
    </div>
);
