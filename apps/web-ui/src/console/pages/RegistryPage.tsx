import { useEffect, useState } from 'react';
import { api, routeFor } from '../../lib/config';
import { getWalletAccessToken } from '../../lib/keycloak';
import { ConsoleCard } from '../components/ConsoleCard';
import { PortalPageHeader } from '../components/PortalPageHeader';
import { StatusPill } from '../components/StatusPill';
import { formatDateTime, truncate } from '../utils';
import { TableSearchPager, usePagedFilter } from '../components/TableSearchPager';

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

export default function RegistryPage() {
  const [rows, setRows] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [userRefHash, setUserRefHash] = useState('');
  const table = usePagedFilter(rows, { pageSize: 10, match: (row, q) => [row.tokenId, row.status, row.userRefHash, row.issuerId].join(' ').toLowerCase().includes(q) });

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
        </div>
        {error ? <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">{error}</p> : null}
      </ConsoleCard>

      <ConsoleCard>
        <TableSearchPager {...table} placeholder="Search token / status / hash" />
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
              {table.paged.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-slate-500">
                    No tokens found.
                  </td>
                </tr>
              ) : (
                table.paged.map((row) => (
                  <tr key={row.tokenId} className="hover:bg-slate-50">
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </ConsoleCard>
    </div>
  );
}
