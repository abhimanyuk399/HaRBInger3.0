import { useEffect, useMemo, useState } from 'react';
import { useConsole } from '../ConsoleContext';
import { ConsoleCard } from '../components/ConsoleCard';
import { PortalPageHeader } from '../components/PortalPageHeader';
import { StatusPill } from '../components/StatusPill';
import { formatDateTime, truncate } from '../utils';
import { mapConsentStatusMeta } from '../statusMeta';
import { TableFilterBar } from '../components/TableFilterBar';
import { EmptyStateCard } from '../components/EmptyStateCard';
import { ConfirmDialog } from '../components/ConfirmDialog';

type Row = Record<string, unknown>;


export default function WalletInboxPage() {
  const { walletConsents, refreshWalletConsents, approveConsent, rejectConsent, activeWalletUsername } = useConsole();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);
  const [approvedFieldMap, setApprovedFieldMap] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState('ALL');
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | null>(null);

  useEffect(() => {
    void refreshWalletConsents();
  }, [refreshWalletConsents]);

  const inbox = useMemo(() => {
    const query = search.trim().toLowerCase();
    return walletConsents
      .map((c) => c as unknown as Row)
      .filter((c) => String(c.lifecycleStatus ?? c.status ?? '').toUpperCase() === 'PENDING')
      .filter((c) => {
        const delegatedMode = String((c.delegatedContext as Row | undefined)?.mode ?? 'SELF').toUpperCase();
        if (modeFilter !== 'ALL' && delegatedMode !== modeFilter) return false;
        if (!query) return true;
        const hay = [c.id, c.consentId, c.fiId, c.purpose, c.subjectUserId].map((v) => String(v ?? '').toLowerCase()).join(' ');
        return hay.includes(query);
      })
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  }, [walletConsents, search, modeFilter]);

  const selected = useMemo(() => {
    const id = selectedId ?? (inbox[0] ? String(inbox[0].id ?? inbox[0].consentId ?? '') : null);
    if (!id) return null;
    return inbox.find((row) => String(row.id ?? row.consentId ?? '') === id) ?? null;
  }, [inbox, selectedId]);

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
    if (!selectedId && inbox.length > 0) {
      setSelectedId(String(inbox[0].id ?? inbox[0].consentId ?? ''));
    }
  }, [inbox, selectedId]);

  return (
    <div className="space-y-4">
      <PortalPageHeader title="Consent Inbox" subtitle="Pending requests (self + delegated). Select a row to view details." />

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <ConsoleCard>
          <TableFilterBar search={search} onSearchChange={setSearch} status={modeFilter} onStatusChange={setModeFilter} statuses={['SELF','DELEGATED']} placeholder="Search inbox by FI, purpose, user or consent ID…" />
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs text-slate-700">
              <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Received</th>
                  <th className="px-3 py-2">FI</th>
                  <th className="px-3 py-2">Purpose</th>
                  <th className="px-3 py-2">For user</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {inbox.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-4"><EmptyStateCard title="No pending consents" description="There are no pending consent requests for the current filter set. Try another mode filter or review Consent History." /></td>
                  </tr>
                ) : (
                  inbox.map((row) => {
                    const id = String(row.id ?? row.consentId ?? '');
                    const delegatedMode = String((row.delegatedContext as Row | undefined)?.mode ?? 'SELF');
                    const subjectUser = String(row.subjectUserId ?? '-');
                    const status = String(row.lifecycleStatus ?? row.status ?? '');
                    const meta = mapConsentStatusMeta(status);
                    const active = selectedId === id;
                    return (
                      <tr
                        key={id}
                        className={active ? 'bg-indigo-50' : 'hover:bg-slate-50'}
                        onClick={() => setSelectedId(id)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td className="px-3 py-2">{formatDateTime(String(row.createdAt ?? ''))}</td>
                        <td className="px-3 py-2">{String(row.fiId ?? '-')}</td>
                        <td className="px-3 py-2">{String(row.purpose ?? '-')}</td>
                        <td className="px-3 py-2">{subjectUser}</td>
                        <td className="px-3 py-2">{delegatedMode === 'DELEGATED' ? 'Delegated' : 'Self'}</td>
                        <td className="px-3 py-2">
                          <StatusPill status={meta.pill} label={meta.label} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </ConsoleCard>

        <ConsoleCard>
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected Consent</p>
            {!selected ? (
              <p className="text-sm text-slate-600">Select a consent from the inbox.</p>
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
                    onClick={() => {
                      const consentId = String(selected.id ?? selected.consentId ?? '');
                      if (!consentId) return;
                      setConfirmAction('approve');
                    }}
                  >
                    {acting === 'approve' ? 'Approving...' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    disabled={acting !== null}
                    className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900 hover:bg-rose-100 disabled:opacity-60"
                    onClick={() => {
                      const consentId = String(selected.id ?? selected.consentId ?? '');
                      if (!consentId) return;
                      setConfirmAction('reject');
                    }}
                  >
                    {acting === 'reject' ? 'Rejecting...' : 'Reject'}
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
      <ConfirmDialog
        open={confirmAction !== null}
        loading={acting !== null}
        tone={confirmAction === 'reject' ? 'warn' : 'default'}
        title={confirmAction === 'approve' ? 'Approve consent request' : 'Reject consent request'}
        message={confirmAction === 'approve' ? 'Proceed with approval using the selected field-level disclosure preferences?' : 'Proceed with rejecting the selected consent request?'}
        impactNote={confirmAction === 'approve' ? 'An auditable approval decision will be recorded and the FI will receive access only to the approved fields.' : 'The FI will be notified of the rejection and will need to raise a new request if needed.'}
        confirmLabel={confirmAction === 'approve' ? 'Approve' : 'Reject'}
        onCancel={() => setConfirmAction(null)}
        onConfirm={async () => {
          if (!selected) return;
          const consentId = String(selected.id ?? selected.consentId ?? '');
          if (!consentId) return;
          setActing(confirmAction);
          try {
            if (confirmAction === 'approve') await approveConsent(consentId, approvedFieldMap);
            else await rejectConsent(consentId, 'Rejected from Wallet Inbox');
            await refreshWalletConsents();
          } finally {
            setActing(null);
            setConfirmAction(null);
          }
        }}
      />
    </div>
  );
}
