import { Copy } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/utils';
import { ConsoleButton } from './ConsoleButton';

interface JsonBlockProps {
  value: unknown;
  className?: string;
  compact?: boolean;
}

export function JsonBlock({ value, className, compact = false }: JsonBlockProps) {
  const [copied, setCopied] = useState(false);
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={cn('relative rounded-xl border border-slate-200 bg-slate-950/95 p-3', className)}>
      <ConsoleButton
        intent="secondary"
        size="sm"
        className="absolute right-2 top-2 h-7 border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800"
        onClick={copy}
      >
        <Copy className="h-3.5 w-3.5" />
        {copied ? 'Copied' : 'Copy'}
      </ConsoleButton>
      <pre
        className={cn(
          'overflow-auto pr-20 font-mono text-xs text-emerald-100',
          compact ? 'max-h-36' : 'max-h-64'
        )}
      >
        {text}
      </pre>
    </div>
  );
}
