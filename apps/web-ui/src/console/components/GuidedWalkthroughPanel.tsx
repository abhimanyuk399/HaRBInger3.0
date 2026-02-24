import { X, PlayCircle, RefreshCcw, Circle, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { GuidedWalkthroughState } from '../types';
import { ConsoleButton } from './ConsoleButton';
import { WALLET_NOMINEE_USERNAME } from '../identityConfig';

interface WalkthroughStep {
  id: string;
  title: string;
  whereToClick: string;
  expectedOutcome: string;
  proof: string;
}

const walkthroughSteps: WalkthroughStep[] = [
  {
    id: 'issue',
    title: 'Issue token',
    whereToClick: 'Auto-run by Full Workflow Suite',
    expectedOutcome: 'Registry has active token with tokenId/version.',
    proof: 'Live Evidence > Registry status ACTIVE.',
  },
  {
    id: 'request',
    title: 'FI request consent',
    whereToClick: 'Auto-run by Full Workflow Suite',
    expectedOutcome: 'New consentId created with purpose/scope.',
    proof: 'Consent card and request/response log update.',
  },
  {
    id: 'approve',
    title: 'Wallet owner approves consent',
    whereToClick: 'Auto-run by Full Workflow Suite; pause modal appears if login is missing',
    expectedOutcome: 'Consent is APPROVED and assertion JWT is minted.',
    proof: 'Consent status card becomes APPROVED and assertion viewer updates.',
  },
  {
    id: 'verify-success',
    title: 'FI verify success',
    whereToClick: 'Auto-run by Full Workflow Suite',
    expectedOutcome: 'Verification succeeds against consent assertion and registry ACTIVE token.',
    proof: 'Activity shows ASSERTION_VERIFIED_SUCCESS.',
  },
  {
    id: 'revoke',
    title: 'Revoke token',
    whereToClick: 'Auto-run by Full Workflow Suite',
    expectedOutcome: 'Registry token state changes to REVOKED.',
    proof: 'Registry card shows REVOKED.',
  },
  {
    id: 'verify-fail',
    title: 'FI verify expected fail TOKEN_NOT_ACTIVE',
    whereToClick: 'Auto-run by Full Workflow Suite',
    expectedOutcome: 'Expected failure after revoke is TOKEN_NOT_ACTIVE.',
    proof: 'Failure cards show TOKEN_NOT_ACTIVE.',
  },
  {
    id: 'ckyc',
    title: 'Run CKYCR supersede simulation',
    whereToClick: 'Auto-run by Full Workflow Suite',
    expectedOutcome: 'Old token superseded, new token active.',
    proof: 'Registry version/status update and CKYCR activity event.',
  },
  {
    id: 'review',
    title: 'Run periodic review scheduler',
    whereToClick: 'Auto-run by Full Workflow Suite',
    expectedOutcome: 'Due users and action summary appear.',
    proof: 'Review run card shows totals and actions taken.',
  },
  {
    id: 'delegation-owner',
    title: 'Add nominee delegation + pending consent',
    whereToClick: 'Auto-run by Full Workflow Suite (wallet owner login required)',
    expectedOutcome: 'Delegation created and pending consent prepared for nominee approval.',
    proof: 'Wallet events include DELEGATION_CREATED + CONSENT_REQUESTED.',
  },
  {
    id: 'nominee-login',
    title: `Pause: logout/login as ${WALLET_NOMINEE_USERNAME}`,
    whereToClick: `Pause modal -> Logout -> Login ${WALLET_NOMINEE_USERNAME} -> Resume`,
    expectedOutcome: 'Suite pauses until nominee account is active.',
    proof: `Top bar wallet identity switches to ${WALLET_NOMINEE_USERNAME}.`,
  },
  {
    id: 'delegation-approve',
    title: 'Approve as nominee',
    whereToClick: 'Auto-run after nominee login + Resume',
    expectedOutcome: 'Nominee approval succeeds and audit actor is delegate.',
    proof: 'Activity feed shows CONSENT_APPROVED_BY_DELEGATE.',
  },
];

interface GuidedWalkthroughPanelProps {
  open: boolean;
  guided: GuidedWalkthroughState;
  busy: boolean;
  onClose: () => void;
  onStart: () => Promise<void>;
  onResume: () => Promise<void>;
}

export function GuidedWalkthroughPanel({ open, guided, busy, onClose, onStart, onResume }: GuidedWalkthroughPanelProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-slate-950/30 p-4">
      <section className="h-[calc(100vh-2rem)] w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_40px_rgba(15,23,42,0.25)]">
        <header className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Run Full Workflow Suite</h3>
            <p className="text-sm text-slate-600">Follow these steps and compare expected proof.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-50"
            aria-label="Close walkthrough panel"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <ConsoleButton onClick={() => void onStart()} disabled={busy || guided.running}>
            <PlayCircle className="h-4 w-4" />
            Run Suite
          </ConsoleButton>
          <ConsoleButton
            intent="secondary"
            onClick={() => void onResume()}
            disabled={busy || guided.running || !guided.blockedReason}
          >
            <RefreshCcw className="h-4 w-4" />
            Resume
          </ConsoleButton>
          {guided.blockedReason ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              {guided.blockedReason}
            </span>
          ) : null}
        </div>

        <div className="h-[calc(100%-130px)] space-y-2 overflow-auto px-4 py-3">
          {walkthroughSteps.map((step, index) => {
            const done = index < guided.stepIndex;
            const active = index === guided.stepIndex && (guided.running || guided.blockedReason !== null);
            return (
              <article key={step.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start gap-2">
                  {done ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                  ) : (
                    <Circle className={`mt-0.5 h-4 w-4 ${active ? 'text-amber-600' : 'text-slate-400'}`} />
                  )}
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {index + 1}. {step.title}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      <span className="font-semibold text-slate-700">Where to click:</span> {step.whereToClick}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      <span className="font-semibold text-slate-700">Expected outcome:</span> {step.expectedOutcome}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      <span className="font-semibold text-slate-700">Proof:</span> {step.proof}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
