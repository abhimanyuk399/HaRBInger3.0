import { useEffect, useMemo, useState } from 'react';
import { useConsole } from '../ConsoleContext';
import { ConsoleCard } from '../components/ConsoleCard';
import { PortalPageHeader } from '../components/PortalPageHeader';
import { StatusPill } from '../components/StatusPill';
import { formatDateTime } from '../utils';
import { WALLET_OWNER_USER_ID } from '../identityConfig';
import { ConfirmActionDialog } from '../components/ConfirmActionDialog';
import { EmptyState, TableLoadingSkeleton } from '../components/FeedbackStates';

export default function WalletNomineesPage() {
  const { nominees, refreshNominees, createNominee, setNomineeStatus, addNomineeDelegation, refreshDelegations } = useConsole();
  const [newNominee, setNewNominee] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingToggle, setPendingToggle] = useState<{ id: string; action: 'enable' | 'disable'; nominee: string } | null>(null);
  const [delegationDraft, setDelegationDraft] = useState<{
    nomineeUserId: string;
    purpose: string;
    scope: string;
    expiry: string;
    allowedFields: string;
  } | null>(null);
  const [delegationSubmitting, setDelegationSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void refreshNominees().finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
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
        {loading ? <TableLoadingSkeleton rows={4} cols={4} /> : rows.length === 0 ? <EmptyState title="No nominees yet" description="Create a nominee and then create a delegation directly from that ACTIVE nominee row." /> : <div className="overflow-x-auto">
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
                  <td colSpan={4} className="px-3 py-4 text-slate-500">
                    No nominees.
                  </td>
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
                            onClick={() => {
                              setPendingToggle({ id: row.id, action: active ? 'disable' : 'enable', nominee: row.nomineeUserId });
                            }}
                          >
                            {active ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            type="button"
                            disabled={!active}
                            className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-[11px] font-semibold text-indigo-800 hover:bg-indigo-100 disabled:opacity-60"
                            onClick={() => {
                              const defaultExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
                              const yyyy = defaultExpiry.getFullYear();
                              const mm = String(defaultExpiry.getMonth() + 1).padStart(2, '0');
                              const dd = String(defaultExpiry.getDate()).padStart(2, '0');
                              const hh = String(defaultExpiry.getHours()).padStart(2, '0');
                              const mi = String(defaultExpiry.getMinutes()).padStart(2, '0');
                              setDelegationDraft({
                                nomineeUserId: row.nomineeUserId,
                                purpose: 'consent-approval',
                                scope: 'consent.approve',
                                expiry: `${yyyy}-${mm}-${dd}T${hh}:${mi}`,
                                allowedFields: 'full_name,dob,address,id_number',
                              });
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
        </div>}
      </ConsoleCard>

      {delegationDraft ? (
        <ConsoleCard>
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Create delegation from nominee</h3>
              <p className="text-xs text-slate-600">
                Delegation can only be created from an ACTIVE nominee row. Fill purpose, scope, expiry, and constraints before creating.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="kyc-form-field">
                <span className="kyc-form-label">Delegate username (nominee)</span>
                <input value={delegationDraft.nomineeUserId} readOnly className="kyc-form-input" />
              </label>
              <label className="kyc-form-field">
                <span className="kyc-form-label">Purpose</span>
                <input
                  value={delegationDraft.purpose}
                  onChange={(e) => setDelegationDraft((prev) => (prev ? { ...prev, purpose: e.target.value } : prev))}
                  className="kyc-form-input"
                  placeholder="insurance-claim / consent-approval"
                />
              </label>
              <label className="kyc-form-field">
                <span className="kyc-form-label">Scope</span>
                <input
                  value={delegationDraft.scope}
                  onChange={(e) => setDelegationDraft((prev) => (prev ? { ...prev, scope: e.target.value } : prev))}
                  className="kyc-form-input"
                  placeholder="consent.approve"
                />
              </label>
              <label className="kyc-form-field">
                <span className="kyc-form-label">Expiry</span>
                <input
                  type="datetime-local"
                  value={delegationDraft.expiry}
                  onChange={(e) => setDelegationDraft((prev) => (prev ? { ...prev, expiry: e.target.value } : prev))}
                  className="kyc-form-input"
                />
              </label>
            </div>
            <label className="kyc-form-field">
              <span className="kyc-form-label">Constraints (allowed fields, comma-separated)</span>
              <input
                value={delegationDraft.allowedFields}
                onChange={(e) => setDelegationDraft((prev) => (prev ? { ...prev, allowedFields: e.target.value } : prev))}
                className="kyc-form-input"
                placeholder="full_name,dob,address,id_number"
              />
              <span className="kyc-form-hint">These fields are stored as delegation constraints. Purpose/scope/expiry are mandatory.</span>
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => setDelegationDraft(null)}
                disabled={delegationSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={delegationSubmitting || !delegationDraft.nomineeUserId.trim() || !delegationDraft.purpose.trim() || !delegationDraft.scope.trim() || !delegationDraft.expiry.trim() || !delegationDraft.allowedFields.trim()}
                className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 disabled:opacity-60"
                onClick={async () => {
                  if (!delegationDraft) return;
                  const fieldList = delegationDraft.allowedFields
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean);
                  if (fieldList.length === 0) return;
                  setDelegationSubmitting(true);
                  try {
                    await addNomineeDelegation({
                      ownerUserId: WALLET_OWNER_USER_ID,
                      delegateUserId: delegationDraft.nomineeUserId.trim(),
                      scope: delegationDraft.scope.trim(),
                      allowedPurposes: [delegationDraft.purpose.trim()],
                      allowedFields: fieldList,
                      expiresAt: new Date(delegationDraft.expiry).toISOString(),
                    });
                    await refreshDelegations(WALLET_OWNER_USER_ID);
                    setDelegationDraft(null);
                  } finally {
                    setDelegationSubmitting(false);
                  }
                }}
              >
                {delegationSubmitting ? 'Creating...' : 'Create delegation'}
              </button>
            </div>
          </div>
        </ConsoleCard>
      ) : null}

      <ConfirmActionDialog
        open={!!pendingToggle}
        title={pendingToggle?.action === 'disable' ? 'Disable nominee' : 'Enable nominee'}
        message={<>Nominee <span className="font-semibold">{pendingToggle?.nominee}</span> will be {pendingToggle?.action}d. Delegation creation is only allowed from ACTIVE nominees.</>}
        confirmLabel={pendingToggle?.action === 'disable' ? 'Disable nominee' : 'Enable nominee'}
        confirmTone={pendingToggle?.action === 'disable' ? 'danger' : 'primary'}
        onCancel={() => setPendingToggle(null)}
        onConfirm={async () => {
          if (!pendingToggle) return;
          await setNomineeStatus(WALLET_OWNER_USER_ID, pendingToggle.id, pendingToggle.action);
          await refreshNominees(WALLET_OWNER_USER_ID);
          setPendingToggle(null);
        }}
      />
    </div>
  );
}
