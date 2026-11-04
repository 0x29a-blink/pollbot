import React from 'react';

interface FilterButtonProps {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}

/**
 * One segment of an M3 segmented control. Put several inside a
 * `.segmented` container; `aria-pressed` carries the selected state.
 */
export const FilterButton: React.FC<FilterButtonProps> = ({ active, onClick, children }) => (
    <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        className={`inline-flex items-center gap-1.5 h-[26px] px-3 rounded-control text-[13px] font-medium whitespace-nowrap transition-colors ${active ? 'bg-[#3a3a3a] text-ink' : 'text-muted hover:text-ink hover:bg-[var(--state-hover)]'
            }`}
    >
        {children}
    </button>
);
