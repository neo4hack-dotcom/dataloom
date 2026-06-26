import { useMemo, useState } from "react";
import {
  GitCompare, KeyRound, Check, X, Sparkles, ArrowRight, Grid3x3, Link2,
} from "lucide-react";
import { useCatalog } from "../store";
import { api } from "../api";
import { EmptyState, shortDs, confidenceColor } from "../lib/ui";

type SubTab = "keys" | "samefield" | "heatmap";

export function Relationships() {
  const { state } = useCatalog();
  const [sub, setSub] = useState<SubTab>("keys");

  const rels = state?.relationships ?? [];
  const matches = state?.matches ?? [];

  if (rels.length === 0 && matches.length === 0) {
    return <EmptyState icon={<GitCompare size={48} />} title="No relationships detected"
      hint="Run the Linker agent: it compares real values (MinHash + inclusion) to infer keys and identical fields." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5">
        {([["keys", "PK/FK Keys", KeyRound, rels.length],
           ["samefield", "Identical fields", Link2, matches.length],
           ["heatmap", "Heatmap", Grid3x3, 0]] as const).map(([id, label, Icon, n]) => (
          <button key={id} onClick={() => setSub(id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${
              sub === id ? "bg-loom-500/10 text-loom-600 dark:text-loom-300" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
            <Icon size={15} /> {label}{n > 0 && <span className="rounded-full bg-slate-200 px-1.5 text-[10px] dark:bg-slate-700">{n}</span>}
          </button>
        ))}
      </div>

      {sub === "keys" && <KeysView />}
      {sub === "samefield" && <SameFieldView />}
      {sub === "heatmap" && <HeatmapView />}
    </div>
  );
}

function KeysView() {
  const { state, mutate, toast } = useCatalog();
  const rels = state?.relationships ?? [];
  const setStatus = async (idx: number, status: string) => {
    await mutate((v) => api.setRelStatus(idx, status, v));
    toast("ok", status === "validated" ? "Relationship validated ✓" : "Relationship rejected");
  };
  return (
    <div className="space-y-2">
      {rels.map((r, i) => (
        <div key={i} className={`card flex items-center gap-3 p-3.5 ${r.status === "rejected" ? "opacity-50" : ""}`}>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-500"><KeyRound size={18} /></div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-1.5 text-sm">
              <span className="min-w-0 truncate font-mono">
                <span className="text-slate-400">{shortDs(r.child.dataset_id)}.</span>
                <span className="font-semibold">{r.child.column}</span>
              </span>
              <ArrowRight size={15} className="shrink-0 text-loom-500" />
              <span className="min-w-0 truncate font-mono">
                <span className="text-slate-400">{shortDs(r.parent.dataset_id)}.</span>
                <span className="font-semibold">{r.parent.column}</span>
              </span>
            </div>
            <span className="truncate text-[11px] text-slate-400">{r.reason}</span>
          </div>
          <span className={`chip shrink-0 ${confidenceColor(r.confidence)} bg-current/10 font-mono`}>{r.confidence.toFixed(0)}%</span>
          {r.status === "validated" ? (
            <span className="chip shrink-0 bg-emerald-500/10 text-emerald-500"><Check size={12} /> validated</span>
          ) : (
            <div className="flex shrink-0 gap-1">
              <button onClick={() => setStatus(i, "validated")} className="btn-ghost !p-1.5 text-emerald-500" title="Validate"><Check size={16} /></button>
              <button onClick={() => setStatus(i, "rejected")} className="btn-ghost !p-1.5 text-rose-500" title="Reject"><X size={16} /></button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SameFieldView() {
  const { state } = useCatalog();
  const matches = state?.matches ?? [];
  return (
    <div className="grid gap-2.5 md:grid-cols-2">
      {matches.map((m, i) => (
        <div key={i} className="card p-3.5">
          <div className="flex items-center gap-2 text-sm">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-loom-500/10 text-loom-500"><Link2 size={15} /></span>
            <span className="font-mono font-semibold">{m.a.column}</span>
            <span className="text-slate-400">≈</span>
            <span className="font-mono font-semibold">{m.b.column}</span>
            <span className={`ml-auto chip ${confidenceColor(m.confidence)} bg-current/10 font-mono`}>{m.confidence.toFixed(0)}%</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            {shortDs(m.a.dataset_id)} ↔ {shortDs(m.b.dataset_id)}
          </div>
          {/* evidence bars */}
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            <Bar label="value overlap" v={Math.max(m.containment_ab, m.containment_ba)} />
            <Bar label="Jaccard" v={m.value_jaccard} />
            <Bar label="name" v={m.name_sim} />
            <Bar label="type" v={m.type_match} />
          </div>
          {m.reasons.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {m.reasons.map((r, k) => (
                <span key={k} className="chip bg-slate-500/10 text-slate-500"><Sparkles size={10} /> {r}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Bar({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-24 text-slate-400">{label}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div className="h-full rounded-full bg-loom-500" style={{ width: `${Math.min(100, v * 100)}%` }} />
      </div>
    </div>
  );
}

function HeatmapView() {
  const { state } = useCatalog();
  const datasets = state?.datasets ?? [];
  const rels = state?.relationships ?? [];
  const matches = state?.matches ?? [];

  const { labels, matrix } = useMemo(() => {
    const ids = datasets.map((d) => d.id);
    const labels = datasets.map((d) => d.name);
    const idx = new Map(ids.map((id, i) => [id, i]));
    const matrix = ids.map(() => ids.map(() => 0));
    const add = (a: string, b: string, w: number) => {
      const i = idx.get(a), j = idx.get(b);
      if (i === undefined || j === undefined) return;
      matrix[i][j] = Math.max(matrix[i][j], w);
      matrix[j][i] = Math.max(matrix[j][i], w);
    };
    for (const r of rels) add(r.child.dataset_id, r.parent.dataset_id, r.confidence);
    for (const m of matches) add(m.a.dataset_id, m.b.dataset_id, m.confidence);
    return { labels, matrix };
  }, [datasets, rels, matches]);

  if (datasets.length === 0) return null;

  return (
    <div className="card overflow-auto p-5">
      <div className="mb-3 text-sm font-semibold">Table connectivity matrix</div>
      <div className="inline-block">
        <table className="border-separate" style={{ borderSpacing: 3 }}>
          <thead>
            <tr>
              <th />
              {labels.map((l) => (
                <th key={l} className="h-24 w-8 align-bottom">
                  <div className="origin-bottom-left -rotate-45 whitespace-nowrap text-[10px] text-slate-400" style={{ width: 16 }}>{l}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, i) => (
              <tr key={i}>
                <td className="pr-2 text-right text-[10px] text-slate-400 whitespace-nowrap">{labels[i]}</td>
                {row.map((v, j) => {
                  const intensity = v / 100;
                  const bg = i === j ? "rgba(100,116,139,.15)" :
                    v === 0 ? "rgba(100,116,139,.06)" :
                    `rgba(59,116,245,${0.15 + intensity * 0.85})`;
                  return (
                    <td key={j}>
                      <div className="grid h-7 w-7 place-items-center rounded text-[9px] font-mono text-white/90"
                        style={{ background: bg }} title={v ? `${labels[i]} ↔ ${labels[j]}: ${v.toFixed(0)}%` : ""}>
                        {v > 0 && i !== j ? v.toFixed(0) : ""}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 text-[11px] text-slate-400">
        Darker blue = stronger link between tables.
      </div>
    </div>
  );
}
