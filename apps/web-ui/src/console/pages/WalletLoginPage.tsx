import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useConsole } from '../ConsoleContext';
import { ConsoleButton } from '../components/ConsoleButton';
import { displayWalletIdentity } from '../identityConfig';
import { StatusPill } from '../components/StatusPill';
import { AuthPageShell } from '../components/AuthPageShell';

export default function WalletLoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { authenticated, activeWalletUsername, loginWallet, loginWalletWithPassword, logoutWallet, walletRoleGranted, setStatusMessage } = useConsole();
  const [autoRedirecting, setAutoRedirecting] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const deniedRole = searchParams.get('denied');
  const nextPathParam = searchParams.get('next');
  const nextPath = nextPathParam && nextPathParam.startsWith('/') ? nextPathParam : '/wallet';

  useEffect(() => {
    if (!authenticated || !walletRoleGranted) {
      return;
    }
    navigate(nextPath, { replace: true });
  }, [authenticated, navigate, nextPath, walletRoleGranted]);

  useEffect(() => {
    if (!deniedRole) {
      return;
    }
    setStatusMessage(`Access denied for '${deniedRole}' role on Wallet portal.`);
  }, [deniedRole, setStatusMessage]);

  const handleSignIn = useCallback(async () => {
    try {
      setAutoRedirecting(true);
      await loginWallet(undefined, nextPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to redirect to Keycloak login.';
      setFormError(message);
      setStatusMessage(message);
      setAutoRedirecting(false);
    }
  }, [loginWallet, nextPath, setStatusMessage]);

  const handlePasswordLogin = useCallback(async () => {
    if (!username.trim() || !password) {
      const message = 'Enter username and password.';
      setFormError(message);
      setStatusMessage(message);
      return;
    }
    setFormError(null);
    setSigningIn(true);
    try {
      await loginWalletWithPassword(username.trim(), password);
      setPassword('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to sign in.';
      setFormError(message);
      setStatusMessage(message);
    } finally {
      setSigningIn(false);
    }
  }, [loginWalletWithPassword, password, setStatusMessage, username]);

  return (
    <AuthPageShell
      portalLabel="Wallet Portal"
      title="Bharat KYC T - Wallet Access"
      subtitle="Review requests, approve or reject consent scope, and manage nominee delegation under wallet role controls."
      badgeTone="emerald"
      visualVariant="wallet"
      portalLinks={[
        { path: '/wallet/login', label: 'Wallet login' },
        { path: '/fi/login', label: 'FI login' },
        { path: '/command/login', label: 'Command login' },
      ]}
      highlights={[]}
    >
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-950">Welcome back</h2>
          <p className="mt-1 text-sm text-slate-600">Authenticate with wallet credentials.</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <p className="font-semibold text-slate-900">Access policy</p>
          <p className="mt-1">Wallet Portal accepts users with `wallet_user` or `wallet_nominee` roles.</p>
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
              placeholder="wallet-owner-1"
            />
            <p className="kyc-form-hint">Hint: `wallet-owner-1` or `wallet-nominee`</p>
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
                placeholder="wallet-owner-1-pass"
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

        {formError ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">{formError}</p> : null}

        <div className="flex flex-wrap items-center gap-2">
          <StatusPill
            status={authenticated ? (walletRoleGranted ? 'ok' : 'warn') : 'warn'}
            label={
              authenticated
                ? walletRoleGranted
                  ? `Signed in as ${displayWalletIdentity(activeWalletUsername, 'wallet user')}`
                  : `Signed in as ${displayWalletIdentity(activeWalletUsername, 'user')} (wallet role missing)`
                : 'Signed out'
            }
          />
          {authenticated && !walletRoleGranted ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Your account does not have wallet access. Contact admin for `wallet_user` or `wallet_nominee` role.
            </p>
          ) : null}
          {deniedRole ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Access denied for `{deniedRole}` role on Wallet portal. Sign in with a wallet-enabled account.
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {authenticated ? (
            <ConsoleButton type="button" className="min-w-[180px]" intent="secondary" onClick={() => void logoutWallet('/wallet/login')}>
              Logout
            </ConsoleButton>
          ) : (
            <>
              <ConsoleButton
                type="button"
                className="w-full min-w-[220px] border-indigo-600 bg-indigo-600 hover:border-indigo-500 hover:bg-indigo-500 sm:w-auto"
                disabled={signingIn}
                onClick={() => void handlePasswordLogin()}
              >
                {signingIn ? 'Signing in...' : 'Sign in'}
              </ConsoleButton>
              <ConsoleButton
                type="button"
                className="w-full min-w-[220px] sm:w-auto"
                intent="secondary"
                disabled={autoRedirecting}
                onClick={() => void handleSignIn()}
              >
                {autoRedirecting ? 'Redirecting...' : 'Use Keycloak login page'}
              </ConsoleButton>
            </>
          )}
          {authenticated && walletRoleGranted ? (
            <Link
              to={nextPath}
              className="inline-flex min-w-[180px] items-center justify-center rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              Continue to Wallet Portal
            </Link>
          ) : null}
        </div>

      </div>
    </AuthPageShell>
  );
}
