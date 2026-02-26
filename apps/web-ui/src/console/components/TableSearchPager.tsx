import { useMemo, useState } from 'react';

export function usePagedFilter<T>(rows: T[], options: { pageSize?: number; match: (row: T, q: string) => boolean; query?: string }) {
  const pageSize = options.pageSize ?? 10;
  const [internalQuery, setInternalQuery] = useState('');
  const [page, setPage] = useState(1);
  const query = options.query ?? internalQuery;
  const setQuery = options.query !== undefined ? (_v: string) => {} : setInternalQuery;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => options.match(r, q));
  }, [rows, query, options]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(() => filtered.slice((safePage - 1) * pageSize, safePage * pageSize), [filtered, safePage, pageSize]);
  return { query, setQuery, page: safePage, setPage, totalPages, filteredCount: filtered.length, paged };
}

export function TableSearchPager(props: {
  query: string;
  setQuery: (v: string) => void;
  page: number;
  setPage: (p: number) => void;
  totalPages: number;
  filteredCount: number;
  placeholder?: string;
  compact?: boolean;
  hideSearch?: boolean;
}) {
  return (
    <div className={props.compact ? 'flex flex-wrap items-center justify-end gap-2 text-xs text-slate-600' : 'mb-3 flex flex-wrap items-center justify-between gap-2'}>
      {!props.hideSearch ? (
        <input
          value={props.query}
          onChange={(e) => {
            props.setPage(1);
            props.setQuery(e.target.value);
          }}
          className="kyc-form-input kyc-form-input-sm w-full md:w-72"
          placeholder={props.placeholder ?? 'Search'}
        />
      ) : null}
      <div className="flex items-center gap-2 text-xs text-slate-600">
        <span>{props.filteredCount} row(s)</span>
        <button
          type="button"
          onClick={() => props.setPage(Math.max(1, props.page - 1))}
          disabled={props.page <= 1}
          className="rounded border border-slate-300 bg-white px-2 py-1 disabled:opacity-50"
        >Prev</button>
        <span>Page {props.page}/{props.totalPages}</span>
        <button
          type="button"
          onClick={() => props.setPage(Math.min(props.totalPages, props.page + 1))}
          disabled={props.page >= props.totalPages}
          className="rounded border border-slate-300 bg-white px-2 py-1 disabled:opacity-50"
        >Next</button>
      </div>
    </div>
  );
}
