import React from 'react';
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
    <Modal
        open={open}
        onClose={onCancel}
        title={title}
        width="max-w-md"
        zIndex="z-[70]"
        footer={
            <>
                <button type="button" onClick={onCancel} disabled={busy} className="btn btn-outline">
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={onConfirm}
                    disabled={busy}
                    className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`}
                >
                    {busy ? 'Working…' : confirmLabel}
                </button>
            </>
        }
    >
        <p className="text-sm text-muted">{message}</p>
    </Modal>
);
