import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

interface ModalProps {
    open: boolean;
    onClose: () => void;
    /** Simple string title. For richer headers (icons, subtitles) pass `header` instead. */
    title?: string;
    /** Custom header content rendered to the left of the close button. */
    header?: React.ReactNode;
    /** Accessible name when no string title is given. */
    ariaLabel?: string;
    /** Close when the backdrop is clicked or ESC is pressed (default true). */
    closeOnBackdrop?: boolean;
    /** Tailwind max-width class for the panel (default 'max-w-lg'). */
    width?: string;
    /** Stacking context override, e.g. 'z-[60]' for modals above modals. */
    zIndex?: string;
    children: React.ReactNode;
}

/**
 * Shared modal primitive: consistent backdrop, glass panel, header + close
 * button, enter/exit animation, dialog semantics, ESC-to-close, and focus
 * restore. All dashboard modals should be built on this.
 */
export const Modal: React.FC<ModalProps> = ({
    open,
    onClose,
    title,
    header,
    ariaLabel,
    closeOnBackdrop = true,
    width = 'max-w-lg',
    zIndex = 'z-50',
    children,
}) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const previousFocus = useRef<Element | null>(null);

    useEffect(() => {
        if (!open) return;

        previousFocus.current = document.activeElement;
        panelRef.current?.focus();

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && closeOnBackdrop) onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            if (previousFocus.current instanceof HTMLElement) {
                previousFocus.current.focus();
            }
        };
    }, [open, closeOnBackdrop, onClose]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className={`fixed inset-0 bg-black/70 backdrop-blur-sm ${zIndex} flex items-center justify-center p-4`}
                    onClick={closeOnBackdrop ? onClose : undefined}
                >
                    <motion.div
                        ref={panelRef}
                        tabIndex={-1}
                        role="dialog"
                        aria-modal="true"
                        aria-label={title ?? ariaLabel}
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className={`glass-panel w-full ${width} max-h-[85vh] overflow-hidden flex flex-col outline-none`}
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    >
                        {(title || header) && (
                            <div className="flex items-center justify-between p-5 border-b border-slate-700">
                                {header ?? <h2 className="text-xl font-bold text-white">{title}</h2>}
                                <button
                                    onClick={onClose}
                                    aria-label="Close"
                                    className="p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-slate-800 shrink-0"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        )}
                        {children}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
