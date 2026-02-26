import type { LucideIcon } from "lucide-react";

interface DashboardKpiCardProps {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "blue" | "amber" | "emerald" | "rose" | "indigo" | "slate";
  Icon?: LucideIcon;
}

const toneMap = {
  blue: { value: "text-blue-700", ring: "border-blue-200", bg: "bg-blue-50", icon: "text-blue-600" },
  amber: { value: "text-amber-700", ring: "border-amber-200", bg: "bg-amber-50", icon: "text-amber-600" },
  emerald: { value: "text-emerald-700", ring: "border-emerald-200", bg: "bg-emerald-50", icon: "text-emerald-600" },
  rose: { value: "text-rose-700", ring: "border-rose-200", bg: "bg-rose-50", icon: "text-rose-600" },
  indigo: { value: "text-indigo-700", ring: "border-indigo-200", bg: "bg-indigo-50", icon: "text-indigo-600" },
  slate: { value: "text-slate-800", ring: "border-slate-200", bg: "bg-slate-50", icon: "text-slate-600" },
} as const;

export function DashboardKpiCard({ label, value, hint, tone = "blue", Icon }: DashboardKpiCardProps) {
  const t = toneMap[tone];
  return (
    <div className={`group rounded-2xl border border-slate-200 bg-gradient-to-b from-[#fbfcff] to-[#f6f9ff] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${t.ring}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-600">{label}</p>
          <p className={`mt-2 text-3xl font-semibold tracking-tight ${t.value}`}>{value}</p>
          <div className="mt-2 h-1.5 w-16 rounded-full bg-slate-100"><div className={`h-1.5 rounded-full ${t.bg}`} style={{ width: '70%' }} /></div>
          {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
        </div>
        {Icon ? (
          <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${t.ring} ${t.bg}`}>
            <Icon className={`h-5 w-5 ${t.icon}`} />
          </span>
        ) : null}
      </div>
    </div>
  );
}
