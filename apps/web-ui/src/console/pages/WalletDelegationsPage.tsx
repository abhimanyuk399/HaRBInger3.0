import { useEffect, useMemo, useState } from 'react';
import { useConsole } from '../ConsoleContext';
import { ConsoleCard } from '../components/ConsoleCard';
import { PortalPageHeader } from '../components/PortalPageHeader';
import { StatusPill } from '../components/StatusPill';
import { formatDateTime, truncate } from '../utils';
import { WALLET_OWNER_USER_ID } from '../identityConfig';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyStateCard } from '../components/EmptyStateCard';

export default function WalletDelegationsPage() {
  const { delegations, refreshDelegations, revokeDelegation, nominees, refreshNominees } = useConsole();
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirmDelegationId, setConfirmDelegationId] = useState<string | null>(null);

  useEffect(() => {
    void Promise.allSettled([refreshDelegations(WALLET_OWNER_USER_ID), refreshNominees(WALLET_OWNER_USER_ID)]);
  }, [refreshDelegations, refreshNominees]);

  const rows = useMemo(() => delegations ?? [], [delegations]);
  const nomineeSet = useMemo(() => new Set((nominees ?? []).map((n) => n.nomineeUserId)), [nominees]);

  return (
    <div className="space-y-4">
      <PortalPageHeader title="Delegations" subtitle="Active and disabled delegations. Delegations can only be created from the nominee list." />

      <ConsoleCard>
        <div className="text-xs text-slate-600">
          Nominees loaded: {nomineeSet.size}. Delegations loaded: {rows.length}.
        </div>
      </ConsoleCard>

      <ConsoleCard>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs text-slate-700">
            <thead className="text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Delegate</th>
                <th className="px-3 py-2">Scope</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Expires</th>
                <th className="px-3 py-2">Constraints</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4"><EmptyStateCard title="No delegations configured" description="Create a nominee first and create a delegation from the nominee list to support delegated approvals." /></td>
                </tr>
              ) : (
                rows.map((row) => {
                  const status = String(row.status ?? '').toUpperCase();
                  const active = status === 'ACTIVE';
                  return (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">{row.delegateUserId}</td>
                      <td className="px-3 py-2">{row.scope}</td>
                      <td className="px-3 py-2">
                        <StatusPill status={active ? 'ok' : status === 'EXPIRED' ? 'neutral' : 'warn'} label={status} />
                      </td>
                      <td className="px-3 py-2">{formatDateTime(row.expiresAt)}</td>
                      <td className="px-3 py-2">
                        <div className="space-y-0.5 text-[11px]">
                          <div>purposes: {Array.isArray(row.allowedPurposes) ? row.allowedPurposes.join(', ') : '-'}</div>
                          <div>fields: {Array.isArray(row.allowedFields) ? row.allowedFields.join(', ') : '-'}</div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          disabled={!active || revoking === row.id}
                          className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-[11px] font-semibold text-rose-900 hover:bg-rose-100 disabled:opacity-60"
                          onClick={async () => {
                            setConfirmDelegationId(row.id);
                          }}
                        >
                          {revoking === row.id ? 'Revoking...' : 'Disable'}
                        </button>
                        {!nomineeSet.has(row.delegateUserId) ? (
                          <div className="mt-1 text-[10px] text-amber-700">
                            Note: nominee record missing for this delegate.
                          </div>
                        ) : null}
                        <div className="mt-1 text-[10px] text-slate-500">id: {truncate(row.id, 18)}</div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </ConsoleCard>
      <ConfirmDialog
        open={Boolean(confirmDelegationId)}
        loading={Boolean(revoking)}
        tone="warn"
        title="Disable delegation"
        message="Do you want to disable this delegation authority?"
        impactNote="The delegate will no longer be able to approve/reject consent requests on behalf of the owner until re-enabled."
        confirmLabel="Disable delegation"
        onCancel={() => setConfirmDelegationId(null)}
        onConfirm={async () => {
          if (!confirmDelegationId) return;
          setRevoking(confirmDelegationId);
          try {
            await revokeDelegation(confirmDelegationId);
            await refreshDelegations(WALLET_OWNER_USER_ID);
          } finally {
            setRevoking(null);
            setConfirmDelegationId(null);
          }
        }}
      />
    </div>
  );
}
