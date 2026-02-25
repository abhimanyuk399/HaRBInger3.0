import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ConsoleButton } from '../components/ConsoleButton';
import { StatusPill } from '../components/StatusPill';
import { useConsole } from '../ConsoleContext';
import { displayWalletIdentity } from '../identityConfig';
import { AuthPageShell } from '../components/AuthPageShell';

export default function FiLoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { fiAuthenticated, activeFiUsername, fiRoleGranted, loginFi, loginFiWithPassword, logoutFi, setStatusMessage } = useConsole();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const deniedRole = searchParams.get('denied');
  const nextPathParam = searchParams.get('next');
  const nextPath = nextPathParam && nextPathParam.startsWith('/') ? nextPathParam : '/fi';

  useEffect(() => {
    if (!fiAuthenticated || !fiRoleGranted) {
      return;
    }
    navigate(nextPath, { replace: true });
  }, [fiAuthenticated, fiRoleGranted, navigate, nextPath]);

  useEffect(() => {
    if (!deniedRole) {
      return;
    }
    setStatusMessage(`Access denied for '${deniedRole}' role on FI portal.`);
  }, [deniedRole, setStatusMessage]);

  const handleSignIn = useCallback(async () => {
    setFormError(null);
    if (!username.trim() || !password) {
      const message = 'Enter username and password.';
      setFormError(message);
      setStatusMessage(message);
      return;
    }

    try {
      setSubmitting(true);
      await loginFiWithPassword(username.trim(), password);
      setPassword('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to sign in.';
      setFormError(message);
      setStatusMessage(message);
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }, [loginFiWithPassword, password, setStatusMessage, username]);

  const handleKeycloakRedirect = useCallback(async () => {
    setFormError(null);
    try {
      setRedirecting(true);
      await loginFi(nextPath, username.trim() || undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to redirect to Keycloak login.';
      setFormError(message);
      setStatusMessage(message);
      setRedirecting(false);
    }
  }, [loginFi, nextPath, setStatusMessage, username]);

  return (
    <AuthPageShell
      portalLabel="FI Portal"
      title="Bharat KYC T - FI Operations Access"
      subtitle="Create consent requests, monitor lifecycle status, and verify assertions with FI role-based controls."
      badgeTone="amber"
      visualVariant="fi"
      portalLinks={[
        { path: '/fi/login', label: 'FI login' },
        { path: '/wallet/login', label: 'Wallet login' },
        { path: '/command/login', label: 'Command login' },
      ]}
      highlights={[]}
    >
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-950">Welcome back</h2>
          <p className="mt-1 text-sm text-slate-600">Sign in with FI credentials to access FI dashboard and consent workflows.</p>
        </div>

        <div className="grid gap-3">
          <label className="kyc-form-field">
            <span className="kyc-form-label">Username</span>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="kyc-form-input"
              placeholder="fi-analyst-1"
            />
            <p className="kyc-form-hint">Hint: `fi-analyst-1` or `fi-analyst-2`</p>
          </label>
          <label className="kyc-form-field">
            <span className="kyc-form-label">Password</span>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleSignIn();
                  }
                }}
                className="kyc-form-input pr-16"
                placeholder="fi-analyst-1-pass"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="kyc-form-hint">Hint: demo password format `&lt;username&gt;-pass`</p>
          </label>
        </div>

        <StatusPill
          status={fiAuthenticated ? (fiRoleGranted ? 'ok' : 'warn') : 'warn'}
          label={
            fiAuthenticated
              ? fiRoleGranted
                ? `Signed in as ${displayWalletIdentity(activeFiUsername, 'fi user')}`
                : `Signed in as ${displayWalletIdentity(activeFiUsername, 'user')} (fi role missing)`
              : 'Signed out'
          }
        />

        {fiAuthenticated && !fiRoleGranted ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Your account does not have FI access. Request `fi_user` role.
          </p>
        ) : null}
        {deniedRole ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Access denied for `{deniedRole}` role on FI portal. Sign in with an FI-enabled account.
          </p>
        ) : null}

        {formError ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">{formError}</p> : null}

        <div className="flex flex-wrap gap-2">
          <ConsoleButton
            type="button"
            className="w-full min-w-[220px] border-indigo-600 bg-indigo-600 hover:border-indigo-500 hover:bg-indigo-500 sm:w-auto"
            disabled={submitting}
            onClick={() => void handleSignIn()}
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </ConsoleButton>
          {!fiAuthenticated ? (
            <ConsoleButton
              type="button"
              className="w-full min-w-[220px] sm:w-auto"
              intent="secondary"
              disabled={redirecting}
              onClick={() => void handleKeycloakRedirect()}
            >
              {redirecting ? 'Redirecting...' : 'Use Keycloak login page'}
            </ConsoleButton>
          ) : null}
          {fiAuthenticated ? (
            <ConsoleButton type="button" className="min-w-[180px]" intent="secondary" onClick={() => void logoutFi('/fi/login')}>
              Sign out
            </ConsoleButton>
          ) : null}
          {fiAuthenticated && fiRoleGranted ? (
            <Link
              to={nextPath}
              className="inline-flex min-w-[180px] items-center justify-center rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              Continue to FI Portal
            </Link>
          ) : null}
        </div>

        <p className="text-xs text-slate-600">
          FI Portal access requires the `fi_user` role. You can sign in directly here or use Keycloak hosted login.
        </p>
      </div>
    </AuthPageShell>
  );
}
