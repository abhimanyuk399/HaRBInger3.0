interface TableFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  status?: string;
  onStatusChange?: (value: string) => void;
  statuses?: string[];
  placeholder?: string;
}

export function TableFilterBar({
  search,
  onSearchChange,
  status,
  onStatusChange,
  statuses = [],
  placeholder = 'Search by user, FI, purpose, consent ID…',
}: TableFilterBarProps) {
  return (
    <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50/90 p-3">
      <label className="min-w-[220px] flex-1">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Search</span>
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={placeholder}
          className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-indigo-400"
        />
      </label>
      {onStatusChange ? (
        <label className="w-[180px]">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Status</span>
          <select
            value={status ?? 'ALL'}
            onChange={(e) => onStatusChange(e.target.value)}
            className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-indigo-400"
          >
            <option value="ALL">All</option>
            {statuses.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
