import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import { useMemo } from 'react';

type PlannerItem = { title: string; time: string; badge?: string; participants?: string[] };

interface HomePlannerPanelProps {
  title?: string;
  dateLabel?: string;
  items?: PlannerItem[];
}

export function HomePlannerPanel({
  title = 'Upcoming Events',
  dateLabel,
  items = [],
}: HomePlannerPanelProps) {
  const now = new Date();
  const label = dateLabel ?? now.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const days = useMemo(() => {
    const d = new Date(now);
    const arr: Array<{ dow: string; day: number; active: boolean }> = [];
    for (let i = -3; i <= 3; i += 1) {
      const n = new Date(d);
      n.setDate(d.getDate() + i);
      arr.push({
        dow: n.toLocaleDateString(undefined, { weekday: 'short' }),
        day: n.getDate(),
        active: i === 0,
      });
    }
    return arr;
  }, [now]);

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-[#f8faff] px-3 py-2 text-xs font-semibold text-slate-700">
            <CalendarDays className="h-4 w-4 text-blue-600" />
            {label}
          </div>
          <div className="inline-flex items-center gap-1">
            <button type="button" className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-gradient-to-b from-[#fcfdff] to-[#f8fbff] p-4 shadow-inner">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">{label}</p>
            <span className="text-[11px] text-slate-500">Planner</span>
          </div>
          <div className="grid grid-cols-7 gap-1.5 text-center">
            {days.map((d) => (
              <div key={`${d.dow}-${d.day}`} className="space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">{d.dow}</p>
                <div className={d.active ? 'mx-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white' : 'mx-auto inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-slate-700'}>
                  {d.day}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-[#f8faff] p-1 text-[11px]">
            <span className="rounded-full bg-blue-600 px-2 py-0.5 font-semibold text-white shadow-sm">1d</span>
            <span className="rounded-full px-2 py-0.5 text-slate-600 hover:bg-white">7d</span>
            <span className="rounded-full px-2 py-0.5 text-slate-600 hover:bg-white">1m</span>
            <span className="rounded-full px-2 py-0.5 text-slate-600 hover:bg-white">All</span>
          </div>
        </div>
        <div className="max-h-[320px] space-y-2 overflow-auto pr-1">
          {(items.length ? items : [
            { title: 'Review consent queue', time: 'Today · 12:00 PM', participants: ['FI','WL'] },
            { title: 'Verify signed assertion', time: 'Today · 2:30 PM', participants: ['VC','REG'] },
            { title: 'Token lifecycle check', time: 'Tomorrow · 10:00 AM', participants: ['OPS'] },
          ]).map((item, idx) => (
            <div key={`${item.title}-${idx}`} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-[#fbfcff] px-3 py-3 transition hover:border-blue-200 hover:bg-white hover:shadow-sm">
              <div>
                <p className="text-sm font-medium text-slate-800">{item.title}</p>
                <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500"><Clock3 className="h-3.5 w-3.5" />{item.time}</p>
              </div>
              <div className="flex items-center gap-2">
                {item.participants?.length ? (
                  <div className="hidden items-center -space-x-2 sm:flex">
                    {item.participants.slice(0, 3).map((p, i) => (
                      <span key={`${p}-${i}`} className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-[10px] font-semibold text-slate-700">
                        {p.slice(0, 2)}
                      </span>
                    ))}
                  </div>
                ) : null}
                {item.badge ? <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700">{item.badge}</span> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
