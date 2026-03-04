import { ArrowLeft, ChevronRight, LogIn, LogOut, Menu, Moon, Search, Sun, Bell, Shield } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { useConsole } from './ConsoleContext';
import { COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED } from './portalFlags';
import { ConsoleButton } from './components/ConsoleButton';
import { FlashStack } from './components/FlashStack';
import { displayWalletIdentity } from './identityConfig';
import { StatusPill } from './components/StatusPill';
import { cn } from '../lib/utils';

interface PortalNavItem {
  label: string;
  path: string;
  description: string;
}

interface PortalQuickLink {
  label: string;
  path: string;
  description: string;
}

type PortalType = 'wallet' | 'fi' | 'command';

interface PortalShellProps {
  title: string;
  subtitle: string;
  navItems: PortalNavItem[];
  quickLinks: PortalQuickLink[];
  portalType: PortalType;
  portalHomePath: string;
  defaultRedirect: string;
}

function PortalShell({ title, subtitle, navItems, quickLinks, portalType, portalHomePath, defaultRedirect }: PortalShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => { try { return (localStorage.getItem('bharatkyc:theme') as 'dark' | 'light') || 'light'; } catch { return 'light'; } });
  const [activityTrayOpen, setActivityTrayOpen] = useState(false);
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);
  const [lastActivityAt, setLastActivityAt] = useState<number>(() => Date.now());
  const {
    authenticated,
    activeWalletUsername,
    fiAuthenticated,
    activeFiUsername,
    loginWallet,
    loginFi,
    logoutWallet,
    logoutFi,
    flashMessages,
    dismissFlashMessage,
  } = useConsole();

  useEffect(() => { try { localStorage.setItem('bharatkyc:theme', theme); } catch {} }, [theme]);

  useEffect(() => {
    const onActivity = () => setLastActivityAt(Date.now());
    window.addEventListener('click', onActivity);
    window.addEventListener('keydown', onActivity);
    window.addEventListener('mousemove', onActivity);
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityAt > 1000 * 60 * 12) setShowTimeoutWarning(true);
    }, 15000);
    return () => {
      window.removeEventListener('click', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('mousemove', onActivity);
      window.clearInterval(timer);
    };
  }, [lastActivityAt]);

  const themeClasses = useMemo(() => theme === 'dark' ? ({
    appBg: 'bg-[radial-gradient(circle_at_top_left,_#0f172a,_#0b122b_42%,_#1e293b_100%)] text-slate-100',
    shellBorder: 'border-slate-700/80', shellBg: 'bg-[linear-gradient(160deg,#0a1026,#0e1638_62%,#0b122d)]',
    headerBg: 'bg-[linear-gradient(120deg,rgba(15,23,42,0.96),rgba(30,41,59,0.95))] border-slate-700/80',
    mainBg: 'bg-[linear-gradient(180deg,#0b122b,#111d43)]', searchWrap: 'border-slate-700 bg-slate-900/60 text-slate-200',
    sideBg: 'border-slate-800/90 bg-[linear-gradient(180deg,#020617,#0f172a)] text-slate-100', sideCard: 'border-white/10 bg-white/[0.04]', sideBrand: 'border-white/10 bg-white/[0.07]'
  }) : ({
    appBg: 'bg-[#f3f5fb] text-slate-900', shellBorder: 'border-slate-200', shellBg: 'bg-white',
    headerBg: 'bg-white border-slate-200', mainBg: 'bg-[#f8fafc]', searchWrap: 'border-slate-200 bg-white text-slate-800',
    sideBg: 'border-slate-200 bg-[linear-gradient(180deg,#0b1326,#0f172a)] text-slate-100', sideCard: 'border-white/10 bg-white/[0.03]', sideBrand: 'border-white/10 bg-white/[0.06]'
  }), [theme]);

  const exportActivityJson = () => {
    const payload = { portalType, generatedAt: new Date().toISOString(), sessionSummary, flashMessages };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `bharat-kyc-${portalType}-activity-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
  };

  const sessionSummary =
    portalType === 'fi'
      ? fiAuthenticated
        ? `FI: ${displayWalletIdentity(activeFiUsername, 'authenticated')}`
        : 'FI: signed out'
      : portalType === 'command'
        ? COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED
          ? authenticated
            ? `Admin: ${displayWalletIdentity(activeWalletUsername)}`
            : 'Admin: signed out'
          : 'Mode: read-only'
        : authenticated
          ? `Wallet: ${displayWalletIdentity(activeWalletUsername)}`
          : 'Wallet: signed out';

  const primaryIdentity = portalType === 'fi' ? activeFiUsername : activeWalletUsername;

  return (
    <div data-kyc-theme={theme} className={cn('min-h-screen', themeClasses.appBg, theme === 'dark' ? 'kyc-shell-dark' : 'kyc-shell-light')}>
      <FlashStack messages={flashMessages} onDismiss={dismissFlashMessage} />
      <div className="mx-auto grid min-h-screen max-w-[1720px] grid-cols-1 gap-4 p-4 xl:grid-cols-[300px_1fr] xl:gap-5 xl:p-5">
        <aside className={cn('rounded-3xl border p-4 text-slate-100 shadow-[0_24px_52px_rgba(15,23,42,0.42)] xl:sticky xl:top-5 xl:h-[calc(100vh-2.5rem)] xl:overflow-y-auto', themeClasses.sideBg)}>
          <div className={cn('mb-4 rounded-2xl border p-4', themeClasses.sideBrand)}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300">Bharat KYC T</p>
            <h1 className="mt-1 text-lg font-semibold tracking-tight text-white">{title}</h1>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">{subtitle}</p>
          </div>

          <button
            type="button"
            onClick={() => setMobileNavOpen((value) => !value)}
            className="mb-3 inline-flex w-full items-center justify-between rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/[0.1] xl:hidden"
          >
            <span className="inline-flex items-center gap-2">
              <Menu className="h-4 w-4" />
              Navigation & Session
            </span>
            <span>{mobileNavOpen ? 'Hide' : 'Show'}</span>
          </button>

          <div className={cn('space-y-3', mobileNavOpen ? 'block' : 'hidden xl:block')}>
            <section className={cn('rounded-2xl border p-3', themeClasses.sideCard)}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300">Pages</p>
              <nav className="space-y-1">
                {navItems.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === '/command' || item.path === '/wallet' || item.path === '/fi'}
                    className={({ isActive }) =>
                      cn(
                        'block rounded-xl px-3 py-2.5 transition',
                        isActive
                          ? 'bg-gradient-to-r from-blue-500/30 to-cyan-400/20 text-white ring-1 ring-blue-300/40'
                          : 'text-slate-300 hover:bg-white/10 hover:text-white'
                      )
                    }
                  >
                    <p className="text-sm font-semibold">{item.label}</p>
                    <p className="text-xs opacity-80">{item.description}</p>
                  </NavLink>
                ))}
              </nav>
            </section>

            {quickLinks.length > 0 ? (
              <section className={cn('rounded-2xl border p-3', themeClasses.sideCard)}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300">Quick Panels</p>
                <div className="space-y-1.5">
                  {quickLinks.map((item) => (
                    <Link key={item.path} to={item.path} className="group block rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 hover:bg-white/[0.08]">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-white">{item.label}</p>
                        <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-white" />
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-300">{item.description}</p>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            <section className={cn('rounded-2xl border p-3', themeClasses.sideCard)}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300">Session</p>
              <div className="space-y-2">
                <StatusPill
                  status={
                    portalType === 'fi'
                      ? fiAuthenticated
                        ? 'ok'
                        : 'warn'
                      : portalType === 'command'
                        ? COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED
                          ? authenticated
                            ? 'ok'
                            : 'warn'
                          : 'neutral'
                        : authenticated
                          ? 'ok'
                          : 'warn'
                  }
                  label={sessionSummary}
                />

                {portalType === 'wallet' ? (
                  authenticated ? (
                    <ConsoleButton intent="secondary" size="sm" onClick={() => void logoutWallet('/wallet/login')}>
                      <LogOut className="h-3.5 w-3.5" />
                      Logout
                    </ConsoleButton>
                  ) : (
                    <ConsoleButton intent="secondary" size="sm" onClick={() => void loginWallet(undefined, defaultRedirect)}>
                      <LogIn className="h-3.5 w-3.5" />
                      Sign in
                    </ConsoleButton>
                  )
                ) : null}

                {portalType === 'fi' ? (
                  fiAuthenticated ? (
                    <ConsoleButton intent="secondary" size="sm" onClick={() => void logoutFi('/fi/login')}>
                      <LogOut className="h-3.5 w-3.5" />
                      Logout FI
                    </ConsoleButton>
                  ) : (
                    <ConsoleButton intent="secondary" size="sm" onClick={() => void loginFi(defaultRedirect)}>
                      <LogIn className="h-3.5 w-3.5" />
                      Sign in FI
                    </ConsoleButton>
                  )
                ) : null}

                {portalType === 'command' && COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED ? (
                  authenticated ? (
                    <ConsoleButton intent="secondary" size="sm" onClick={() => void logoutWallet('/command/login')}>
                      <LogOut className="h-3.5 w-3.5" />
                      Logout admin
                    </ConsoleButton>
                  ) : (
                    <ConsoleButton intent="secondary" size="sm" onClick={() => void loginWallet(undefined, defaultRedirect)}>
                      <LogIn className="h-3.5 w-3.5" />
                      Login admin
                    </ConsoleButton>
                  )
                ) : null}
              </div>
            </section>

            <div className="border-t border-white/10 pt-3">
              <div className="mb-2 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <span className="text-xs font-semibold text-slate-200">Theme</span>
                <button type="button" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.08] px-2 py-1 text-[11px] font-semibold text-white">{theme === 'dark' ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}{theme === 'dark' ? 'Light' : 'Dark'}</button>
              </div>

              <Link
                to="/login"
                className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-300 hover:text-white hover:underline"
              >
                Switch Portal
              </Link>
              <br />
              <Link
                to={portalHomePath}
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-300 hover:text-white hover:underline"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Portal Home
              </Link>
            </div>
          </div>
        </aside>

        <div className={cn('flex min-h-[65vh] flex-col overflow-hidden rounded-3xl border shadow-[0_24px_52px_rgba(15,23,42,0.16)] backdrop-blur xl:h-[calc(100vh-2.5rem)] xl:min-h-0', themeClasses.shellBorder, themeClasses.shellBg)}>
          <header className={cn('border-b px-6 py-4', themeClasses.headerBg)}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[170px] flex-1 sm:min-w-[240px]">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search views, IDs, consent, token..."
                  className={cn('h-9 w-full rounded-lg border px-8 text-sm outline-none focus:border-violet-400', themeClasses.searchWrap)}
                />
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-right">
                <p className="text-xs font-semibold text-slate-100">{displayWalletIdentity(primaryIdentity, 'operator')}</p>
                <p className="text-[11px] text-slate-400">
                  {portalType === 'command' ? 'Command workspace' : portalType === 'wallet' ? 'Wallet workspace' : 'FI workspace'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Portal Workspace</p>
                <h2 className="mt-0.5 text-2xl font-semibold tracking-tight text-white">{title}</h2>
                <p className="text-sm text-slate-300/95">{subtitle}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setActivityTrayOpen(true)} className={cn('inline-flex h-9 w-9 items-center justify-center rounded-xl border', theme==='dark' ? 'border-slate-700 bg-slate-900/60 text-slate-200' : 'border-slate-200 bg-white text-slate-700')} title="Activity tray"><Bell className="h-4 w-4" /></button>
                <button type="button" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} className={cn('inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-sm', theme==='dark' ? 'border-slate-700 bg-slate-900/60 text-slate-200' : 'border-slate-200 bg-white text-slate-700')} title="Toggle theme">{theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}{theme === 'dark' ? 'Light' : 'Dark'}</button>
                <StatusPill status="ok" label="Auth: Keycloak" />
                <StatusPill
                  status={
                    portalType === 'fi'
                      ? fiAuthenticated
                        ? 'ok'
                        : 'warn'
                      : portalType === 'command'
                        ? COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED
                          ? authenticated
                            ? 'ok'
                            : 'warn'
                          : 'neutral'
                        : authenticated
                          ? 'ok'
                          : 'warn'
                  }
                  label={sessionSummary}
                />
              </div>
            </div>
          </header>

          <main className={cn('flex-1 overflow-y-auto p-4 sm:p-6', themeClasses.mainBg)}>
            <Outlet />
          </main>
        </div>
      </div>
      {showTimeoutWarning ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-3 flex items-center gap-2 text-slate-900"><Shield className="h-5 w-5 text-violet-600" /><h3 className="text-lg font-semibold">Session timeout warning</h3></div>
            <p className="text-sm text-slate-600">Your session appears idle. Extend session to continue securely, or sign out.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => { setShowTimeoutWarning(false); setLastActivityAt(Date.now()); if (portalType==='fi') { void logoutFi('/fi/login'); } else if (portalType==='wallet') { void logoutWallet('/wallet/login'); } else if (COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED) { void logoutWallet('/command/login'); } }} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Sign out</button>
              <button type="button" onClick={() => { setShowTimeoutWarning(false); setLastActivityAt(Date.now()); }} className="rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold text-white">Extend session</button>
            </div>
          </div>
        </div>
      ) : null}

      {activityTrayOpen ? (
        <div className="fixed inset-0 z-40">
          <button type="button" className="absolute inset-0 bg-slate-950/40" onClick={() => setActivityTrayOpen(false)} aria-label="Close activity tray" />
          <aside className="absolute right-0 top-0 h-full w-full max-w-md border-l border-slate-200 bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Activity & Audit Tray</h3>
              <div className="flex gap-2">
                <button type="button" onClick={exportActivityJson} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700">Export JSON</button>
                <button type="button" onClick={() => setActivityTrayOpen(false)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700">Close</button>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <p><span className="font-semibold">Portal:</span> {portalType}</p>
              <p><span className="font-semibold">Session:</span> {sessionSummary}</p>
              <p><span className="font-semibold">Theme:</span> {theme}</p>
            </div>
            <div className="mt-3 space-y-2 overflow-y-auto pb-10" style={{maxHeight:'calc(100vh - 170px)'}}>
              {(flashMessages?.length ? flashMessages : [{ id: 'no-events', title: 'No recent flash events', body: 'Operational events and confirmations will appear here.' } as any]).map((m: any) => (
                <div key={m.id} className="rounded-xl border border-slate-200 p-3">
                  <p className="text-sm font-semibold text-slate-900">{m.title || m.kind || 'Activity event'}</p>
                  <p className="mt-1 text-xs text-slate-600">{m.body || m.message || 'No additional details available.'}</p>
                </div>
              ))}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

const walletNavItems: PortalNavItem[] = [
  { label: 'Home', path: '/wallet', description: 'Wallet overview and counters' },
  { label: 'Consent Inbox', path: '/wallet/inbox', description: 'Pending requests (self + delegated)' },
  { label: 'Consent History', path: '/wallet/history', description: 'Approved, rejected, expired consents' },
  { label: 'Nominees', path: '/wallet/nominees', description: 'Create/disable nominees' },
  { label: 'Delegations', path: '/wallet/delegations', description: 'Delegations created from nominees' },
  { label: 'Activity Timeline', path: '/wallet/timeline', description: 'Wallet audit and activity trail' },
];

const walletQuickLinks: PortalQuickLink[] = [];

const fiNavItems: PortalNavItem[] = [
  { label: 'Home', path: '/fi', description: 'FI overview and quick actions' },
  { label: 'Create Consent', path: '/fi/create', description: 'Create new consent requests' },
  { label: 'Consent Queue', path: '/fi/queue', description: 'Track queue, open consent, and verify assertion' },
  { label: 'Activity Timeline', path: '/fi/timeline', description: 'FI activity and verification evidence' },
];

const fiQuickLinks: PortalQuickLink[] = [];

const commandNavItems: PortalNavItem[] = [
  { label: 'Home', path: '/command', description: 'Command overview and operational shortcuts' },
  { label: 'Operations', path: '/command/operations', description: 'Cross-service operational visibility' },
  { label: 'Registry', path: '/command/registry', description: 'Token registry status, expiry, and lookup' },
  { label: 'Scenario', path: '/command/scenario', description: 'Workflow orchestration and controls' },
  { label: 'Integrations', path: '/command/integrations', description: 'Integration readiness and status' },
  { label: 'Audit', path: '/command/audit', description: 'Audit timeline and request/response evidence' },
];

const commandQuickLinks: PortalQuickLink[] = [];

export function WalletPortalLayout() {
  return (
    <PortalShell
      title="Bharat KYC T - Wallet Portal"
      subtitle="Customer consent review, field sharing, and nominee delegation."
      navItems={walletNavItems}
      quickLinks={walletQuickLinks}
      portalType="wallet"
      portalHomePath="/wallet/login"
      defaultRedirect="/wallet"
    />
  );
}

export function FiPortalLayout() {
  return (
    <PortalShell
      title="Bharat KYC T - FI Portal"
      subtitle="FI consent request creation, verification, and usage tracking."
      navItems={fiNavItems}
      quickLinks={fiQuickLinks}
      portalType="fi"
      portalHomePath="/fi/login"
      defaultRedirect="/fi"
    />
  );
}

export function CommandPortalLayout() {
  return (
    <PortalShell
      title="Bharat KYC T - Command Centre"
      subtitle="Bird’s-eye operational visibility only. Execute customer/FI actions from Wallet and FI portals."
      navItems={commandNavItems}
      quickLinks={commandQuickLinks}
      portalType="command"
      portalHomePath="/command/login"
      defaultRedirect="/command"
    />
  );
}
