import type { ReactNode } from "react";

interface ConfirmActionDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmTone?: "danger" | "primary";
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmActionDialog({ open, title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", confirmTone = "primary", busy = false, onConfirm, onCancel }: ConfirmActionDialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/50 p-4">
      <button type="button" className="absolute inset-0" aria-label="Close confirmation dialog" onClick={onCancel} />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <div className="mt-2 text-sm text-slate-600">{message}</div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">{cancelLabel}</button>
          <button type="button" onClick={() => void onConfirm()} disabled={busy} className={`rounded-xl px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 ${confirmTone === "danger" ? "bg-rose-600 hover:bg-rose-700" : "bg-violet-600 hover:bg-violet-700"}`}>{busy ? "Working..." : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
