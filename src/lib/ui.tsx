import type { ReactNode } from "react";

// ---- semantic-type visual vocabulary -------------------------------------- //
export const SEMANTIC_COLORS: Record<string, string> = {
  email: "text-pink-500 bg-pink-500/10",
  iban: "text-amber-500 bg-amber-500/10",
  siret: "text-amber-500 bg-amber-500/10",
  siren: "text-amber-500 bg-amber-500/10",
  integer_id: "text-loom-400 bg-loom-500/10",
  iso_date: "text-emerald-500 bg-emerald-500/10",
  iso_datetime: "text-emerald-500 bg-emerald-500/10",
  currency_code: "text-violet-500 bg-violet-500/10",
  country_code: "text-cyan-500 bg-cyan-500/10",
  code: "text-teal-500 bg-teal-500/10",
  ipv4: "text-orange-500 bg-orange-500/10",
  url: "text-blue-500 bg-blue-500/10",
  phone: "text-fuchsia-500 bg-fuchsia-500/10",
  boolean: "text-slate-500 bg-slate-500/10",
  free_text: "text-slate-400 bg-slate-500/10",
  unknown: "text-slate-400 bg-slate-500/10",
};

export function semanticColor(t: string): string {
  return SEMANTIC_COLORS[t] ?? "text-slate-400 bg-slate-500/10";
}

export function confidenceColor(c: number): string {
  if (c >= 85) return "text-emerald-500";
  if (c >= 65) return "text-amber-500";
  return "text-rose-500";
}

export function confidenceBg(c: number): string {
  if (c >= 85) return "bg-emerald-500";
  if (c >= 65) return "bg-amber-500";
  return "bg-rose-500";
}

export function ConfidenceBadge({ value }: { value: number }) {
  return (
    <span className={`chip ${confidenceColor(value)} bg-current/10`}>
      <span className="font-mono font-semibold">{value.toFixed(0)}%</span>
    </span>
  );
}

export function QualityBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div className={`h-full rounded-full ${confidenceBg(value)}`} style={{ width: `${value}%` }} />
      </div>
      <span className="font-mono text-[11px] text-slate-500">{value.toFixed(0)}</span>
    </div>
  );
}

export function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`chip ${className}`}>{children}</span>;
}

// ---- pure-SVG charts ------------------------------------------------------ //
export function Donut({
  segments, size = 120, thickness = 14, center,
}: {
  segments: { value: number; color: string; label?: string }[];
  size?: number; thickness?: number; center?: ReactNode;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          className="stroke-slate-200 dark:stroke-slate-800" strokeWidth={thickness} />
        {segments.map((s, i) => {
          const len = (s.value / total) * c;
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={s.color} strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset}
              strokeLinecap="butt" />
          );
          offset += len;
          return el;
        })}
      </svg>
      {center && <div className="absolute inset-0 grid place-items-center">{center}</div>}
    </div>
  );
}

export function Sparkbars({ values, color = "#3b74f5", height = 36 }: { values: number[]; color?: string; height?: number }) {
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-0.5" style={{ height }}>
      {values.map((v, i) => (
        <div key={i} className="w-full rounded-sm" style={{
          height: `${Math.max(6, (v / max) * height)}px`, background: color, opacity: 0.4 + 0.6 * (v / max),
        }} />
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, icon, accent = "text-loom-500" }: {
  label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; accent?: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
          {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
        </div>
        {icon && <div className={`${accent}`}>{icon}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-slate-300 py-16 text-center dark:border-slate-700">
      <div className="text-slate-300 dark:text-slate-600">{icon}</div>
      <div className="mt-3 font-medium text-slate-600 dark:text-slate-300">{title}</div>
      {hint && <div className="mt-1 max-w-md text-sm text-slate-400">{hint}</div>}
    </div>
  );
}

export function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}j`;
}

export function shortDs(id: string): string {
  return id.split("::").pop() ?? id;
}
