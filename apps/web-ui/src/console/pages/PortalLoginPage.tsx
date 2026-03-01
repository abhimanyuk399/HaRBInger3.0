import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useConsole } from '../ConsoleContext';
import { ConsoleButton } from '../components/ConsoleButton';
import { StatusPill } from '../components/StatusPill';
import { COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED } from '../portalFlags';
import { displayWalletIdentity } from '../identityConfig';
import { AuthPageShell } from '../components/AuthPageShell';

export default function PortalLoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    authenticated,
    fiAuthenticated,
    activeWalletUsername,
    activeFiUsername,
    walletRoleGranted,
    fiRoleGranted,
    adminRoleGranted,
    defaultPortalPath,
    loginWallet,
    loginWalletWithPassword,
    loginFiWithPassword,
    logoutWallet,
    logoutFi,
    setStatusMessage,
  } = useConsole();
  const [submitting, setSubmitting] = useState(false);
  const [loginPortal, setLoginPortal] = useState<'wallet' | 'fi'>('wallet');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const deniedRole = searchParams.get('denied');
  const nextPathParam = searchParams.get('next');
  const safeNextPath = nextPathParam && nextPathParam.startsWith('/') ? nextPathParam : null;

  const canAccessPath = useCallback(
    (path: string | null) => {
      if (!path) {
        return false;
      }
      if (path.startsWith('/wallet')) {
        return walletRoleGranted;
      }
      if (path.startsWith('/fi')) {
        return fiRoleGranted;
      }
      if (path.startsWith('/command')) {
        return COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED ? adminRoleGranted : true;
      }
      return true;
    },
    [adminRoleGranted, fiRoleGranted, walletRoleGranted]
  );

  useEffect(() => {
    if (deniedRole) {
      return;
    }
    if (!authenticated && !fiAuthenticated) {
      return;
    }
    const resolvedPath =
      safeNextPath && canAccessPath(safeNextPath)
        ? safeNextPath
        : canAccessPath(defaultPortalPath)
          ? defaultPortalPath
          : walletRoleGranted
            ? '/wallet'
            : fiRoleGranted
              ? '/fi/queue'
              : '/command';
    navigate(resolvedPath, { replace: true });
  }, [authenticated, canAccessPath, defaultPortalPath, deniedRole, fiAuthenticated, fiRoleGranted, navigate, safeNextPath, walletRoleGranted]);

  useEffect(() => {
    if (!deniedRole) {
      return;
    }
    setStatusMessage(`Access denied for '${deniedRole}' role.`);
  }, [deniedRole, setStatusMessage]);

  const handleSignIn = async () => {
    setSubmitting(true);
    setFormError(null);
    if (!username.trim() || !password) {
      const message = 'Enter username and password.';
      setFormError(message);
      setStatusMessage(message);
      setSubmitting(false);
      return;
    }
    try {
      if (loginPortal === 'wallet') {
        await loginWalletWithPassword(username.trim(), password);
      } else {
        await loginFiWithPassword(username.trim(), password);
      }
      setPassword('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to continue. Please retry.';
      setFormError(message);
      setStatusMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthPageShell
      portalLabel="Unified Access"
      title="Bharat KYC T - Secure Access Gateway"
      subtitle="Authenticate once and enter the portal that matches your assigned role claims."
      badgeTone="slate"
      visualVariant="unified"
      highlights={[]}
    >
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-950">Welcome back</h2>
          <p className="mt-1 text-sm text-slate-600">Authenticate once with Keycloak. Portal access is resolved from role claims.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusPill
            status={authenticated || fiAuthenticated ? 'ok' : 'warn'}
            label={
              authenticated
                ? `Signed in as ${displayWalletIdentity(activeWalletUsername, 'user')}`
                : fiAuthenticated
                  ? `Signed in as ${displayWalletIdentity(activeFiUsername, 'fi user')}`
                  : 'Signed out'
            }
          />
          {authenticated || fiAuthenticated ? (
            <ConsoleButton
              type="button"
              className="min-w-[140px]"
              intent="secondary"
              size="sm"
              onClick={() => void (authenticated ? logoutWallet('/login') : logoutFi('/login'))}
            >
              Sign out
            </ConsoleButton>
          ) : null}
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Wallet</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{walletRoleGranted ? 'Granted' : 'Not granted'}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">FI</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{fiRoleGranted ? 'Granted' : 'Not granted'}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Command</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED ? (adminRoleGranted ? 'Granted' : 'Not granted') : 'Read-only'}
            </p>
          </div>
        </div>

        {deniedRole ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Access denied for `{deniedRole}` role. Sign in with an account that has the required realm role.
          </p>
        ) : null}

        {formError ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">{formError}</p> : null}

        {!authenticated && !fiAuthenticated ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="kyc-form-field">
                <span className="kyc-form-label">Portal</span>
                <select
                  value={loginPortal}
                  onChange={(event) => setLoginPortal(event.target.value === 'fi' ? 'fi' : 'wallet')}
                  className="kyc-form-select"
                >
                  <option value="wallet">Wallet / Command</option>
                  <option value="fi">FI</option>
                </select>
              </label>
              <label className="kyc-form-field">
                <span className="kyc-form-label">Username</span>
                <input
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="kyc-form-input"
                  placeholder={loginPortal === 'fi' ? 'fi-analyst-1' : 'wallet-owner-1'}
                />
                <p className="kyc-form-hint">
                  Hint: {loginPortal === 'fi' ? '`fi-analyst-1` or `fi-analyst-2`' : '`wallet-owner-1` or `wallet-nominee`'}
                </p>
              </label>
            </div>
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
                  placeholder={loginPortal === 'fi' ? 'fi-analyst-1-pass' : 'wallet-owner-1-pass'}
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
          </>
        ) : null}

        {!authenticated && !fiAuthenticated ? (
          <div className="flex flex-wrap gap-2">
            <ConsoleButton
              type="button"
              className="w-full min-w-[220px] border-indigo-600 bg-indigo-600 hover:border-indigo-500 hover:bg-indigo-500 sm:w-auto"
              disabled={submitting}
              onClick={() => void handleSignIn()}
            >
              {submitting ? 'Signing in...' : 'Sign in'}
            </ConsoleButton>
            <ConsoleButton
              type="button"
              className="w-full min-w-[220px] sm:w-auto"
              intent="secondary"
              onClick={() => {
                const postLoginPath = safeNextPath ? `/login?next=${encodeURIComponent(safeNextPath)}` : '/login';
                void loginWallet(username.trim() || undefined, postLoginPath);
              }}
            >
              Use Keycloak login page
            </ConsoleButton>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Link
            to="/wallet/login"
            className="inline-flex min-w-[180px] items-center justify-center rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            Wallet login entry
          </Link>
          <Link
            to="/fi/login"
            className="inline-flex min-w-[180px] items-center justify-center rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            FI login entry
          </Link>
          <Link
            to="/command/login"
            className="inline-flex min-w-[180px] items-center justify-center rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            Command login entry
          </Link>
        </div>
      </div>
    </AuthPageShell>
  );
}
