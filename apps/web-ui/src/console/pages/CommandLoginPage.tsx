import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useConsole } from '../ConsoleContext';
import { COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED } from '../portalFlags';
import { ConsoleButton } from '../components/ConsoleButton';
import { displayWalletIdentity } from '../identityConfig';
import { StatusPill } from '../components/StatusPill';
import { AuthPageShell } from '../components/AuthPageShell';

export default function CommandLoginPage() {
  const [searchParams] = useSearchParams();
  const { authenticated, activeWalletUsername, adminRoleGranted, loginWallet, loginWalletWithPassword, logoutWallet, setStatusMessage } =
    useConsole();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const deniedRole = searchParams.get('denied');
  const adminActive = COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED ? authenticated && adminRoleGranted : true;

  useEffect(() => {
    if (!deniedRole) {
      return;
    }
    setStatusMessage(`Access denied for '${deniedRole}' role on Command Centre.`);
  }, [deniedRole, setStatusMessage]);

  const handlePasswordLogin = useCallback(async () => {
    if (!username.trim() || !password) {
      const message = 'Enter username and password.';
      setFormError(message);
      setStatusMessage(message);
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await loginWalletWithPassword(username.trim(), password);
      setPassword('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to sign in.';
      setFormError(message);
      setStatusMessage(message);
    } finally {
      setSubmitting(false);
    }
  }, [loginWalletWithPassword, password, setStatusMessage, username]);

  const handleRedirectLogin = useCallback(async () => {
    setFormError(null);
    try {
      setRedirecting(true);
      await loginWallet(username.trim() || undefined, '/command');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to redirect to Keycloak login.';
      setFormError(message);
      setStatusMessage(message);
      setRedirecting(false);
    }
  }, [loginWallet, setStatusMessage, username]);

  return (
    <AuthPageShell
      portalLabel="Command Centre"
      title="Bharat KYC T - Command Access"
      subtitle="Operational command for service health, audit timeline, onboarding, and scenario orchestration."
      badgeTone="slate"
      visualVariant="command"
      portalLinks={[
        { path: '/command/login', label: 'Command login' },
        { path: '/wallet/login', label: 'Wallet login' },
        { path: '/fi/login', label: 'FI login' },
      ]}
      highlights={[]}
    >
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-950">Welcome back</h2>
          <p className="mt-1 text-sm text-slate-600">Command Centre can run in read-only mode or require admin authentication.</p>
        </div>

        {COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED ? (
          <div className="grid gap-3">
            <label className="kyc-form-field">
              <span className="kyc-form-label">Username</span>
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="kyc-form-input"
                placeholder="admin"
              />
              <p className="kyc-form-hint">Hint: command admin user is `admin`</p>
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
                      void handlePasswordLogin();
                    }
                  }}
                  className="kyc-form-input pr-16"
                  placeholder="admin"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className="kyc-form-hint">Hint: demo command admin password is `admin` (or your configured Keycloak command admin password)</p>
            </label>
          </div>
        ) : null}

        <StatusPill
          status={adminActive ? 'ok' : 'warn'}
          label={
            COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED
              ? adminActive
                ? `Admin session: ${displayWalletIdentity(activeWalletUsername, 'admin')}`
                : authenticated
                  ? `Signed in as ${displayWalletIdentity(activeWalletUsername, 'user')} (admin role missing)`
                  : 'Admin session required'
              : 'Read-only mode'
          }
        />

        {COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED && authenticated && !adminRoleGranted ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Your account does not have Command Centre admin access. Request `admin` role.
          </p>
        ) : null}
        {formError ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">{formError}</p> : null}
        {deniedRole ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Access denied for `{deniedRole}` role on Command Centre. Sign in with an admin-enabled account.
          </p>
        ) : null}

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <p className="font-semibold text-slate-900">Mode</p>
          <p className="mt-1">
            {COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED
              ? 'Admin login is required for privileged operations.'
              : 'Read-only mode is active. You can access dashboards without login.'}
          </p>
          {COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED ? (
            <>
              <p className="mt-2 font-semibold text-slate-900">Role requirement</p>
              <p className="mt-1">Use an account mapped to the `admin` realm role.</p>
            </>
          ) : null}
        </div>

        {COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED ? (
          <div className="flex flex-wrap items-center gap-2">
            {authenticated && adminRoleGranted ? (
              <ConsoleButton type="button" className="min-w-[180px]" intent="secondary" onClick={() => void logoutWallet('/command/login')}>
                Logout admin
              </ConsoleButton>
            ) : (
              <>
                <ConsoleButton
                  type="button"
                  className="w-full min-w-[220px] border-indigo-600 bg-indigo-600 hover:border-indigo-500 hover:bg-indigo-500 sm:w-auto"
                  disabled={submitting}
                  onClick={() => void handlePasswordLogin()}
                >
                  {submitting ? 'Signing in...' : 'Login admin'}
                </ConsoleButton>
                <ConsoleButton
                  type="button"
                  className="w-full min-w-[220px] sm:w-auto"
                  intent="secondary"
                  disabled={redirecting}
                  onClick={() => void handleRedirectLogin()}
                >
                  {redirecting ? 'Redirecting...' : 'Use Keycloak login page'}
                </ConsoleButton>
              </>
            )}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Link
            to="/command"
            className="inline-flex min-w-[180px] items-center justify-center rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            Open Command Centre
          </Link>
          <Link
            to="/wallet/login"
            className="inline-flex min-w-[180px] items-center justify-center rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            Open Wallet Portal
          </Link>
          <Link
            to="/fi/login"
            className="inline-flex min-w-[180px] items-center justify-center rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            Open FI Portal
          </Link>
        </div>
      </div>
    </AuthPageShell>
  );
}
