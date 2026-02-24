import { useEffect } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import type { FlashMessage } from '../types';
import { cn } from '../../lib/utils';

interface FlashStackProps {
  messages: FlashMessage[];
  onDismiss: (id: string) => void;
}

interface FlashToastProps {
  message: FlashMessage;
  onDismiss: (id: string) => void;
}

function FlashToast({ message, onDismiss }: FlashToastProps) {
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      onDismiss(message.id);
    }, 5200);
    return () => window.clearTimeout(timeout);
  }, [message.id, onDismiss]);

  const toneStyles =
    message.tone === 'success'
      ? {
          wrapper: 'border-emerald-300/60 bg-emerald-50/95 text-emerald-900',
          icon: <CheckCircle2 className="h-4 w-4 text-emerald-700" />,
        }
      : message.tone === 'error'
        ? {
            wrapper: 'border-rose-300/60 bg-rose-50/95 text-rose-900',
            icon: <XCircle className="h-4 w-4 text-rose-700" />,
          }
        : {
            wrapper: 'border-sky-300/60 bg-sky-50/95 text-sky-900',
            icon: <Info className="h-4 w-4 text-sky-700" />,
          };

  return (
    <div className={cn('pointer-events-auto rounded-xl border px-3 py-2 shadow-lg backdrop-blur', toneStyles.wrapper)}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5">{toneStyles.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">{message.message}</p>
          {message.detail ? <p className="mt-0.5 text-xs opacity-90">{message.detail}</p> : null}
        </div>
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition hover:bg-black/5 hover:text-slate-900"
          onClick={() => onDismiss(message.id)}
          aria-label="Dismiss message"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function FlashStack({ messages, onDismiss }: FlashStackProps) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[120] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
      {messages.map((message) => (
        <FlashToast key={message.id} message={message} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

