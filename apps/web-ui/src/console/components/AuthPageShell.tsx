import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useConsole } from '../ConsoleContext';
import { FlashStack } from './FlashStack';

interface AuthPageShellProps {
  portalLabel: string;
  title: string;
  subtitle: string;
  badgeTone?: 'slate' | 'emerald' | 'amber';
  visualVariant?: 'unified' | 'wallet' | 'fi' | 'command';
  highlights: string[];
  portalLinks?: Array<{ path: string; label: string }>;
  children: ReactNode;
}

const toneClass: Record<NonNullable<AuthPageShellProps['badgeTone']>, string> = {
  slate: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  emerald: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-100 text-amber-800 border-amber-200',
};

const visualTheme: Record<
  NonNullable<AuthPageShellProps['visualVariant']>,
  {
    panelBg: string;
    glowA: string;
    glowB: string;
    title: string;
    persona: string;
    chips: [string, string, string];
  }
> = {
  unified: {
    panelBg: 'bg-[linear-gradient(160deg,#201c72_0%,#2f34a8_52%,#111b64_100%)]',
    glowA: 'bg-violet-400/35',
    glowB: 'bg-cyan-300/25',
    title: 'Unified KYC Gateway',
    persona: 'Multi-portal authenticated operator',
    chips: ['Wallet Workspace', 'FI Workspace', 'Command Centre'],
  },
  wallet: {
    panelBg: 'bg-[linear-gradient(160deg,#0f3b66_0%,#0d5f67_52%,#0b2f4e_100%)]',
    glowA: 'bg-emerald-300/30',
    glowB: 'bg-cyan-300/20',
    title: 'Wallet User Console',
    persona: 'Consent owner and nominee operator',
    chips: ['Consent Approval', 'Delegation', 'Nominee Flow'],
  },
  fi: {
    panelBg: 'bg-[linear-gradient(160deg,#2d1a5f_0%,#1e3a8a_52%,#0f1b43_100%)]',
    glowA: 'bg-amber-300/30',
    glowB: 'bg-sky-300/20',
    title: 'FI Analyst Console',
    persona: 'Request initiator and verification lead',
    chips: ['Consent Request', 'Assertion Verify', 'Audit Evidence'],
  },
  command: {
    panelBg: 'bg-[linear-gradient(160deg,#0f172a_0%,#1e293b_52%,#020617_100%)]',
    glowA: 'bg-blue-300/25',
    glowB: 'bg-cyan-300/20',
    title: 'Command Admin Console',
    persona: 'Platform operations and control-plane admin',
    chips: ['Service Health', 'Timeline Audit', 'Scenario Suite'],
  },
};

function VariantHeroArtwork({ variant }: { variant: NonNullable<AuthPageShellProps['visualVariant']> }) {
  if (variant === 'wallet') {
    return (
      <svg viewBox="0 0 320 220" className="h-full w-full" role="img" aria-label="Wallet user illustration">
        <rect x="20" y="18" width="280" height="184" rx="24" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.18)" />
        <path d="M160 52 220 76v42c0 44-29 72-60 84-31-12-60-40-60-84V76l60-24Z" fill="rgba(16,185,129,0.32)" stroke="rgba(52,211,153,0.9)" strokeWidth="3" />
        <circle cx="160" cy="95" r="16" fill="rgba(255,255,255,0.9)" />
        <path d="M132 139c8-15 18-22 28-22s20 7 28 22" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="8" strokeLinecap="round" />
        <path d="m145 145 10 10 20-22" fill="none" stroke="rgba(52,211,153,0.95)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (variant === 'fi') {
    return (
      <svg viewBox="0 0 320 220" className="h-full w-full" role="img" aria-label="FI analyst illustration">
        <rect x="20" y="18" width="280" height="184" rx="24" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.18)" />
        <rect x="72" y="46" width="116" height="132" rx="10" fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.8)" strokeWidth="2" />
        <line x1="88" y1="76" x2="170" y2="76" stroke="rgba(255,255,255,0.8)" strokeWidth="4" strokeLinecap="round" />
        <line x1="88" y1="98" x2="170" y2="98" stroke="rgba(255,255,255,0.66)" strokeWidth="4" strokeLinecap="round" />
        <line x1="88" y1="120" x2="156" y2="120" stroke="rgba(255,255,255,0.66)" strokeWidth="4" strokeLinecap="round" />
        <circle cx="212" cy="132" r="31" fill="rgba(56,189,248,0.24)" stroke="rgba(125,211,252,0.95)" strokeWidth="6" />
        <line x1="234" y1="154" x2="263" y2="181" stroke="rgba(125,211,252,0.95)" strokeWidth="8" strokeLinecap="round" />
      </svg>
    );
  }

  if (variant === 'command') {
    return (
      <svg viewBox="0 0 320 220" className="h-full w-full" role="img" aria-label="Command admin illustration">
        <rect x="20" y="18" width="280" height="184" rx="24" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.18)" />
        <rect x="58" y="52" width="204" height="106" rx="12" fill="rgba(59,130,246,0.2)" stroke="rgba(147,197,253,0.9)" strokeWidth="3" />
        <path d="M78 130 112 108l28 14 34-31 25 12" fill="none" stroke="rgba(34,211,238,0.95)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="78" cy="130" r="5" fill="white" />
        <circle cx="112" cy="108" r="5" fill="white" />
        <circle cx="140" cy="122" r="5" fill="white" />
        <circle cx="174" cy="91" r="5" fill="white" />
        <circle cx="199" cy="103" r="5" fill="white" />
        <rect x="140" y="168" width="40" height="7" rx="3.5" fill="rgba(255,255,255,0.7)" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 320 220" className="h-full w-full" role="img" aria-label="Unified portal illustration">
      <rect x="20" y="18" width="280" height="184" rx="24" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.18)" />
      <line x1="90" y1="118" x2="160" y2="82" stroke="rgba(125,211,252,0.95)" strokeWidth="5" />
      <line x1="160" y1="82" x2="232" y2="124" stroke="rgba(196,181,253,0.95)" strokeWidth="5" />
      <line x1="90" y1="118" x2="232" y2="124" stroke="rgba(52,211,153,0.8)" strokeWidth="4" />
      <circle cx="90" cy="118" r="30" fill="rgba(16,185,129,0.36)" stroke="rgba(52,211,153,0.95)" strokeWidth="3" />
      <circle cx="160" cy="82" r="30" fill="rgba(59,130,246,0.35)" stroke="rgba(147,197,253,0.95)" strokeWidth="3" />
      <circle cx="232" cy="124" r="30" fill="rgba(139,92,246,0.35)" stroke="rgba(196,181,253,0.95)" strokeWidth="3" />
      <text x="78" y="123" fill="white" fontSize="11" fontWeight="700">W</text>
      <text x="148" y="87" fill="white" fontSize="11" fontWeight="700">FI</text>
      <text x="219" y="129" fill="white" fontSize="11" fontWeight="700">C</text>
    </svg>
  );
}

export function AuthPageShell({
  portalLabel,
  title,
  subtitle,
  badgeTone = 'slate',
  visualVariant = 'unified',
  highlights,
  portalLinks = [
    { path: '/wallet/login', label: 'Wallet login' },
    { path: '/fi/login', label: 'FI login' },
    { path: '/command/login', label: 'Command login' },
  ],
  children,
}: AuthPageShellProps) {
  const visual = visualTheme[visualVariant];
  const { flashMessages, dismissFlashMessage } = useConsole();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.22),transparent_55%),radial-gradient(circle_at_bottom,rgba(16,185,129,0.16),transparent_52%),linear-gradient(135deg,#020617,#0b1025,#0f1b44)] p-2 sm:p-4">
      <FlashStack messages={flashMessages} onDismiss={dismissFlashMessage} />
      <div className="mx-auto min-h-[calc(100vh-1rem)] w-full max-w-[1720px] overflow-hidden rounded-[26px] border border-white/10 bg-white/5 shadow-[0_30px_72px_rgba(2,6,23,0.55)] backdrop-blur sm:rounded-[34px] lg:h-[calc(100vh-2rem)] lg:max-h-[980px] lg:min-h-0">
        <div className="grid h-full lg:grid-cols-[minmax(520px,1fr)_minmax(500px,1fr)]">
          <section className={`relative hidden overflow-hidden ${visual.panelBg} lg:block`}>
            <div className={`pointer-events-none absolute -left-20 top-10 h-72 w-72 rounded-full blur-3xl ${visual.glowA}`} />
            <div className={`pointer-events-none absolute -right-20 bottom-0 h-72 w-72 rounded-full blur-3xl ${visual.glowB}`} />

            <div className="relative flex h-full flex-col px-10 py-10 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/75">Visual Context</p>
              <p className="mt-2 text-2xl font-semibold">{visual.title}</p>
              <p className="mt-1 max-w-md text-sm text-white/80">{visual.persona}</p>

              <div className="mt-8 rounded-3xl border border-white/25 bg-white/10 p-4 backdrop-blur">
                <div className="h-[280px] rounded-2xl border border-white/20 bg-slate-950/25 p-3">
                  <VariantHeroArtwork variant={visualVariant} />
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/75">Flow Highlights</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {visual.chips.map((chip) => (
                    <span key={chip} className="rounded-lg border border-white/25 bg-white/10 px-2 py-1 text-xs text-white/90">
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="relative overflow-y-visible bg-white px-4 py-5 sm:px-8 sm:py-7 lg:overflow-y-auto lg:px-14 lg:py-9">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-700">
                  {portalLabel}
                </span>
                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${toneClass[badgeTone]}`}>
                  Secure authentication
                </span>
                <div className="ml-auto hidden flex-wrap items-center gap-2 text-xs sm:flex">
                  {portalLinks.map((item) => (
                    <Link
                      key={item.path}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                      to={item.path}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
              <h1 className="text-[1.72rem] font-semibold leading-[1.08] tracking-[-0.02em] text-slate-950 sm:text-[2.05rem] lg:text-[2.45rem]">
                {title}
              </h1>
              <p className="max-w-2xl text-sm text-slate-600 sm:text-base">{subtitle}</p>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_34px_rgba(15,23,42,0.08)] sm:mt-7 sm:rounded-3xl sm:p-5">
              {children}
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:hidden">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">Portal Routes</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {portalLinks.map((item) => (
                  <Link
                    key={item.path}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    to={item.path}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>

            <p className="mt-6 text-center text-xs text-white/55 lg:mt-8">
              Bharat KYC T • Tokenised KYC demo • Consent-driven, auditable identity sharing
            </p>

            {highlights.length > 0 ? (
              <ul className="mt-5 space-y-2">
                {highlights.map((highlight) => (
                  <li key={highlight} className="flex items-start gap-2 text-sm text-slate-600">
                    <span className="mt-1 inline-flex h-4 w-4 flex-none items-center justify-center rounded-full border border-indigo-300 bg-indigo-50 text-[10px] font-semibold text-indigo-600">
                      {'>'}
                    </span>
                    <span>{highlight}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
