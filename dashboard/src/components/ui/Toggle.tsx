import React from 'react';
import { HelpCircle } from 'lucide-react';

interface ToggleProps {
    label: string;
    tooltip?: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}

/**
 * Shared setting toggle (merged from the drifted CreatePollModal/EditPollModal
 * copies). Keyboard-operable switch with an optional hover tooltip.
 */
export const Toggle: React.FC<ToggleProps> = ({ label, tooltip, checked, onChange }) => (
    <div className="relative group">
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className="w-full flex items-center justify-between p-2.5 rounded-lg bg-slate-800/50 cursor-pointer hover:bg-slate-700/50 transition-colors border border-slate-700/50 text-left"
        >
            <div className="flex items-center gap-1.5">
                <span className="text-sm text-slate-300">{label}</span>
                {tooltip && (
                    <HelpCircle className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-400" />
                )}
            </div>
            <div
                className="w-10 h-6 rounded-full transition-colors flex items-center px-1 shrink-0"
                style={{ backgroundColor: checked ? 'var(--color-primary-strong)' : '#475569' }}
            >
                <div
                    className="w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-200"
                    style={{ marginLeft: checked ? '16px' : '0px' }}
                />
            </div>
        </button>
        {tooltip && (
            <div className="absolute left-0 right-0 bottom-full mb-2 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 shadow-xl">
                {tooltip}
                <div className="absolute left-4 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-700" />
            </div>
        )}
    </div>
);
