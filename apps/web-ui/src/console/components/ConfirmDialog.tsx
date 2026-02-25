import { AlertTriangle } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '../../lib/utils';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  impactNote?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger' | 'warn';
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  impactNote,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const confirmTone =
    tone === 'danger'
      ? 'border-rose-300 bg-rose-50 text-rose-900 hover:bg-rose-100'
      : tone === 'warn'
        ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
        : 'border-indigo-300 bg-indigo-50 text-indigo-900 hover:bg-indigo-100';

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-700">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            <p className="mt-1 text-sm text-slate-600">{message}</p>
            {impactNote ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                <span className="font-semibold text-slate-900">Impact:</span> {impactNote}
              </div>
            ) : null}
            <p className="mt-2 text-[11px] text-slate-500">This action will be recorded in the operational audit trail.</p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={loading} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            {cancelLabel}
          </button>
          <button type="button" onClick={() => void onConfirm()} disabled={loading} className={cn('rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-60', confirmTone)}>
            {loading ? 'Processing…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
