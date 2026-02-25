import { ArrowLeft, ChevronRight, LogIn, LogOut, Menu, Search } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useState } from 'react';
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#0f172a,_#0b122b_42%,_#1e293b_100%)] text-slate-100">
      <FlashStack messages={flashMessages} onDismiss={dismissFlashMessage} />
      <div className="mx-auto grid min-h-screen max-w-[1720px] grid-cols-1 gap-4 p-4 xl:grid-cols-[300px_1fr] xl:gap-5 xl:p-5">
        <aside className="rounded-3xl border border-slate-800/90 bg-[linear-gradient(180deg,#020617,#0f172a)] p-4 text-slate-100 shadow-[0_24px_52px_rgba(15,23,42,0.42)] xl:sticky xl:top-5 xl:h-[calc(100vh-2.5rem)] xl:overflow-y-auto">
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

        <div className="flex min-h-[65vh] flex-col overflow-hidden rounded-3xl border border-slate-700/80 bg-[linear-gradient(160deg,#0a1026,#0e1638_62%,#0b122d)] shadow-[0_24px_52px_rgba(15,23,42,0.24)] backdrop-blur xl:h-[calc(100vh-2.5rem)] xl:min-h-0">
          <header className="border-b border-slate-700/80 bg-[linear-gradient(120deg,rgba(15,23,42,0.96),rgba(30,41,59,0.95))] px-6 py-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[170px] flex-1 sm:min-w-[240px]">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search views, IDs, consent, token..."
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-8 text-sm text-slate-200 outline-none focus:border-slate-500"
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

          <main className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,#0b122b,#111d43)] p-4 sm:p-6">
            <Outlet />
          </main>
        </div>
      </div>
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
