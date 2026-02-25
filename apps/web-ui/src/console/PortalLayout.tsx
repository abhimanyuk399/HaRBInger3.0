import { ArrowLeft, ChevronRight, Clock3, LogIn, LogOut, Menu, PanelRightOpen, Search } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { useConsole } from './ConsoleContext';
import { COMMAND_PORTAL_ADMIN_LOGIN_REQUIRED } from './portalFlags';
import { ConsoleButton } from './components/ConsoleButton';
import { FlashStack } from './components/FlashStack';
import { displayWalletIdentity } from './identityConfig';
import { StatusPill } from './components/StatusPill';
import { ThemeToggle } from './components/ThemeToggle';
import { useTheme } from '../theme/ThemeProvider';
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

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [activityTrayOpen, setActivityTrayOpen] = useState(false);
  const [showSessionTimeoutWarning, setShowSessionTimeoutWarning] = useState(false);
  const { theme } = useTheme();
  const isDark = theme === 'dark';
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
    activities,
    failures,
  } = useConsole();

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

  useEffect(() => {
    let warnTimer = window.setTimeout(() => setShowSessionTimeoutWarning(true), 12 * 60 * 1000);
    const reset = () => {
      window.clearTimeout(warnTimer);
      setShowSessionTimeoutWarning(false);
      warnTimer = window.setTimeout(() => setShowSessionTimeoutWarning(true), 12 * 60 * 1000);
    };
    ['click','keydown','mousemove'].forEach((evt) => window.addEventListener(evt, reset));
    return () => {
      window.clearTimeout(warnTimer);
      ['click','keydown','mousemove'].forEach((evt) => window.removeEventListener(evt, reset));
    };
  }, []);

  const activityPreview = useMemo(() => [...activities.slice(0, 5), ...failures.slice(0, 5)].slice(0, 8), [activities, failures]);

  return (
    <div className={isDark ? "min-h-screen bg-[radial-gradient(circle_at_top_left,_#0f172a,_#0b122b_42%,_#1e293b_100%)] text-slate-100" : "min-h-screen bg-[radial-gradient(circle_at_top_left,_#eff6ff,_#f8fafc_42%,_#ffffff_100%)] text-slate-900"}>
      <FlashStack messages={flashMessages} onDismiss={dismissFlashMessage} />
      <div className="mx-auto grid min-h-screen max-w-[1720px] grid-cols-1 gap-4 p-4 xl:grid-cols-[300px_1fr] xl:gap-5 xl:p-5">
        <aside className={cn(
          isDark
            ? 'rounded-3xl border border-slate-800/90 bg-[linear-gradient(180deg,#020617,#0f172a)] p-4 text-slate-100'
            : 'rounded-3xl border border-slate-200 bg-white p-4 text-slate-900',
          'shadow-[0_24px_52px_rgba(15,23,42,0.42)] xl:sticky xl:top-5 xl:h-[calc(100vh-2.5rem)] xl:overflow-y-auto'
        )}>
          <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.07] p-4">
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
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
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
              <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
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

            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300">Session</p>
              <div className="space-y-2">
                <ThemeToggle compact className="w-full justify-center" />
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

        <div className={cn(
          isDark
            ? 'flex min-h-[65vh] flex-col overflow-hidden rounded-3xl border border-slate-700/80 bg-[linear-gradient(160deg,#0a1026,#0e1638_62%,#0b122d)]'
            : 'flex min-h-[65vh] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white',
          'shadow-[0_24px_52px_rgba(15,23,42,0.24)] backdrop-blur xl:h-[calc(100vh-2.5rem)] xl:min-h-0'
        )}>
          <header className={isDark ? "border-b border-slate-700/80 bg-[linear-gradient(120deg,rgba(15,23,42,0.96),rgba(30,41,59,0.95))] px-6 py-4" : "border-b border-slate-200 bg-[linear-gradient(120deg,#ffffff,rgba(248,250,252,0.92))] px-6 py-4"}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[170px] flex-1 sm:min-w-[240px]">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search views, IDs, consent, token..."
                  className={isDark ? "h-9 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-8 text-sm text-slate-200 outline-none focus:border-slate-500" : "h-9 w-full rounded-lg border border-slate-300 bg-white px-8 text-sm text-slate-800 outline-none focus:border-indigo-400"}
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActivityTrayOpen(true)}
                  className={isDark ? "inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-slate-500" : "inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-400"}
                >
                  <PanelRightOpen className="h-4 w-4" /> Activity
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setSessionMenuOpen((v) => !v)}
                    className={isDark ? "rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-right hover:border-slate-500" : "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-right hover:border-slate-400"}
                  >
                    <p className={isDark ? "text-xs font-semibold text-slate-100" : "text-xs font-semibold text-slate-900"}>{displayWalletIdentity(primaryIdentity, 'operator')}</p>
                    <p className={isDark ? "text-[11px] text-slate-400" : "text-[11px] text-slate-500"}>
                      {portalType === 'command' ? 'Command workspace' : portalType === 'wallet' ? 'Wallet workspace' : 'FI workspace'}
                    </p>
                  </button>
                  {sessionMenuOpen ? (
                    <div className={isDark ? "absolute right-0 z-20 mt-2 w-64 rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-2xl" : "absolute right-0 z-20 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-2xl"}>
                      <div className={isDark ? "mb-2 rounded-lg border border-slate-700 bg-slate-950/40 p-2 text-xs text-slate-300" : "mb-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600"}>
                        <div className="font-semibold">Session controls</div>
                        <div className="mt-0.5">Use this menu to switch portals, export UI evidence, and sign out securely.</div>
                      </div>
                      <ThemeToggle compact className="mb-2 w-full justify-center" />
                      <button type="button" onClick={() => { downloadJson(`${portalType}-ui-evidence.json`, { activities, failures, exportedAt: new Date().toISOString(), portalType }); setSessionMenuOpen(false); }} className={isDark ? "mb-2 w-full rounded-lg border border-slate-700 px-3 py-2 text-left text-xs font-semibold text-slate-200 hover:bg-slate-800" : "mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"}>Export UI evidence (JSON)</button>
                      <Link to="/login" onClick={() => setSessionMenuOpen(false)} className={isDark ? "mb-2 block rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800" : "mb-2 block rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"}>Switch portal</Link>
                      {portalType === 'wallet' && authenticated ? <button type="button" onClick={() => void logoutWallet('/wallet/login')} className="w-full rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-left text-xs font-semibold text-rose-800 hover:bg-rose-100">Logout wallet</button> : null}
                      {portalType === 'fi' && fiAuthenticated ? <button type="button" onClick={() => void logoutFi('/fi/login')} className="w-full rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-left text-xs font-semibold text-rose-800 hover:bg-rose-100">Logout FI portal</button> : null}
                      {portalType === 'command' && authenticated ? <button type="button" onClick={() => void logoutWallet('/command/login')} className="w-full rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-left text-xs font-semibold text-rose-800 hover:bg-rose-100">Logout command admin</button> : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className={isDark ? "text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400" : "text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500"}>Portal Workspace</p>
                <h2 className={isDark ? "mt-0.5 text-2xl font-semibold tracking-tight text-white" : "mt-0.5 text-2xl font-semibold tracking-tight text-slate-900"}>{title}</h2>
                <p className={isDark ? "text-sm text-slate-300/95" : "text-sm text-slate-600"}>{subtitle}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <ThemeToggle compact />
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

          <main className={isDark ? "flex-1 overflow-y-auto bg-[linear-gradient(180deg,#0b122b,#111d43)] p-4 sm:p-6" : "flex-1 overflow-y-auto bg-[linear-gradient(180deg,#f8fafc,#eef2ff)] p-4 sm:p-6"}>
            <Outlet />
          </main>
        </div>
      </div>

      {activityTrayOpen ? (
        <div className="fixed inset-0 z-[125] flex justify-end bg-slate-900/40 backdrop-blur-sm" onClick={() => setActivityTrayOpen(false)}>
          <aside className={isDark ? "h-full w-full max-w-xl border-l border-slate-700 bg-slate-950 p-4 text-slate-100" : "h-full w-full max-w-xl border-l border-slate-200 bg-white p-4 text-slate-900"} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Activity & Audit Tray</p>
                <p className="text-sm">Recent UI activity, failures, and support evidence export.</p>
              </div>
              <button type="button" onClick={() => setActivityTrayOpen(false)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold">Close</button>
            </div>
            <div className="mb-3 flex gap-2">
              <button type="button" onClick={() => downloadJson(`${portalType}-activity-tray.json`, { activities, failures, exportedAt: new Date().toISOString() })} className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800">Export JSON</button>
              <Link to="/command/audit" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Open full audit</Link>
            </div>
            <div className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: 'calc(100vh - 10rem)' }}>
              {activityPreview.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">No activity yet. Run a scenario or demo simulation to populate this tray.</div>
              ) : (
                activityPreview.map((entry, idx) => (
                  <div key={idx} className={isDark ? "rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-xs" : "rounded-xl border border-slate-200 bg-slate-50/90 p-3 text-xs"}>
                    <p className="font-semibold">{'event' in (entry as any) ? String((entry as any).event) : String((entry as any).errorCode ?? 'Failure')}</p>
                    <p className="mt-1 opacity-80">{String((entry as any).message ?? (entry as any).service ?? '')}</p>
                    <p className="mt-1 text-[11px] opacity-70">{String((entry as any).at ?? (entry as any).ts ?? new Date().toISOString())}</p>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      ) : null}

      {showSessionTimeoutWarning ? (
        <div className="fixed inset-0 z-[126] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-700"><Clock3 className="h-4 w-4" /></div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Session timeout warning</h3>
                <p className="mt-1 text-sm text-slate-600">Your session appears inactive. Extend your session to continue securely, or sign out.</p>
                <p className="mt-2 text-xs text-slate-500">This is a demo UX safeguard aligned with enterprise session controls.</p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowSessionTimeoutWarning(false)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Extend session</button>
              <button type="button" onClick={() => { setShowSessionTimeoutWarning(false); if (portalType==='fi') void logoutFi('/fi/login'); else void logoutWallet(portalType==='command'?'/command/login':'/wallet/login'); }} className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">Sign out</button>
            </div>
          </div>
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
  { label: 'Operations', path: '/wallet/ops', description: 'Full approval/rejection workspace' },
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
  { label: 'Verifier', path: '/command/verifier', description: 'Verification outcomes and checks' },
  { label: 'Integrations', path: '/command/integrations', description: 'Integration readiness and status' },
  { label: 'Audit', path: '/command/audit', description: 'Audit timeline and request/response evidence' },
];

const commandQuickLinks: PortalQuickLink[] = [
  { label: 'Operations Board', path: '/command/operations', description: 'KPI, health, coverage and onboarding' },
  { label: 'Scenario Suite', path: '/command/scenario', description: 'Run guided end-to-end flows' },
  { label: 'Integrations', path: '/command/integrations', description: 'Check readiness of adapters and services' },
  { label: 'Audit Timeline', path: '/command/audit', description: 'Jump to full request/response trail' },
];

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
      subtitle="Operational visibility across services, consent, verification, and audit."
      navItems={commandNavItems}
      quickLinks={commandQuickLinks}
      portalType="command"
      portalHomePath="/command/login"
      defaultRedirect="/command"
    />
  );
}
