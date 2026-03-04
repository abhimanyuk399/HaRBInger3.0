export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {description ? <p className="mt-1 text-xs text-slate-500">{description}</p> : null}
    </div>
  );
}

export function TableLoadingSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="divide-y divide-slate-200">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="grid gap-3 px-3 py-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
            {Array.from({ length: cols }).map((__, j) => (
              <div key={j} className="h-4 animate-pulse rounded bg-slate-200" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
