import { AlertTriangle, BellRing, CheckCircle2, Info } from 'lucide-react';
import { useTheme } from '../../theme/ThemeProvider';

export type NotificationTone = 'info' | 'warn' | 'ok';

export interface NotificationItem {
  id: string;
  title: string;
  subtitle?: string;
  tone: NotificationTone;
}

function iconForTone(tone: NotificationTone) {
  if (tone === 'warn') return <AlertTriangle className="h-4 w-4 text-amber-300" />;
  if (tone === 'ok') return <CheckCircle2 className="h-4 w-4 text-emerald-300" />;
  return <Info className="h-4 w-4 text-cyan-300" />;
}

function pillClasses(tone: NotificationTone) {
  if (tone === 'warn') return 'border-amber-300/30 bg-amber-300/10 text-amber-100';
  if (tone === 'ok') return 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100';
  return 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100';
}

export function NotificationList({ title = 'Notifications', items }: { title?: string; items: NotificationItem[] }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  return (
    <div className={isDark ? "rounded-3xl border border-slate-700/70 bg-[linear-gradient(145deg,#0f172a,#0b122b)] p-5 text-slate-100" : "rounded-3xl border border-slate-200/80 bg-[linear-gradient(145deg,#ffffff,#f8fafc)] p-5 text-slate-900 shadow-[0_14px_44px_rgba(15,23,42,0.08)]"}>
      <div className="flex items-center justify-between gap-3">
        <p className={isDark ? "text-xs font-semibold uppercase tracking-[0.18em] text-slate-400" : "text-xs font-semibold uppercase tracking-[0.18em] text-slate-500"}>{title}</p>
        <span className={isDark ? "inline-flex items-center gap-2 text-xs text-slate-300" : "inline-flex items-center gap-2 text-xs text-slate-500"}>
          <BellRing className="h-4 w-4 text-slate-400" />
          {items.length}
        </span>
      </div>
      <div className="mt-4 space-y-2">
        {items.length === 0 ? (
          <div className={isDark ? "rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300" : "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600"}>All clear.</div>
        ) : (
          items.map((item) => (
            <div key={item.id} className={isDark ? "flex items-start justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3" : "flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50"}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{iconForTone(item.tone)}</div>
                <div>
                  <p className={isDark ? "text-sm font-semibold text-slate-100" : "text-sm font-semibold text-slate-900"}>{item.title}</p>
                  {item.subtitle ? <p className={isDark ? "mt-1 text-xs text-slate-300" : "mt-1 text-xs text-slate-500"}>{item.subtitle}</p> : null}
                </div>
              </div>
              <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-semibold ${isDark ? pillClasses(item.tone) : (item.tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-700" : item.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-cyan-200 bg-cyan-50 text-cyan-700")}`}>
                {item.tone.toUpperCase()}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
