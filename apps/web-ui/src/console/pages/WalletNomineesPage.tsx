import { useEffect, useMemo, useState } from 'react';
import { useConsole } from '../ConsoleContext';
import { ConsoleCard } from '../components/ConsoleCard';
import { PortalPageHeader } from '../components/PortalPageHeader';
import { StatusPill } from '../components/StatusPill';
import { formatDateTime } from '../utils';
import { WALLET_OWNER_USER_ID } from '../identityConfig';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyStateCard } from '../components/EmptyStateCard';

export default function WalletNomineesPage() {
  const { nominees, refreshNominees, createNominee, setNomineeStatus, addNomineeDelegation, refreshDelegations } = useConsole();
  const [newNominee, setNewNominee] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmNomineeAction, setConfirmNomineeAction] = useState<{ type: 'toggle' | 'delegation'; rowId: string; nomineeUserId: string; active?: boolean } | null>(null);

  useEffect(() => {
    void refreshNominees();
  }, [refreshNominees]);

  const rows = useMemo(() => nominees ?? [], [nominees]);

  return (
    <div className="space-y-4">
      <PortalPageHeader title="Nominees" subtitle="Create/disable nominees. Delegations can be created from an ACTIVE nominee row." />

      <ConsoleCard>
        <div className="flex flex-wrap items-end gap-2">
          <label className="kyc-form-field max-w-sm">
            <span className="kyc-form-label">Add nominee userId</span>
            <input
              value={newNominee}
              onChange={(e) => setNewNominee(e.target.value)}
              className="kyc-form-input"
              placeholder="wallet-nominee-1"
            />
          </label>
          <button
            type="button"
            disabled={submitting}
            className="rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 disabled:opacity-60"
            onClick={async () => {
              if (!newNominee.trim()) return;
              setSubmitting(true);
              try {
                await createNominee(WALLET_OWNER_USER_ID, newNominee.trim());
                setNewNominee('');
                await refreshNominees(WALLET_OWNER_USER_ID);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? 'Saving...' : 'Save nominee'}
          </button>
        </div>
      </ConsoleCard>

      <ConsoleCard>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs text-slate-700">
            <thead className="text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Nominee</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4"><EmptyStateCard title="No nominees configured" description="Add a nominee to support delegation for guardians/legal heirs and inclusive access flows." /></td>
                </tr>
              ) : (
                rows.map((row) => {
                  const active = String(row.status ?? '').toUpperCase() === 'ACTIVE';
                  return (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">{row.nomineeUserId}</td>
                      <td className="px-3 py-2">
                        <StatusPill status={active ? 'ok' : 'neutral'} label={active ? 'Active' : 'Disabled'} />
                      </td>
                      <td className="px-3 py-2">{formatDateTime(row.createdAt)}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                            onClick={async () => {
                              setConfirmNomineeAction({ type: 'toggle', rowId: row.id, nomineeUserId: row.nomineeUserId, active });
                            }}
                          >
                            {active ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            type="button"
                            disabled={!active}
                            className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-[11px] font-semibold text-indigo-800 hover:bg-indigo-100 disabled:opacity-60"
                            onClick={async () => {
                              setConfirmNomineeAction({ type: 'delegation', rowId: row.id, nomineeUserId: row.nomineeUserId });
                            }}
                          >
                            Create delegation
                          </button>
                        </div>
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
        open={Boolean(confirmNomineeAction)}
        tone={confirmNomineeAction?.type === 'toggle' && confirmNomineeAction?.active ? 'warn' : 'default'}
        title={confirmNomineeAction?.type === 'delegation' ? 'Create delegation from nominee' : confirmNomineeAction?.active ? 'Disable nominee' : 'Enable nominee'}
        message={confirmNomineeAction?.type === 'delegation' ? `Create a delegation authority for nominee ${confirmNomineeAction?.nomineeUserId}?` : confirmNomineeAction?.active ? `Disable nominee ${confirmNomineeAction?.nomineeUserId}?` : `Enable nominee ${confirmNomineeAction?.nomineeUserId}?`}
        impactNote={confirmNomineeAction?.type === 'delegation' ? 'A delegation record will be created with auditable controls and can be disabled later from the Delegations page.' : 'Nominee status changes affect delegation eligibility and delegated consent flows.'}
        confirmLabel={confirmNomineeAction?.type === 'delegation' ? 'Create delegation' : confirmNomineeAction?.active ? 'Disable nominee' : 'Enable nominee'}
        onCancel={() => setConfirmNomineeAction(null)}
        onConfirm={async () => {
          if (!confirmNomineeAction) return;
          if (confirmNomineeAction.type === 'delegation') {
            await addNomineeDelegation({ ownerUserId: WALLET_OWNER_USER_ID, delegateUserId: confirmNomineeAction.nomineeUserId });
            await refreshDelegations(WALLET_OWNER_USER_ID);
          } else {
            await setNomineeStatus(WALLET_OWNER_USER_ID, confirmNomineeAction.rowId, confirmNomineeAction.active ? 'disable' : 'enable');
            await refreshNominees(WALLET_OWNER_USER_ID);
          }
          setConfirmNomineeAction(null);
        }}
      />
    </div>
  );
}
