import React from 'react';

interface EmptyStateProps {
    /** @deprecated Kept for call-site compatibility; empty states carry no icon. */
    icon?: React.ReactNode;
    title: string;
    subtitle?: string;
    action?: React.ReactNode;
}

/** Empty state: a title, one grey sentence, and the next step if there is one. */
export const EmptyState: React.FC<EmptyStateProps> = ({ title, subtitle, action }) => (
    <div className="px-5 py-10 text-center">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {subtitle && <p className="text-sm text-faint mt-1 max-w-md mx-auto">{subtitle}</p>}
        {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
);
