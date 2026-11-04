import React from 'react';

interface SkeletonProps {
    /** Tailwind height class (default 'h-20'). */
    height?: string;
    className?: string;
}

/**
 * Placeholder for a card that is still loading: the card frame at its real
 * height with flat grey bars for its first lines. A gentle opacity pulse, no
 * shimmer gradient.
 */
export const Skeleton: React.FC<SkeletonProps> = ({ height = 'h-20', className = '' }) => (
    <div className={`panel px-5 py-4 overflow-hidden ${height} ${className}`} aria-hidden="true">
        <div className="motion-safe:animate-pulse">
            <div className="skeleton h-4 w-40 max-w-[60%]" />
            <div className="skeleton h-3 w-64 max-w-[85%] mt-3" />
        </div>
    </div>
);

/** A stack of skeleton rows for list views. */
export const SkeletonList: React.FC<{ rows?: number; height?: string }> = ({ rows = 4, height }) => (
    <div className="space-y-3" role="status" aria-label="Loading">
        {Array.from({ length: rows }, (_, i) => <Skeleton key={i} height={height} />)}
    </div>
);
