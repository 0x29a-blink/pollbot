import React from 'react';
import { Panel, InlineError } from './ui/primitives';

export interface LeaderboardItem {
    id: string;
    label: React.ReactNode;
    /** Grey second line: what the row is, not the value again. */
    subLabel?: React.ReactNode;
    value: React.ReactNode;
    /** Optional media slot (server icon, avatar) after the rank. */
    leading?: React.ReactNode;
    onClick?: () => void;
}

interface LeaderboardProps {
    title: string;
    /** Grey meta in the header: the measure and the window ("by votes, 30 days"). */
    subtitle?: string;
    items: LeaderboardItem[];
    /** Rows drawn (and skeleton rows while loading). */
    rows?: number;
    loading?: boolean;
    error?: string | null;
    onRetry?: () => void;
    emptyText?: string;
    /** Header action, e.g. a "View all" link. */
    action?: React.ReactNode;
    className?: string;
}

const ROW = 'h-[52px] flex items-center gap-3 px-5';

/**
 * A capped ranking list: plain grey rank, identity, a grey line saying what
 * the row is, and the value right-aligned in tabular ink.
 */
export const Leaderboard: React.FC<LeaderboardProps> = ({
    title,
    subtitle,
    items,
    rows = 5,
    loading = false,
    error,
    onRetry,
    emptyText = 'Nothing to rank yet.',
    action,
    className = '',
}) => (
    <Panel title={title} meta={subtitle} actions={action} className={`min-w-0 ${className}`} bodyClassName="pb-2">
        {error ? (
            <div className="flex items-center" style={{ height: rows * 52 }}>
                <InlineError message={error} onRetry={onRetry} className="w-full" />
            </div>
        ) : loading ? (
            <ul aria-busy="true">
                {Array.from({ length: rows }, (_, i) => (
                    <li key={i} className={ROW}>
                        <div className="skeleton h-3 w-3" />
                        <div className="flex-1 space-y-1.5"><div className="skeleton h-3.5 w-3/5" /><div className="skeleton h-3 w-2/5" /></div>
                        <div className="skeleton h-3.5 w-10" />
                    </li>
                ))}
            </ul>
        ) : items.length === 0 ? (
            <div className="px-5" style={{ height: rows * 52 }}>
                <div className="h-full flex items-center justify-center text-sm text-faint border border-dashed border-line rounded-lg">{emptyText}</div>
            </div>
        ) : (
            <ol>
                {items.slice(0, rows).map((item, index) => {
                    const body = (
                        <>
                            <span className="num text-[13px] text-faint w-5 shrink-0">{index + 1}.</span>
                            {item.leading}
                            <div className="flex-1 min-w-0 text-left">
                                <div className="text-sm text-ink truncate">{item.label}</div>
                                {item.subLabel && <div className="text-xs text-faint truncate">{item.subLabel}</div>}
                            </div>
                            <span className="num text-sm text-ink shrink-0 text-right">{item.value}</span>
                        </>
                    );
                    return (
                        <li key={item.id}>
                            {item.onClick ? (
                                <button type="button" onClick={item.onClick} className={`${ROW} w-full row-interactive`}>{body}</button>
                            ) : (
                                <div className={ROW}>{body}</div>
                            )}
                        </li>
                    );
                })}
            </ol>
        )}
    </Panel>
);
