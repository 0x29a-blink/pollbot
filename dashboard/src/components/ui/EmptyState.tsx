import React from 'react';

interface EmptyStateProps {
    icon?: React.ReactNode;
    title: string;
    subtitle?: string;
    action?: React.ReactNode;
}

/** Rich empty state: icon + heading + optional sub-line + optional action. */
export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, subtitle, action }) => (
    <div className="text-center py-12">
        {icon && (
            <div className="w-12 h-12 rounded-xl bg-slate-800/60 text-slate-500 flex items-center justify-center mx-auto mb-4">
                {icon}
            </div>
        )}
        <h3 className="text-white font-semibold">{title}</h3>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
        {action && <div className="mt-4">{action}</div>}
    </div>
);
