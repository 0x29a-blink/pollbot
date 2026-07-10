import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
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

export const useToast = () => useContext(ToastContext);

const TOAST_MS = 4000;

/** App-wide toast stack. Mount once (see App.tsx); trigger via useToast(). */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const nextId = useRef(1);

    const push = useCallback((kind: ToastItem['kind'], message: string) => {
        const id = nextId.current++;
        setToasts(t => [...t, { id, kind, message }]);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), TOAST_MS);
    }, []);

    const api = useRef<ToastApi>({
        success: (m: string) => push('success', m),
        error: (m: string) => push('error', m),
    });

    return (
        <ToastContext.Provider value={api.current}>
            {children}
            <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 items-end pointer-events-none">
                <AnimatePresence>
                    {toasts.map(t => (
                        <motion.div
                            key={t.id}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 12 }}
                            role={t.kind === 'error' ? 'alert' : 'status'}
                            className="glass-panel px-4 py-3 flex items-center gap-3 pointer-events-auto max-w-sm"
                        >
                            {t.kind === 'success'
                                ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                                : <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />}
                            <span className="text-sm text-white">{t.message}</span>
                            <button
                                onClick={() => setToasts(list => list.filter(x => x.id !== t.id))}
                                aria-label="Dismiss notification"
                                className="text-slate-500 hover:text-white transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </ToastContext.Provider>
    );
};
