import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { useConsole } from '../ConsoleContext';
import { ConsoleCard } from '../components/ConsoleCard';
import { PortalPageHeader } from '../components/PortalPageHeader';
import { StatusPill } from '../components/StatusPill';
import { formatDateTime, truncate } from '../utils';
import { mapConsentStatusMeta } from '../statusMeta';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { TableFilterBar } from '../components/TableFilterBar';
import { EmptyStateCard } from '../components/EmptyStateCard';

type Row = Record<string, unknown>;


export default function WalletHistoryPage() {
  const { walletConsents, refreshWalletConsents, activeWalletUsername, revokeConsent } = useConsole();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [confirmRevokeOpen, setConfirmRevokeOpen] = useState(false);
  const [revokeBusy, setRevokeBusy] = useState(false);

  useEffect(() => {
    void refreshWalletConsents();
  }, [refreshWalletConsents]);

  const history = useMemo(() => {
    const query = search.trim().toLowerCase();
    return walletConsents
      .map((c) => c as unknown as Row)
      .filter((c) => String(c.lifecycleStatus ?? c.status ?? '').toUpperCase() !== 'PENDING')
      .filter((c) => {
        const st = String(c.lifecycleStatus ?? c.status ?? '').toUpperCase();
        if (statusFilter !== 'ALL' && st !== statusFilter) return false;
        if (!query) return true;
        const hay = [c.id, c.consentId, c.fiId, c.purpose, c.subjectUserId, c.actedByUserId].map((v) => String(v ?? '').toLowerCase()).join(' ');
        return hay.includes(query);
      })
      .sort((a, b) => String(b.updatedAt ?? b.createdAt ?? '').localeCompare(String(a.updatedAt ?? a.createdAt ?? '')));
  }, [walletConsents, search, statusFilter]);

  const selected = useMemo(() => {
    const id = selectedId ?? (history[0] ? String(history[0].id ?? history[0].consentId ?? '') : null);
    if (!id) return null;
    return history.find((row) => String(row.id ?? row.consentId ?? '') === id) ?? null;
  }, [history, selectedId]);

  useEffect(() => {
    if (!selectedId && history.length > 0) {
      setSelectedId(String(history[0].id ?? history[0].consentId ?? ''));
    }
  }, [history, selectedId]);

  return (
    <div className="space-y-4">
      <PortalPageHeader title="Consent History" subtitle="Historical consents with status, FI, purpose, and delegation context." />

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <ConsoleCard>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <TableFilterBar search={search} onSearchChange={setSearch} status={statusFilter} onStatusChange={setStatusFilter} statuses={['APPROVED','REJECTED','REVOKED','EXPIRED']} placeholder="Search history by FI, purpose, user, consent ID…" />
            <button
              type="button"
              onClick={() => { const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'wallet-consent-history.json'; a.click(); URL.revokeObjectURL(url); }}
              className="inline-flex items-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-100"
            ><Download className="h-4 w-4" /> Export JSON</button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs text-slate-700">
              <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Updated</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">FI</th>
                  <th className="px-3 py-2">Purpose</th>
                  <th className="px-3 py-2">Validity</th>
                  <th className="px-3 py-2">Acted by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-slate-500">
  
                    </td>
                  </tr>
                ) : (
                  history.map((row) => {
                    const id = String(row.id ?? row.consentId ?? '');
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
                        <td className="px-3 py-2">{formatDateTime(String(row.updatedAt ?? row.createdAt ?? ''))}</td>
                        <td className="px-3 py-2">
                          <StatusPill status={meta.pill} label={meta.label} />
                        </td>
                        <td className="px-3 py-2">{String(row.fiId ?? '-')}</td>
                        <td className="px-3 py-2">{String(row.purpose ?? '-')}</td>
                        <td className="px-3 py-2">{formatDateTime(String(row.expiresAt ?? ''))}</td>
                        <td className="px-3 py-2">{String(row.actedByUserId ?? '-')}</td>
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
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected Record</p>
            {!selected ? (
              <p className="text-sm text-slate-600">Select a consent from history.</p>
            ) : (
              <>
                <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
                  <p className="font-semibold text-slate-900">Summary</p>
                  <p className="mt-1">consentId: {truncate(String(selected.id ?? selected.consentId ?? ''), 36)}</p>
                  <p>viewer: {activeWalletUsername ?? '-'}</p>
                  <p>for user: {String(selected.subjectUserId ?? '-')}</p>
                  <p>actedBy: {String(selected.actedByUserId ?? '-')} ({String(selected.actedByType ?? '-')})</p>
                  <p>fiId: {String(selected.fiId ?? '-')}</p>
                  <p>purpose: {String(selected.purpose ?? '-')}</p>
                  <p>expiresAt: {formatDateTime(String(selected.expiresAt ?? ''))}</p>
                </div>

                {String(selected.lifecycleStatus ?? selected.status ?? '').toUpperCase() === 'APPROVED' ? (
                  <button
                    className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                    onClick={async () => {
                      const consentId = String(selected.id ?? selected.consentId ?? '');
                      if (!consentId) return;
                      setConfirmRevokeOpen(true);
                    }}
                  >
                    Revoke consent
                  </button>
                ) : null}

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-700">
                  <p className="font-semibold text-slate-900">Raw payload</p>
                  <pre className="mt-2 max-h-[360px] overflow-auto whitespace-pre-wrap break-words">
                    {JSON.stringify(selected, null, 2)}
                  </pre>
                </div>
              </>
            )}
          </div>
        </ConsoleCard>
      </div>
      <ConfirmDialog
        open={confirmRevokeOpen}
        loading={revokeBusy}
        tone="warn"
        title="Revoke approved consent"
        message="Do you want to revoke the selected approved consent?"
        impactNote="FI reuse for this approved consent will be blocked immediately and the revocation will be audit-tracked."
        confirmLabel="Revoke consent"
        onCancel={() => setConfirmRevokeOpen(false)}
        onConfirm={async () => {
          const consentId = selected ? String(selected.id ?? selected.consentId ?? '') : '';
          if (!consentId) return;
          setRevokeBusy(true);
          try {
            await revokeConsent(consentId, 'Revoked from Wallet History');
            await refreshWalletConsents();
          } finally {
            setRevokeBusy(false);
            setConfirmRevokeOpen(false);
          }
        }}
      />
    </div>
  );
}
