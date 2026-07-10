import React from 'react';

interface FilterButtonProps {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}

/** Segmented filter pill used across list views. */
export const FilterButton: React.FC<FilterButtonProps> = ({ active, onClick, children }) => (
    <button
        onClick={onClick}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${active ? 'bg-primary-strong text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
    >
        {children}
    </button>
);
