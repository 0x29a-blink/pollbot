import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    /** Danger styles the confirm button red (destructive actions). */
    danger?: boolean;
    busy?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

/** Styled replacement for window.confirm(), built on the shared Modal. */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    open,
    title,
    message,
    confirmLabel = 'Confirm',
    danger = false,
    busy = false,
    onConfirm,
    onCancel,
}) => (
    <Modal open={open} onClose={onCancel} title={title} width="max-w-md" zIndex="z-[70]">
        <div className="p-5">
            <div className="flex items-start gap-3">
                {danger && <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />}
                <p className="text-sm text-slate-300">{message}</p>
            </div>
            <div className="flex justify-end gap-3 mt-6">
                <button
                    onClick={onCancel}
                    disabled={busy}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                    Cancel
                </button>
                <button
                    onClick={onConfirm}
                    disabled={busy}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50 ${danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-primary-strong hover:bg-primary'}`}
                >
                    {busy ? 'Working…' : confirmLabel}
                </button>
            </div>
        </div>
    </Modal>
);
