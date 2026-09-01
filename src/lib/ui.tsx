import type { ReactNode } from "react";
import { Tag as TagIcon, X } from "lucide-react";

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

export function Sparkbars({ values, color = "#009f3d", height = 36 }: { values: number[]; color?: string; height?: number }) {
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

// ---- deterministic name-based color (tags, avatars, domains) --------------- //
const NAME_PALETTE = [
  { bg: "bg-rose-500/15", text: "text-rose-500", solid: "#f43f5e" },
  { bg: "bg-amber-500/15", text: "text-amber-500", solid: "#f59e0b" },
  { bg: "bg-emerald-500/15", text: "text-emerald-500", solid: "#10b981" },
  { bg: "bg-teal-500/15", text: "text-teal-500", solid: "#14b8a6" },
  { bg: "bg-cyan-500/15", text: "text-cyan-500", solid: "#06b6d4" },
  { bg: "bg-blue-500/15", text: "text-blue-500", solid: "#3b82f6" },
  { bg: "bg-violet-500/15", text: "text-violet-500", solid: "#8b5cf6" },
  { bg: "bg-fuchsia-500/15", text: "text-fuchsia-500", solid: "#d946ef" },
  { bg: "bg-pink-500/15", text: "text-pink-500", solid: "#ec4899" },
  { bg: "bg-orange-500/15", text: "text-orange-500", solid: "#f97316" },
];

export function nameColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return NAME_PALETTE[h % NAME_PALETTE.length];
}

// ---- Tags -------------------------------------------------------------------- //
export function TagChip({ tag, onRemove, onClick }: { tag: string; onRemove?: () => void; onClick?: () => void }) {
  const c = nameColor(tag);
  const Comp = onClick ? "button" : "span";
  return (
    <Comp onClick={onClick} className={`chip ${c.bg} ${c.text} ${onClick ? "cursor-pointer hover:brightness-110" : ""}`}>
      <TagIcon size={10} /> {tag}
      {onRemove && (
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="ml-0.5 opacity-60 hover:opacity-100">
          <X size={10} />
        </button>
      )}
    </Comp>
  );
}

// ---- Ownership ----------------------------------------------------------------- //
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] ?? "" : parts[0]?.[1] ?? "");
}

export function AvatarStack({ names, max = 5, size = 22 }: { names: string[]; max?: number; size?: number }) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <div className="flex items-center -space-x-2">
      {shown.map((name, i) => {
        const c = nameColor(name);
        return (
          <div key={i} title={name}
            className={`grid shrink-0 place-items-center rounded-full border-2 border-white font-bold dark:border-slate-900 ${c.bg} ${c.text}`}
            style={{ width: size, height: size, fontSize: size * 0.4 }}>
            {initials(name).toUpperCase()}
          </div>
        );
      })}
      {extra > 0 && (
        <div className="grid shrink-0 place-items-center rounded-full border-2 border-white bg-slate-200 font-bold text-slate-500 dark:border-slate-900 dark:bg-slate-700"
          style={{ width: size, height: size, fontSize: size * 0.35 }}>
          +{extra}
        </div>
      )}
    </div>
  );
}

// ---- Data-quality health ------------------------------------------------------- //
export function healthColor(score: number): string {
  if (score >= 80) return "#10b981";
  if (score >= 50) return "#f59e0b";
  return "#f43f5e";
}

export function healthTextClass(score: number): string {
  if (score >= 80) return "text-emerald-500";
  if (score >= 50) return "text-amber-500";
  return "text-rose-500";
}

export function HealthRing({ score, size = 40, thickness = 5, showLabel = true }: {
  score: number; size?: number; thickness?: number; showLabel?: boolean;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, score)) / 100 * c;
  const color = healthColor(score);
  return (
    <div className="relative inline-grid place-items-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-slate-200 dark:stroke-slate-800" strokeWidth={thickness} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={thickness}
          strokeDasharray={`${filled} ${c - filled}`} strokeLinecap="round" style={{ transition: "stroke-dasharray .4s" }} />
      </svg>
      {showLabel && (
        <span className="absolute font-bold" style={{ color, fontSize: size * 0.3 }}>{Math.round(score)}</span>
      )}
    </div>
  );
}
