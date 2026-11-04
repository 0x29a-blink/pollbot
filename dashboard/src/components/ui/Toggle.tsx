import React, { useId } from 'react';

interface ToggleProps {
    label: string;
    /** Helper sentence shown under the label (and announced with the switch). */
    tooltip?: string;
    checked: boolean;
    onChange: (value: boolean) => void;
    disabled?: boolean;
}

/**
 * Fluent toggle switch row: label (and helper line) on the left, a 40x20
 * switch on the right. On = PollBot blue with a white knob; off = outline
 * with a grey knob. The label is clickable and the switch is keyboard
 * operable (Space / Enter).
 */
export const Toggle: React.FC<ToggleProps> = ({ label, tooltip, checked, onChange, disabled = false }) => {
    const id = useId();
    const helpId = `${id}-help`;
    return (
        <div className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
                <label htmlFor={id} className={`block text-sm text-ink ${disabled ? 'opacity-55' : 'cursor-pointer'}`}>
                    {label}
                </label>
                {tooltip && (
                    <p id={helpId} className="text-xs text-faint mt-0.5">
                        {tooltip}
                    </p>
                )}
            </div>
            <button
                id={id}
                type="button"
                role="switch"
                aria-checked={checked}
                aria-describedby={tooltip ? helpId : undefined}
                disabled={disabled}
                onClick={() => onChange(!checked)}
                className={`group relative shrink-0 mt-px w-10 h-5 rounded-full border transition-colors duration-150 disabled:opacity-55 disabled:cursor-not-allowed ${checked
                    ? 'bg-brand border-brand hover:bg-brand-hover hover:border-brand-hover'
                    : 'bg-transparent border-faint hover:bg-[var(--state-hover)]'
                    }`}
            >
                <span
                    aria-hidden="true"
                    className={`absolute top-1/2 -translate-y-1/2 rounded-full transition-all duration-150 ease-[cubic-bezier(0,0,0,1)] w-3 h-3 group-hover:w-3.5 group-hover:h-3.5 ${checked ? 'right-[3px] bg-white' : 'left-[3px] bg-muted'
                        }`}
                />
            </button>
        </div>
    );
};
