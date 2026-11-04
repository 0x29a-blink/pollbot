import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

interface ModalProps {
    open: boolean;
    onClose: () => void;
    /** Simple string title. For richer headers pass `header` instead. */
    title?: string;
    /** One grey line under the title (e.g. the poll or server it acts on). */
    subtitle?: React.ReactNode;
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
    /**
     * Buttons for the footer band (right-aligned, primary last). When given,
     * children are wrapped in a scrolling body so the band stays in view.
     */
    footer?: React.ReactNode;
    /** Optional content on the left of the footer band (a status line). */
    footerStart?: React.ReactNode;
    children: React.ReactNode;
}

/** Scrolling dialog body with the standard 24px inset. */
export const ModalBody: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <div className={`flex-1 min-h-0 overflow-y-auto px-6 pb-6 ${className}`}>{children}</div>
);

/** Fluent dialog footer band: a slightly darker strip, buttons right-aligned, primary last. */
export const ModalFooter: React.FC<{ children: React.ReactNode; start?: React.ReactNode }> = ({ children, start }) => (
    <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 px-6 py-4 bg-[#262626] border-t border-[#333333] rounded-b-card">
        {start && <div className="mr-auto min-w-0 text-xs text-faint truncate">{start}</div>}
        {children}
    </div>
);

/**
 * Shared dialog (Fluent ContentDialog): an opaque floating panel over a dim
 * backdrop, a 20px title with an optional grey subtitle, a close button, and
 * an optional footer band. Dialog semantics, ESC-to-close and focus restore.
 * All dashboard modals are built on this.
 */
export const Modal: React.FC<ModalProps> = ({
    open,
    onClose,
    title,
    subtitle,
    header,
    ariaLabel,
    closeOnBackdrop = true,
    width = 'max-w-lg',
    zIndex = 'z-50',
    footer,
    footerStart,
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
                    transition={{ duration: 0.15, ease: [0, 0, 0, 1] }}
                    className={`fixed inset-0 bg-black/60 ${zIndex} flex items-center justify-center p-4`}
                    onClick={closeOnBackdrop ? onClose : undefined}
                >
                    <motion.div
                        ref={panelRef}
                        tabIndex={-1}
                        role="dialog"
                        aria-modal="true"
                        aria-label={title ?? ariaLabel}
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        transition={{ duration: 0.15, ease: [0, 0, 0, 1] }}
                        style={{ boxShadow: 'var(--shadow-float)', outline: 'none' }}
                        className={`w-full ${width} max-h-[calc(100dvh-32px)] sm:max-h-[88vh] flex flex-col bg-overlay border border-[#3d3d3d] rounded-card text-ink outline-none`}
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    >
                        {(title || header) && (
                            <div className="shrink-0 flex items-start justify-between gap-4 pl-6 pr-3 pt-5 pb-4">
                                <div className="min-w-0 pt-0.5">
                                    {header ?? (
                                        <>
                                            <h2 className="font-[family-name:var(--font-display)] text-xl leading-7 font-semibold text-ink truncate">{title}</h2>
                                            {subtitle && <p className="text-sm text-faint truncate mt-0.5">{subtitle}</p>}
                                        </>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    aria-label="Close"
                                    className="btn btn-ghost btn-icon shrink-0"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        )}
                        {footer !== undefined ? (
                            <>
                                <ModalBody>{children}</ModalBody>
                                <ModalFooter start={footerStart}>{footer}</ModalFooter>
                            </>
                        ) : (
                            children
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

/** Standard dialog title block for the `header` slot: 20px title over one grey line. */
export const ModalTitle: React.FC<{ title: React.ReactNode; subtitle?: React.ReactNode }> = ({ title, subtitle }) => (
    <>
        <h2 className="font-[family-name:var(--font-display)] text-xl leading-7 font-semibold text-ink truncate">{title}</h2>
        {subtitle && <p className="text-sm text-faint truncate mt-0.5">{subtitle}</p>}
    </>
);
