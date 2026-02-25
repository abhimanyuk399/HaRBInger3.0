import { useState } from 'react';
import { Copy, LogIn } from 'lucide-react';
import { ConsoleButton } from './ConsoleButton';
import { WALLET_NOMINEE_USERNAME } from '../identityConfig';

interface AuthGateModalProps {
  open: boolean;
  title: string;
  message: string;
  realm: string;
  keycloakUrl: string;
  loginHint: string;
  onOpenLogin: () => void;
  onCopy: (label: string, value: string) => void;
  onCancel?: () => void;
}

function CredentialRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: (label: string, value: string) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <ConsoleButton intent="ghost" size="sm" className="h-7 px-2" onClick={() => onCopy(label, value)}>
          <Copy className="h-3.5 w-3.5" />
          Copy
        </ConsoleButton>
      </div>
      <p className="mt-1 break-all text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}

export default function AuthGateModal({
  open,
  title,
  message,
  realm,
  keycloakUrl,
  loginHint,
  onOpenLogin,
  onCopy,
  onCancel,
}: AuthGateModalProps) {
  if (!open) {
    return null;
  }

  const [showSwitchHelp, setShowSwitchHelp] = useState(false);
  const isNomineeLogin = loginHint === WALLET_NOMINEE_USERNAME;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 px-4 py-6">
      <section className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.35)]">
        <h2 className="text-2xl font-semibold text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-700">{message}</p>

        <div className="mt-5">
          <ConsoleButton className="w-full" onClick={onOpenLogin}>
            <LogIn className="h-4 w-4" />
            Open Keycloak Login
          </ConsoleButton>
        </div>

        {isNomineeLogin ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowSwitchHelp((previous) => !previous)}
              className="text-sm font-medium text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline"
            >
              How to switch users
            </button>
            {showSwitchHelp ? (
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                <p>1) Open Keycloak</p>
                <p>2) Logout</p>
                <p>3) Login as {WALLET_NOMINEE_USERNAME}</p>
                <p>4) Return to console tab</p>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 space-y-2.5">
          <CredentialRow label="Keycloak URL" value={keycloakUrl} onCopy={onCopy} />
          <CredentialRow label="Realm" value={realm} onCopy={onCopy} />
          <CredentialRow label="Login Hint" value={loginHint} onCopy={onCopy} />
        </div>

        <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          This workflow pauses until wallet login is complete. It resumes automatically after authentication.
        </p>

        {onCancel ? (
          <div className="mt-4">
            <ConsoleButton intent="secondary" className="w-full" onClick={onCancel}>
              Cancel
            </ConsoleButton>
          </div>
        ) : null}
      </section>
    </div>
  );
}
