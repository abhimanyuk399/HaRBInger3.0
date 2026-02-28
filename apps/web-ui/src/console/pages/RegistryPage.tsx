import { useEffect, useState } from 'react';
import { api, routeFor } from '../../lib/config';
import { getWalletAccessToken } from '../../lib/keycloak';
import { ConsoleCard } from '../components/ConsoleCard';
import { PortalPageHeader } from '../components/PortalPageHeader';
import { StatusPill } from '../components/StatusPill';
import { EmptyState, TableLoadingSkeleton } from '../components/FeedbackStates';
import { formatDateTime, truncate } from '../utils';

type TokenRow = {
  tokenId: string;
  issuerId: string;
  userRefHash: string;
  status: string;
  version: number;
  issuedAt: string;
  expiresAt: string;
  supersededBy?: string | null;
  updatedAt: string;
};

async function computeUserRefHashFromIdentifier(identifier: string): Promise<string> {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return '';
  }
  const payload = new TextEncoder().encode(normalized);
  const digest = await subtle.digest('SHA-256', payload);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}


function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function RegistryPage() {
  const [rows, setRows] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [userRefHash, setUserRefHash] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = await getWalletAccessToken();
      const normalizedUserId = userIdFilter.trim();
      const computedUserRefHash = normalizedUserId ? await computeUserRefHashFromIdentifier(normalizedUserId) : '';
      const qs = new URLSearchParams();
      if (statusFilter.trim()) qs.set('status', statusFilter.trim());
      if (computedUserRefHash) qs.set('userRefHash', computedUserRefHash);
      qs.set('limit', '200');

      const resp = await fetch(routeFor(api.registry, `/v1/registry/tokens?${qs.toString()}`), {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`${resp.status}: ${txt}`);
      }
      const payload = (await resp.json()) as { tokens?: TokenRow[] };
      setRows(Array.isArray(payload.tokens) ? payload.tokens : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load registry tokens');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    const normalizedUserId = userIdFilter.trim();
    if (!normalizedUserId) {
      setUserRefHash('');
      return undefined;
    }

    void computeUserRefHashFromIdentifier(normalizedUserId)
      .then((value) => {
        if (!cancelled) {
          setUserRefHash(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUserRefHash('');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [userIdFilter]);

  return (
    <div className="space-y-4">
      <PortalPageHeader title="Registry" subtitle="Token registry with lifecycle status, user hash, expiry, and audit pointers." />

      <ConsoleCard>
        <div className="flex flex-wrap items-end gap-2">
          <label className="kyc-form-field">
            <span className="kyc-form-label">Status</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="kyc-form-select">
              <option value="">All</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="REVOKED">REVOKED</option>
              <option value="SUPERSEDED">SUPERSEDED</option>
              <option value="EXPIRED">EXPIRED</option>
            </select>
          </label>
          <label className="kyc-form-field">
            <span className="kyc-form-label">UserId (optional)</span>
            <input value={userIdFilter} onChange={(e) => setUserIdFilter(e.target.value)} className="kyc-form-input" placeholder="wallet-owner-1" />
            {userRefHash ? <p className="kyc-form-hint">userRefHash: {truncate(userRefHash, 18)}</p> : null}
          </label>
          <button
            type="button"
            className="rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 disabled:opacity-60"
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            disabled={loading || rows.length === 0}
            onClick={() => downloadJson('registry-tokens.json', { exportedAt: new Date().toISOString(), statusFilter, userIdFilter, userRefHash, rows })}
          >
            Export JSON
          </button>
        </div>
        {error ? <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">{error}</p> : null}
      </ConsoleCard>

      <ConsoleCard>
        {loading ? (
          <TableLoadingSkeleton rows={6} cols={5} />
        ) : rows.length === 0 ? (
          <EmptyState title="No tokens found" description="Try changing status or user filters, then refresh the registry view." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs text-slate-700">
              <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Updated</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Token</th>
                  <th className="px-3 py-2">UserRefHash</th>
                  <th className="px-3 py-2">Expires</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((row, index) => (
                  <tr key={row.tokenId} className={index % 2 === 0 ? 'bg-white hover:bg-slate-50' : 'bg-slate-50/40 hover:bg-slate-50'}>
                    <td className="px-3 py-2">{formatDateTime(row.updatedAt)}</td>
                    <td className="px-3 py-2">
                      <StatusPill
                        status={row.status === 'ACTIVE' ? 'ok' : row.status === 'REVOKED' ? 'error' : 'neutral'}
                        label={row.status}
                      />
                    </td>
                    <td className="px-3 py-2">{truncate(row.tokenId, 18)}</td>
                    <td className="px-3 py-2">{truncate(row.userRefHash, 18)}</td>
                    <td className="px-3 py-2">{formatDateTime(row.expiresAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ConsoleCard>
    </div>
  );
}
