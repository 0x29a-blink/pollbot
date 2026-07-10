import React from 'react';

interface SkeletonProps {
    /** Tailwind height class (default 'h-20'). */
    height?: string;
    className?: string;
}

/** Pulsing placeholder matching the glass-panel card look. */
export const Skeleton: React.FC<SkeletonProps> = ({ height = 'h-20', className = '' }) => (
    <div className={`glass-panel p-4 animate-pulse bg-slate-800/20 ${height} ${className}`} />
);

/** A stack of skeleton rows for list views. */
export const SkeletonList: React.FC<{ rows?: number; height?: string }> = ({ rows = 4, height }) => (
    <div className="space-y-4">
        {Array.from({ length: rows }, (_, i) => <Skeleton key={i} height={height} />)}
    </div>
);
