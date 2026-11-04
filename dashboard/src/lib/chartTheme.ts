/**
 * Shared Recharts styling: PollBot blue on the primary series, Fluenty
 * sky-cyan on the secondary series, tonal indigo on non-peak bars, 3-5 faint
 * horizontal gridlines, no axis lines, straight segments, a crisp tooltip.
 */
import type React from 'react';

export const chart = {
    data: '#6d78f9',
    data2: '#60cdff',
    barMuted: '#475099',
    positive: '#4cc38a',
    negative: '#f2777d',
    warning: '#f0b232',
    grid: '#383c47',
    tick: '#9ca3b4',
    cursor: 'rgba(109, 120, 249, 0.08)',
    fontSize: 12,
} as const;

/** Props for <CartesianGrid /> */
export const gridProps = {
    stroke: chart.grid,
    vertical: false,
    strokeDasharray: '3 3',
} as const;

/** Props for <XAxis /> / <YAxis /> */
export const axisProps = {
    stroke: chart.tick,
    tick: { fill: chart.tick, fontSize: chart.fontSize },
    tickLine: false,
    axisLine: false,
} as const;

/** Props for <Tooltip /> */
export const tooltipProps = {
    contentStyle: {
        background: '#2b2e36',
        border: '1px solid #414654',
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.38)',
        color: '#ffffff',
        fontSize: 12,
        padding: '6px 10px',
    } as React.CSSProperties,
    labelStyle: { color: '#cacfd9', marginBottom: 2 } as React.CSSProperties,
    itemStyle: { color: '#ffffff', padding: 0 } as React.CSSProperties,
    cursor: { fill: chart.cursor, stroke: chart.grid },
    separator: ' ',
} as const;

/** Tooltip/legend colours for an ordered set of series (max four on a screen). */
export const seriesPalette = [chart.data, chart.data2, chart.positive, chart.warning] as const;
