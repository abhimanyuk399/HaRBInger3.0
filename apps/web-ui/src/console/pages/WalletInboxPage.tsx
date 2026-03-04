import { useEffect, useMemo, useState } from 'react';
import { useConsole } from '../ConsoleContext';
import { ConsoleCard } from '../components/ConsoleCard';
import { PortalPageHeader } from '../components/PortalPageHeader';
import { StatusPill } from '../components/StatusPill';
import { formatDateTime, truncate } from '../utils';
import { EmptyState, TableLoadingSkeleton } from '../components/FeedbackStates';

type Row = Record<string, unknown>;

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function statusLabel(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === 'PENDING') return { pill: 'warn' as const, label: 'Pending' };
  if (normalized === 'APPROVED') return { pill: 'ok' as const, label: 'Approved' };
  if (normalized === 'REJECTED') return { pill: 'error' as const, label: 'Rejected' };
  if (normalized === 'EXPIRED') return { pill: 'neutral' as const, label: 'Expired' };
  return { pill: 'neutral' as const, label: status || 'Unknown' };
}

export default function WalletInboxPage() {
  const { walletConsents, refreshWalletConsents, approveConsent, rejectConsent, activeWalletUsername } = useConsole();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);
  const [approvedFieldMap, setApprovedFieldMap] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [modeFilter, setModeFilter] = useState<'all' | 'self' | 'delegated'>('all');
  const [page, setPage] = useState(1);
  const [selectedBulkIds, setSelectedBulkIds] = useState<Record<string, boolean>>({});
  const [bulkActing, setBulkActing] = useState<'approve' | 'reject' | null>(null);
  const [loading, setLoading] = useState(true);
  const pageSize = 8;

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void refreshWalletConsents().finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [refreshWalletConsents]);

  const inbox = useMemo(() => {
    return walletConsents
      .map((c) => c as unknown as Row)
      .filter((c) => String(c.lifecycleStatus ?? c.status ?? '').toUpperCase() === 'PENDING')
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  }, [walletConsents]);

  const filteredInbox = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return inbox.filter((row) => {
      const delegatedMode = String((row.delegatedContext as Row | undefined)?.mode ?? 'SELF').toUpperCase();
      if (modeFilter === 'self' && delegatedMode === 'DELEGATED') return false;
      if (modeFilter === 'delegated' && delegatedMode !== 'DELEGATED') return false;
      if (!query) return true;
      const haystack = [row.id, row.consentId, row.fiId, row.purpose, row.subjectUserId].map((v) => String(v ?? '')).join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [inbox, modeFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredInbox.length / pageSize));
  const pagedInbox = useMemo(() => filteredInbox.slice((page - 1) * pageSize, page * pageSize), [filteredInbox, page]);

  const selectedBulkCount = useMemo(() => Object.values(selectedBulkIds).filter(Boolean).length, [selectedBulkIds]);
  const pagedIds = useMemo(() => pagedInbox.map((row) => String(row.id ?? row.consentId ?? '')), [pagedInbox]);
  const allPagedSelected = pagedIds.length > 0 && pagedIds.every((id) => selectedBulkIds[id]);
  const togglePagedSelection = (checked: boolean) => {
    setSelectedBulkIds((prev) => {
      const next = { ...prev };
      pagedIds.forEach((id) => {
        if (!id) return;
        next[id] = checked;
      });
      return next;
    });
  };
  const runBulkAction = async (kind: 'approve' | 'reject') => {
    const ids = filteredInbox.map((row) => String(row.id ?? row.consentId ?? '')).filter((id) => selectedBulkIds[id]);
    if (ids.length === 0) return;
    setBulkActing(kind);
    try {
      for (const id of ids) {
        if (kind === 'approve') {
          await approveConsent(id, {});
        } else {
          await rejectConsent(id, 'Rejected in wallet inbox (bulk)');
        }
      }
      await refreshWalletConsents();
      setSelectedBulkIds({});
      setSelectedId(null);
    } finally {
      setBulkActing(null);
    }
  };

  const selected = useMemo(() => {
    const id = selectedId ?? (filteredInbox[0] ? String(filteredInbox[0].id ?? filteredInbox[0].consentId ?? '') : null);
    if (!id) return null;
    return inbox.find((row) => String(row.id ?? row.consentId ?? '') === id) ?? null;
  }, [filteredInbox, inbox, selectedId]);

  const requestedFields = useMemo(() => {
    if (!selected) return [] as string[];
    const raw = (selected as Row).requestedFields ?? (selected as Row).requested_fields ?? (selected as Row).fields;
    if (Array.isArray(raw)) {
      return raw.map((v) => String(v)).filter(Boolean);
    }
    return [];
  }, [selected]);

  useEffect(() => {
    // default: approve exactly what FI requested.
    const next: Record<string, boolean> = {};
    requestedFields.forEach((field) => {
      next[field] = true;
    });
    setApprovedFieldMap(next);
  }, [selectedId, requestedFields]);

  const applyPreset = (preset: 'FULL' | 'BASIC' | 'ADDRESS' | 'ID_ONLY') => {
    const base = new Set(requestedFields);
    const picks = new Set<string>();
    const basic = ['fullName', 'dob', 'phone', 'email', 'idNumber'];
    const address = ['addressLine1', 'addressLine2', 'city', 'state', 'pincode', 'country'];
    const idOnly = ['idNumber', 'aadhaar', 'pan', 'ckycReference'];

    const take = (fields: string[]) => fields.forEach((f) => base.has(f) && picks.add(f));

    if (preset === 'FULL') {
      requestedFields.forEach((f) => picks.add(f));
    } else if (preset === 'BASIC') {
      take(basic);
    } else if (preset === 'ADDRESS') {
      take(address);
    } else {
      take(idOnly);
    }

    const next: Record<string, boolean> = {};
    requestedFields.forEach((f) => {
      next[f] = picks.has(f);
    });
    setApprovedFieldMap(next);
  };

  useEffect(() => {
    setSelectedBulkIds((prev) => {
      const valid = new Set(filteredInbox.map((row) => String(row.id ?? row.consentId ?? '')));
      const next: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (v && valid.has(k)) next[k] = true;
      }
      return next;
    });
    if (!selectedId && filteredInbox.length > 0) {
      setSelectedId(String(filteredInbox[0].id ?? filteredInbox[0].consentId ?? ''));
    }
    if (page > totalPages) setPage(totalPages);
  }, [filteredInbox, page, selectedId, totalPages]);

  return (
    <div className="space-y-4">
      <PortalPageHeader title="Request Queue" subtitle="Pending requests (self + delegated). Search, filter, and review selectively." />

      <div className="flex justify-end">
        <button type="button" onClick={() => downloadJson(`wallet-request-queue-${activeWalletUsername ?? "user"}.json`, { exportedAt: new Date().toISOString(), viewer: activeWalletUsername, filter: { searchQuery, modeFilter }, rows: filteredInbox })} disabled={loading || filteredInbox.length === 0} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Export JSON</button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <ConsoleCard>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              placeholder="Search FI / purpose / user / consentId"
              className="kyc-form-input kyc-form-input-sm w-full md:w-80"
            />
            <div className="flex flex-wrap gap-2">
              {(['all','self','delegated'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setModeFilter(m); setPage(1); }}
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${modeFilter === m ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  {m === 'all' ? 'All' : m === 'self' ? 'Self' : 'Delegated'}
                </button>
              ))}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Showing {pagedInbox.length} of {filteredInbox.length}</span>
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">Selected {selectedBulkCount}</span>
              <button type="button" onClick={() => togglePagedSelection(!allPagedSelected)} className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
                {allPagedSelected ? 'Clear page' : 'Select page'}
              </button>
              <button type="button" disabled={selectedBulkCount===0 || bulkActing!==null} onClick={() => void runBulkAction('approve')} className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50">
                {bulkActing==='approve' ? 'Approving...' : 'Bulk approve'}
              </button>
              <button type="button" disabled={selectedBulkCount===0 || bulkActing!==null} onClick={() => void runBulkAction('reject')} className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-900 hover:bg-rose-100 disabled:opacity-50">
                {bulkActing==='reject' ? 'Rejecting...' : 'Bulk reject'}
              </button>
            </div>
          </div>
          {loading ? (
            <TableLoadingSkeleton rows={6} cols={7} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-xs text-slate-700">
                  <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2"><input type="checkbox" checked={allPagedSelected} onChange={(e)=>togglePagedSelection(e.target.checked)} /></th>
                      <th className="px-3 py-2">Received</th>
                      <th className="px-3 py-2">FI</th>
                      <th className="px-3 py-2">Purpose</th>
                      <th className="px-3 py-2">For user</th>
                      <th className="px-3 py-2">Mode</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredInbox.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-4 text-slate-500">No pending consents. Use FI Portal to create a consent request or check history for completed items.</td>
                      </tr>
                    ) : (
                      pagedInbox.map((row) => {
                        const id = String(row.id ?? row.consentId ?? '');
                        const delegatedMode = String((row.delegatedContext as Row | undefined)?.mode ?? 'SELF');
                        const subjectUser = String(row.subjectUserId ?? '-');
                        const status = String(row.lifecycleStatus ?? row.status ?? '');
                        const meta = statusLabel(status);
                        const active = selectedId === id;
                        return (
                          <tr key={id} className={active ? 'bg-indigo-50' : 'hover:bg-slate-50'} onClick={() => setSelectedId(id)} style={{ cursor: 'pointer' }}>
                            <td className="px-3 py-2" onClick={(e)=>e.stopPropagation()}>
                              <input type="checkbox" checked={Boolean(selectedBulkIds[id])} onChange={(e) => setSelectedBulkIds((prev) => ({ ...prev, [id]: e.target.checked }))} />
                            </td>
                            <td className="px-3 py-2">{formatDateTime(String(row.createdAt ?? ''))}</td>
                            <td className="px-3 py-2">{String(row.fiId ?? '-')}</td>
                            <td className="px-3 py-2">{String(row.purpose ?? '-')}</td>
                            <td className="px-3 py-2">{subjectUser}</td>
                            <td className="px-3 py-2">{delegatedMode === 'DELEGATED' ? 'Delegated' : 'Self'}</td>
                            <td className="px-3 py-2"><StatusPill status={meta.pill} label={meta.label} /></td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-500">Page {page} of {totalPages}</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Prev</button>
                  <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="rounded border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Next</button>
                </div>
              </div>
            </>
          )}
        </ConsoleCard>

        <ConsoleCard>
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected Consent</p>
            {!selected ? (
              loading ? <TableLoadingSkeleton rows={3} cols={1} /> : <EmptyState title="Select a request from the queue" description="The detail panel will show FI, purpose, subject user, delegation mode, and selective disclosure controls." />
            ) : (
              <>
                <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
                  <p className="font-semibold text-slate-900">Summary</p>
                  <p className="mt-1">consentId: {truncate(String(selected.id ?? selected.consentId ?? ''), 36)}</p>
                  <p>fiId: {String(selected.fiId ?? '-')}</p>
                  <p>purpose: {String(selected.purpose ?? '-')}</p>
                  <p>for user: {String(selected.subjectUserId ?? '-')}</p>
                  <p>viewer: {activeWalletUsername ?? '-'}</p>
                  <p>
                    mode:{' '}
                    {String((selected.delegatedContext as Row | undefined)?.mode ?? 'SELF') === 'DELEGATED'
                      ? `Delegated (on behalf of ${String((selected.delegatedContext as Row | undefined)?.delegatedBy ?? '-')})`
                      : 'Self'}
                  </p>
                  <p>expiresAt: {formatDateTime(String(selected.expiresAt ?? ''))}</p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-slate-900">Selective disclosure</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold hover:bg-slate-100" onClick={() => applyPreset('FULL')}>Full</button>
                      <button type="button" className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold hover:bg-slate-100" onClick={() => applyPreset('BASIC')}>Basic</button>
                      <button type="button" className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold hover:bg-slate-100" onClick={() => applyPreset('ADDRESS')}>Address-only</button>
                      <button type="button" className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold hover:bg-slate-100" onClick={() => applyPreset('ID_ONLY')}>ID-only</button>
                      <button type="button" className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold hover:bg-slate-50" onClick={() => setApprovedFieldMap(Object.fromEntries(requestedFields.map((f) => [f, true])))}>Select all</button>
                      <button type="button" className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold hover:bg-slate-50" onClick={() => setApprovedFieldMap(Object.fromEntries(requestedFields.map((f) => [f, false])))}>Clear all</button>
                    </div>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">Choose which fields to disclose (the FI may request more later).</p>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {requestedFields.length === 0 ? (
                      <p className="text-[11px] text-slate-500">No requested fields found on this consent.</p>
                    ) : (
                      requestedFields.map((field) => (
                        <label key={field} className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
                          <input
                            type="checkbox"
                            checked={Boolean(approvedFieldMap[field])}
                            onChange={(e) => setApprovedFieldMap((prev) => ({ ...prev, [field]: e.target.checked }))}
                          />
                          <span className="text-[11px] font-semibold text-slate-800">{field}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={acting !== null}
                    className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-60"
                    onClick={async () => {
                      const consentId = String(selected.id ?? selected.consentId ?? '');
                      if (!consentId) return;
                      setActing('approve');
                      try {
                        await approveConsent(consentId, approvedFieldMap);
                        await refreshWalletConsents();
                      } finally {
                        setActing(null);
                      }
                    }}
                  >
                    {acting === 'approve' ? 'Approving...' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    disabled={acting !== null}
                    className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900 hover:bg-rose-100 disabled:opacity-60"
                    onClick={async () => {
                      const consentId = String(selected.id ?? selected.consentId ?? '');
                      if (!consentId) return;
                      setActing('reject');
                      try {
                        await rejectConsent(consentId, 'Rejected in wallet inbox');
                        await refreshWalletConsents();
                      } finally {
                        setActing(null);
                      }
                    }}
                  >
                    {acting === 'reject' ? 'Rejecting...' : 'Reject'}
                  </button>
                  <button
                    type="button"
                    disabled={acting !== null}
                    className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-900 hover:bg-sky-100 disabled:opacity-60"
                    onClick={async () => {
                      const consentId = String(selected.id ?? selected.consentId ?? '');
                      if (!consentId) return;
                      setActing('approve');
                      try {
                        await approveConsent(consentId, approvedFieldMap);
                        await refreshWalletConsents();
                        setSelectedId(null);
                      } finally {
                        setActing(null);
                      }
                    }}
                  >
                    {acting === 'approve' ? 'Approving...' : 'Approve & next'}
                  </button>
                  <button
                    type="button"
                    disabled={acting !== null}
                    className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-900 hover:bg-orange-100 disabled:opacity-60"
                    onClick={async () => {
                      const consentId = String(selected.id ?? selected.consentId ?? '');
                      if (!consentId) return;
                      setActing('reject');
                      try {
                        await rejectConsent(consentId, 'Rejected in wallet inbox');
                        await refreshWalletConsents();
                        setSelectedId(null);
                      } finally {
                        setActing(null);
                      }
                    }}
                  >
                    {acting === 'reject' ? 'Rejecting...' : 'Reject & next'}
                  </button>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-700">
                  <p className="font-semibold text-slate-900">Raw payload</p>
                  <pre className="mt-2 max-h-[320px] overflow-auto whitespace-pre-wrap break-words">
                    {JSON.stringify(selected, null, 2)}
                  </pre>
                </div>
              </>
            )}
          </div>
        </ConsoleCard>
      </div>
    </div>
  );
}
