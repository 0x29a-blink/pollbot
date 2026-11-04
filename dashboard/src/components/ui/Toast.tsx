import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

interface ToastItem {
    id: number;
    kind: 'success' | 'error';
    message: string;
}

interface ToastApi {
    success: (message: string) => void;
    error: (message: string) => void;
}

const ToastContext = createContext<ToastApi>({
    success: () => { },
    error: () => { },
});

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(ToastContext);

const TOAST_MS = 4000;

/** App-wide toast stack (Fluent toast, bottom-right). Mount once (see App.tsx); trigger via useToast(). */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const nextId = useRef(1);

    const push = useCallback((kind: ToastItem['kind'], message: string) => {
        const id = nextId.current++;
        setToasts(t => [...t, { id, kind, message }]);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), TOAST_MS);
    }, []);

    const api = useMemo<ToastApi>(() => ({
        success: (m: string) => push('success', m),
        error: (m: string) => push('error', m),
    }), [push]);

    return (
        <ToastContext.Provider value={api}>
            {children}
            <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[100] flex flex-col gap-2 items-stretch sm:items-end pointer-events-none">
                <AnimatePresence>
                    {toasts.map(t => (
                        <motion.div
                            key={t.id}
                            layout
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15, ease: [0, 0, 0, 1] }}
                            role={t.kind === 'error' ? 'alert' : 'status'}
                            style={{ boxShadow: 'var(--shadow-float)' }}
                            className="pointer-events-auto sm:w-[360px] flex items-start gap-3 pl-4 pr-2 py-3 bg-overlay border border-[#3d3d3d] rounded-card"
                        >
                            {t.kind === 'success'
                                ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-positive shrink-0" aria-hidden="true" />
                                : <AlertCircle className="w-4 h-4 mt-0.5 text-negative shrink-0" aria-hidden="true" />}
                            <span className="flex-1 min-w-0 text-sm text-ink py-px">{t.message}</span>
                            <button
                                type="button"
                                onClick={() => setToasts(list => list.filter(x => x.id !== t.id))}
                                aria-label="Dismiss notification"
                                className="btn btn-ghost btn-sm btn-icon -my-1 shrink-0"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </ToastContext.Provider>
    );
};
