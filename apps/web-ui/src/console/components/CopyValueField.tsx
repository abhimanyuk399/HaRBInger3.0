import { ClipboardCopy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { truncate } from '../utils';

interface CopyValueFieldProps {
  label: string;
  value?: string | null;
  truncateAt?: number;
  className?: string;
  mono?: boolean;
}

export function CopyValueField({
  label,
  value,
  truncateAt = 28,
  className,
  mono = true,
}: CopyValueFieldProps) {
  const [expanded, setExpanded] = useState(false);
  const normalized = useMemo(() => {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }, [value]);

  const copy = async () => {
    if (!normalized) {
      return;
    }
    try {
      await navigator.clipboard.writeText(normalized);
    } catch {
      // ignore clipboard failures in restricted environments.
    }
  };

  if (!normalized) {
    return (
      <p className={`flex items-center gap-1 ${className ?? ''}`}>
        <span className="font-semibold text-slate-800">{label}:</span>
        <span>-</span>
      </p>
    );
  }

  const shouldTruncate = normalized.length > truncateAt;
  const displayValue = shouldTruncate && !expanded ? truncate(normalized, truncateAt) : normalized;

  return (
    <p className={`flex flex-wrap items-center gap-1 ${className ?? ''}`}>
      <span className="font-semibold text-slate-800">{label}:</span>
      <span className={mono ? 'font-mono' : undefined}>{displayValue}</span>
      {shouldTruncate ? (
        <button
          type="button"
          className="inline-flex items-center text-xs font-semibold text-slate-700 hover:underline"
          onClick={() => setExpanded((previous) => !previous)}
        >
          {expanded ? 'Less' : 'Expand'}
        </button>
      ) : null}
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:underline"
        onClick={() => void copy()}
      >
        <ClipboardCopy className="h-3.5 w-3.5" />
        Copy
      </button>
    </p>
  );
}
