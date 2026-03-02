import { CalendarClock, Layers, Link2, RefreshCw, ShieldCheck, Lock, WalletCards, Building2, Landmark, FileCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useConsole } from '../ConsoleContext';
import { ConsoleButton } from '../components/ConsoleButton';
import { ConsoleCard } from '../components/ConsoleCard';
import { SectionHeader } from '../components/SectionHeader';
import { StatusPill } from '../components/StatusPill';
import { formatDateTime, truncate } from '../utils';

const ckycSandboxBaseUrl =
  (import.meta.env.VITE_CKYCR_SANDBOX_BASE_URL as string | undefined) ??
  (import.meta.env.VITE_CKYC_SANDBOX_BASE_URL as string | undefined) ??
  '';

const adapterBaseUrl = (import.meta.env.VITE_CKYC_ADAPTER_BASE_URL as string | undefined) ?? 'http://localhost:3006';

type WorkStatus = 'implemented' | 'in_progress' | 'planned';

type ConnectorKey = 'ckycr' | 'aadhaar' | 'digilocker';

const defaultPolicyForm = {
  retentionDays: '365',
  maskByDefault: true,
  auditExportApproval: true,
  sectorTemplate: 'banking',
};


const mockConnectorSamples: Record<ConnectorKey, { name: string; status: WorkStatus; description: string; sample: Record<string, unknown> }> = {
  ckycr: {
    name: 'CKYCR',
    status: 'implemented',
    description: 'Central KYC Registry adapter for fetch/health and periodic review sync workflows.',
    sample: { endpoint: '/adapters/ckyc/fetch', request: { ckycReference: 'CKYC-1234' }, response: { syncStatus: 'SUCCESS', tokenLifecycleAction: 'SUPERSEDE' } },
  },
  aadhaar: {
    name: 'Aadhaar',
    status: 'in_progress',
    description: 'Mock eKYC identity assertion connector (masked fields only for demo).',
    sample: { endpoint: '/adapters/aadhaar/ekyc/mock', request: { consentId: 'CONSENT-1', otpRef: 'OTP-REF' }, response: { aadhaar_masked: 'XXXX-XXXX-1234', name: 'Masked Demo User', dob: '1992-03-21' } },
  },
  digilocker: {
    name: 'DigiLocker',
    status: 'in_progress',
    description: 'Mock document retrieval connector for consented KYC evidence pull.',
    sample: { endpoint: '/adapters/digilocker/documents/mock', request: { consentId: 'CONSENT-1', docType: 'PAN' }, response: { documentId: 'DL-001', docType: 'PAN', checksum: 'sha256:demo' } },
  },
};

export default function IntegrationsPage() {
  const commandBirdsEyeOnly = true;
  const { runningAction, dueUsers, reviewRun, loadDueUsers, runReviewOnce } = useConsole();
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));

  const [selectedConnector, setSelectedConnector] = useState<ConnectorKey>('ckycr');
  const [policyForm, setPolicyForm] = useState(defaultPolicyForm);
  useEffect(() => {
    void loadPolicyFromAdapter();
  }, []);

  const loadPolicyFromAdapter = async () => {
    try {
      const response = await fetch(`${adapterBaseUrl.replace(/\/$/, '')}/v1/adapters/privacy/policy`);
      if (!response.ok) return;
      const json = (await response.json()) as { policy?: { retentionDays?: number; maskByDefault?: boolean; auditExportApproval?: boolean; sectorTemplate?: string } };
      if (!json.policy) return;
      setPolicyForm({
        retentionDays: String(json.policy.retentionDays ?? 365),
        maskByDefault: Boolean(json.policy.maskByDefault ?? true),
        auditExportApproval: Boolean(json.policy.auditExportApproval ?? true),
        sectorTemplate: String(json.policy.sectorTemplate ?? 'banking'),
      });
    } catch {
      // UI can operate in demo-only mode without adapter
    }
  };

  const savePolicyToAdapter = async () => {
    try {
      const res = await fetch(`${adapterBaseUrl.replace(/\/$/, '')}/v1/adapters/privacy/policy`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          retentionDays: Number(policyForm.retentionDays || 365),
          maskByDefault: policyForm.maskByDefault,
          auditExportApproval: policyForm.auditExportApproval,
          sectorTemplate: policyForm.sectorTemplate,
        }),
      });
      setPolicySaveState(res.ok ? 'saved' : 'error');
      window.setTimeout(() => setPolicySaveState('idle'), 1500);
    } catch {
      setPolicySaveState('error');
      window.setTimeout(() => setPolicySaveState('idle'), 1500);
    }
  };


  const [mockRuns, setMockRuns] = useState<Array<{ connector: ConnectorKey; at: string; outcome: 'SUCCESS' | 'PENDING' | 'FAILED'; response?: Record<string, unknown>; durationMs?: number }>>([]);
  const [policySaveState, setPolicySaveState] = useState<'idle' | 'saved' | 'error'>('idle');

  const hasUnsavedPolicyChanges = useMemo(() => JSON.stringify(policyForm) !== JSON.stringify(defaultPolicyForm), [policyForm]);
  const integrationHealth = useMemo(() => {
    const recent = mockRuns.slice(0, 12);
    const byConnector = (key: ConnectorKey) => recent.filter((r) => r.connector === key);
    const summarize = (rows: typeof recent) => {
      const total = rows.length;
      const fail = rows.filter((r) => r.outcome === 'FAILED').length;
      const avgLatency = rows.filter((r) => typeof r.durationMs === 'number').reduce((a, r, _, arr) => a + (r.durationMs ?? 0) / Math.max(1, arr.length), 0);
      return { total, fail, failRate: total ? Math.round((fail * 100) / total) : 0, avgLatencyMs: Math.round(avgLatency) };
    };
    return {
      overall: summarize(recent),
      ckycr: summarize(byConnector('ckycr')),
      aadhaar: summarize(byConnector('aadhaar')),
      digilocker: summarize(byConnector('digilocker')),
    };
  }, [mockRuns]);

const runMockConnector = async (connector: ConnectorKey) => {
    const startedAt = Date.now();
    if (connector === 'ckycr') {
      const durationMs = Math.max(20, Date.now() - startedAt);
      setMockRuns((prev) => [{ connector, at: new Date().toISOString(), outcome: 'SUCCESS', durationMs }, ...prev].slice(0, 20));
      return;
    }
    const path = connector === 'aadhaar' ? '/v1/adapters/aadhaar/ekyc/mock' : '/v1/adapters/digilocker/documents/mock';
    const body = connector === 'aadhaar'
      ? { consentId: 'CONSENT-1', otpRef: 'OTP-REF' }
      : { consentId: 'CONSENT-1', docType: 'PAN' };
    try {
      const response = await fetch(`${adapterBaseUrl.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      setMockRuns((prev) => [{ connector, at: new Date().toISOString(), outcome: response.ok ? 'SUCCESS' : 'FAILED', response: json, durationMs: Date.now() - startedAt }, ...prev].slice(0, 20));
    } catch {
      setMockRuns((prev) => [{ connector, at: new Date().toISOString(), outcome: 'FAILED', durationMs: Date.now() - startedAt }, ...prev].slice(0, 20));
    }
  };

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-4">
      <ConsoleCard className="border-slate-200 bg-white">
        <SectionHeader
          title="Bharat KYC T - Integrations"
          subtitle="CKYCR adapter + periodic review scheduler. Designed for pluggable real integrations."
          action={<StatusPill status={ckycSandboxBaseUrl ? 'warn' : 'neutral'} label={ckycSandboxBaseUrl ? 'CKYCR sandbox' : 'CKYCR local adapter'} />}
        />
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">CKYCR mode</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">{ckycSandboxBaseUrl ? 'Sandbox' : 'Local adapter'}</p>
            <p className="mt-1 text-xs text-slate-600">{ckycSandboxBaseUrl ? truncate(ckycSandboxBaseUrl, 48) : 'Local adapter endpoints'}</p>
            <ConsoleButton
              intent="secondary"
              size="sm"
              className="mt-2"
              onClick={() => runMockConnector('ckycr')}
              disabled={commandBirdsEyeOnly || runningAction !== null}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Test health
            </ConsoleButton>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Periodic review</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">{reviewRun ? 'Last run recorded' : 'No run yet'}</p>
            <p className="mt-1 text-xs text-slate-600">
              Default tiers: HIGH=2y - MEDIUM=8y - LOW=10y (config-driven)
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Due users loaded</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{dueUsers.length}</p>
            <p className="mt-1 text-xs text-slate-600">for the selected "as of" date</p>
          </div>
        </div>
      </ConsoleCard>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ConsoleCard className="border-slate-200 bg-white">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Integration health</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{integrationHealth.overall.failRate}%</p>
          <p className="mt-1 text-xs text-slate-600">Recent failure rate ({integrationHealth.overall.total} runs)</p>
        </ConsoleCard>
        <ConsoleCard className="border-slate-200 bg-white">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Avg mock latency</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{integrationHealth.overall.avgLatencyMs || 0} ms</p>
          <p className="mt-1 text-xs text-slate-600">Across recent connector runs</p>
        </ConsoleCard>
        <ConsoleCard className="border-slate-200 bg-white">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aadhaar / DigiLocker</p>
          <p className="mt-2 text-sm font-semibold text-slate-900">Aadhaar {integrationHealth.aadhaar.failRate}% fail · DigiLocker {integrationHealth.digilocker.failRate}% fail</p>
          <p className="mt-1 text-xs text-slate-600">Quick troubleshooting snapshot</p>
        </ConsoleCard>
        <ConsoleCard className="border-slate-200 bg-white">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last run</p>
          <p className="mt-2 text-sm font-semibold text-slate-900">{mockRuns[0] ? `${mockRuns[0].connector.toUpperCase()} · ${mockRuns[0].outcome}` : 'No run yet'}</p>
          <p className="mt-1 text-xs text-slate-600">{mockRuns[0] ? `${formatDateTime(mockRuns[0].at)}${typeof mockRuns[0].durationMs === 'number' ? ` · ${mockRuns[0].durationMs} ms` : ''}` : 'Run a connector mock to populate metrics'}</p>
        </ConsoleCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <ConsoleCard id="periodic-review">
          <SectionHeader
            title="Periodic KYC review"
            subtitle="Load due list or run scheduler once (writes audit evidence)."
            action={<StatusPill status={reviewRun ? 'ok' : 'neutral'} label={reviewRun ? 'Run recorded' : 'Not run'} />}
          />

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="kyc-form-field text-sm text-slate-700">
              <span className="kyc-form-label">As of</span>
              <input
                type="date"
                value={asOf}
                onChange={(event) => setAsOf(event.target.value)}
                className="mt-1 block kyc-form-input kyc-form-input-sm"
              />
            </label>
            <ConsoleButton intent="secondary" onClick={() => void loadDueUsers(asOf)} disabled={commandBirdsEyeOnly || runningAction !== null}>
              <Layers className="h-4 w-4" />
              Load due list
            </ConsoleButton>
            <ConsoleButton onClick={() => void runReviewOnce(asOf)} disabled={commandBirdsEyeOnly || runningAction !== null}>
              <CalendarClock className="h-4 w-4" />
              Run once
            </ConsoleButton>
          </div>

          <div className="mt-4 max-h-60 space-y-2 overflow-auto pr-1">
            {dueUsers.length === 0 ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-600">No due users loaded.</p>
            ) : (
              dueUsers.map((user) => (
                <div key={`${user.userId}-${user.nextReviewAt}`} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-sm text-slate-700">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-900">{user.userId}</p>
                    <StatusPill status="neutral" label={user.riskTier} />
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    nextReviewAt: {formatDateTime(user.nextReviewAt)} - plannedAction: {user.plannedAction}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">reason: {user.reason}</p>
                </div>
              ))
            )}
          </div>
        </ConsoleCard>

        <ConsoleCard>
          <SectionHeader title="Scheduler summary" subtitle="What the last run did across due users." />
          {reviewRun ? (
            <div className="mt-3 space-y-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <div className="grid gap-1 text-xs text-slate-600">
                  <p>
                    <span className="font-semibold text-slate-800">jobId:</span> {reviewRun.jobId}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-800">asOf:</span> {reviewRun.asOf}
                  </p>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <StatusPill status="neutral" label={`totalDue ${reviewRun.totalDue}`} />
                  <StatusPill status="ok" label={`synced ${reviewRun.synced}`} />
                  <StatusPill status="neutral" label={`unchanged ${reviewRun.unchanged}`} />
                  <StatusPill status="warn" label={`reconsent ${reviewRun.reconsent}`} />
                  <StatusPill status="error" label={`failed ${reviewRun.failed}`} />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
                <p className="font-semibold text-slate-800">Actions taken</p>
                <div className="mt-2 max-h-44 space-y-1 overflow-auto pr-1">
                  {reviewRun.actionsTaken.map((action, index) => (
                    <p key={`${action.userId}-${index}`}>
                      <span className="font-semibold text-slate-800">{action.userId}</span>: {action.plannedAction} {'->'} {action.outcome}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-600">Run once to populate summary.</p>
          )}
        </ConsoleCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr]">
        <ConsoleCard className="border-slate-200 bg-white">
          <SectionHeader
            title="Connector coverage (CKYCR / Aadhaar / DigiLocker)"
            subtitle="Mock connectors added for demo completeness and interoperability mapping."
            action={<Landmark className="h-4 w-4 text-slate-500" />}
          />

          <div className="mt-3 grid gap-2">
            {(Object.entries(mockConnectorSamples) as Array<[ConnectorKey, typeof mockConnectorSamples[ConnectorKey]]>).map(([key, info]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedConnector(key)}
                className={`rounded-xl border p-3 text-left ${selectedConnector === key ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-slate-50 hover:bg-white'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{info.name}</p>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${info.status === 'implemented' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : info.status === 'in_progress' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-700'}`}>
                    {info.status === 'in_progress' ? 'In Progress' : info.status === 'implemented' ? 'Implemented' : 'Planned'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-600">{info.description}</p>
              </button>
            ))}
          </div>

          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mock payload preview</p>
                <p className="text-sm font-semibold text-slate-900">{mockConnectorSamples[selectedConnector].name}</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void copyText(String(mockConnectorSamples[selectedConnector].sample.endpoint ?? ''))} className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">Copy endpoint</button>
                <ConsoleButton intent="secondary" size="sm" onClick={() => runMockConnector(selectedConnector)} disabled={commandBirdsEyeOnly}>
                <FileCheck className="h-3.5 w-3.5" />
                Run mock
              </ConsoleButton>
              </div>
            </div>
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-700">{JSON.stringify(mockConnectorSamples[selectedConnector].sample, null, 2)}</pre>
          </div>

          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recent mock connector runs</p>
            <div className="mt-2 space-y-1 text-xs text-slate-700">
              {mockRuns.length === 0 ? <p>No mock runs yet.</p> : mockRuns.map((run, idx) => <p key={`${run.connector}-${idx}`}>{run.connector.toUpperCase()} · {run.outcome} · {formatDateTime(run.at)}{typeof run.durationMs === 'number' ? ` · ${run.durationMs}ms` : ''}{run.response ? ` · ${String((run.response as any).status ?? '')}` : ''}</p>)}
            </div>
          </div>
        </ConsoleCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <ConsoleCard className="border-slate-200 bg-white">
          <SectionHeader title="Privacy & compliance guardrails (demo config)" subtitle="Show explicit privacy controls to strengthen problem statement mapping (c, d, f)." action={<div className="flex items-center gap-2">{hasUnsavedPolicyChanges ? <StatusPill status="warn" label="Unsaved changes" /> : <StatusPill status="ok" label="Defaults/loaded" />}<ConsoleButton intent="secondary" size="sm" onClick={() => void loadPolicyFromAdapter()} disabled={commandBirdsEyeOnly}>Load</ConsoleButton><ConsoleButton intent="secondary" size="sm" onClick={() => setPolicyForm(defaultPolicyForm)} disabled={commandBirdsEyeOnly}>Reset</ConsoleButton><ConsoleButton size="sm" onClick={() => void savePolicyToAdapter()} disabled={commandBirdsEyeOnly}><Lock className="h-3.5 w-3.5" />{policySaveState === 'saved' ? 'Saved' : policySaveState === 'error' ? 'Retry save' : 'Save policy'}</ConsoleButton></div>} />

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="kyc-form-field text-sm text-slate-700">
              <span className="kyc-form-label">Default retention (days)</span>
              <input type="number" min={30} value={policyForm.retentionDays} onChange={(e) => setPolicyForm((p) => ({ ...p, retentionDays: e.target.value }))} className="mt-1 block kyc-form-input kyc-form-input-sm" />
            </label>

            <label className="kyc-form-field text-sm text-slate-700">
              <span className="kyc-form-label">Sector template</span>
              <select value={policyForm.sectorTemplate} onChange={(e) => setPolicyForm((p) => ({ ...p, sectorTemplate: e.target.value }))} className="mt-1 block kyc-form-input kyc-form-input-sm">
                <option value="banking">Banking (default)</option>
                <option value="insurance">Insurance</option>
                <option value="mutualfund">Mutual Funds</option>
              </select>
            </label>
          </div>

          <div className="mt-3 space-y-2">
            <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span>Mask sensitive identifiers by default</span>
              <input type="checkbox" checked={policyForm.maskByDefault} onChange={(e) => setPolicyForm((p) => ({ ...p, maskByDefault: e.target.checked }))} />
            </label>
            <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span>Require approval for audit evidence export</span>
              <input type="checkbox" checked={policyForm.auditExportApproval} onChange={(e) => setPolicyForm((p) => ({ ...p, auditExportApproval: e.target.checked }))} />
            </label>
          </div>

          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
            <p className="font-semibold text-slate-800">Policy summary (stored via adapter)</p>
            <p className="mt-1">Retention: {policyForm.retentionDays} days · Mask by default: {policyForm.maskByDefault ? 'Yes' : 'No'} · Audit export approval: {policyForm.auditExportApproval ? 'Required' : 'Not required'} · Sector template: {policyForm.sectorTemplate}</p>
          </div>
        </ConsoleCard>

        <ConsoleCard className="border-slate-200 bg-white">
          <SectionHeader title="Sector extensibility templates" subtitle="Demonstrate how tokenised KYC is reusable for insurance and mutual funds (problem statement j)." action={<WalletCards className="h-4 w-4 text-slate-500" />} />
          <div className="mt-3 grid gap-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-blue-600" /><p className="text-sm font-semibold text-slate-900">Insurance onboarding template</p></div>
              <p className="mt-1 text-xs text-slate-600">Purpose: policy issuance / renewal. Suggested fields: name, DOB, address, PAN, CKYC ref, risk category. Status: <span className="font-semibold text-amber-700">In Progress</span>.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-2"><WalletCards className="h-4 w-4 text-emerald-600" /><p className="text-sm font-semibold text-slate-900">Mutual Fund KYC reuse template</p></div>
              <p className="mt-1 text-xs text-slate-600">Purpose: folio creation / FATCA-compliant onboarding. Suggested fields: PAN, address, bank account masked, nominee mapping. Status: <span className="font-semibold text-amber-700">In Progress</span>.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
              <p className="font-semibold text-slate-800">Implementation path</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>Map sector template → consent purpose + field scope presets</li>
                <li>Add FI-side template selector in create consent form</li>
                <li>Attach sector-specific validation rules for minimum field set</li>
              </ul>
            </div>
          </div>
        </ConsoleCard>
      </div>

      <ConsoleCard>
        <SectionHeader title="Integration design notes" subtitle="How these hooks fit an enterprise rollout." action={<Link2 className="h-4 w-4 text-slate-500" />} />
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4 text-sm text-slate-700">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
            <p className="font-semibold text-slate-900">Privacy + consent</p>
            <p>Data sharing is purpose/scope-bound via consent assertions.</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
            <p className="font-semibold text-slate-900">Lifecycle control</p>
            <p>CKYCR updates supersede tokens without sharing raw PII.</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
            <p className="font-semibold text-slate-900">Operational review</p>
            <p>Periodic review supports risk-tier schedules and re-consent.</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
            <p className="font-semibold text-slate-900">Auditability</p>
            <p>Every integration action emits evidence for audit/inspection.</p>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
          <p className="font-semibold text-slate-800">Suggested enhancement (optional)</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>Support multiple CKYCR connectors (sandbox, production) with per-environment config and circuit-breakers.</li>
            <li>Attach run reports (CSV/PDF) to audit evidence, with reviewer approvals.</li>
            <li>Expose webhook retries / DLQ dashboard for integration failures.</li>
          </ul>
        </div>
      </ConsoleCard>
    </div>
  );
}
