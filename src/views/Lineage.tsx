import { useMemo, useState } from "react";
import { Workflow, Plus, StickyNote, Info, Trash2, Check, ArrowRight, X, KeyRound, Lock } from "lucide-react";
import { useCatalog, useScopedDatasets } from "../store";
import { api } from "../api";
import { EmptyState, shortDs, semanticColor } from "../lib/ui";

const EDGE_COLOR: Record<string, string> = {
  key: "#3b74f5", mapping: "#8b5cf6", manual: "#10b981",
};

export function Lineage() {
  const { state, mutate, toast } = useCatalog();
  const [note, setNote] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const datasets = useScopedDatasets();
  const idSet = useMemo(() => new Set(datasets.map((d) => d.id)), [datasets]);
  const edges = useMemo(
    () => (state?.lineage ?? []).filter((e) => idSet.has(e.from) || idSet.has(e.to)),
    [state?.lineage, idSet]);
  const layout = useMemo(() => buildLayout(datasets.map((d) => d.id), edges), [datasets, edges]);

  const addNote = async () => {
    if (!note.trim()) return;
    await mutate((v) => api.addNote(note, v));
    setNote("");
    toast("ok", "Note added — re-run the Lineage agent to integrate it.");
  };

  const delEdge = async (idx: number) => {
    await mutate((v) => api.deleteLineageEdge(idx, v));
    toast("ok", "Edge deleted");
  };

  if (datasets.length === 0) {
    return <EmptyState icon={<Workflow size={48} />} title="No lineage yet"
      hint="Run the pipeline, or add edges manually in the panel below." />;
  }

  const nameOf = (id: string) => datasets.find((d) => d.id === id)?.name ?? shortDs(id);
  const W = 920, H = Math.max(360, layout.height);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      {/* SVG graph */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <Workflow size={16} className="text-loom-500" />
          <span className="text-sm font-semibold">Lineage graph</span>
          <span className="ml-auto flex gap-2 text-[11px]">
            {Object.entries(EDGE_COLOR).map(([k, c]) => (
              <span key={k} className="flex items-center gap-1 text-slate-400">
                <span className="h-2 w-3 rounded" style={{ background: c }} />
                {k === "key" ? "key" : k === "mapping" ? "mapping" : "manual"}
              </span>
            ))}
          </span>
        </div>
        <div className="overflow-auto bg-grid p-2">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minHeight: 340 }}>
            <defs>
              {Object.entries(EDGE_COLOR).map(([k, c]) => (
                <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill={c} />
                </marker>
              ))}
            </defs>
            {edges.map((e, i) => {
              const a = layout.nodes[e.from], b = layout.nodes[e.to];
              if (!a || !b) return null;
              const x1 = a.x + a.w, y1 = a.y + a.h / 2;
              const x2 = b.x, y2 = b.y + b.h / 2;
              const mx = (x1 + x2) / 2;
              const dim = hover && hover !== e.from && hover !== e.to;
              return (
                <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                  fill="none" stroke={EDGE_COLOR[e.kind]} strokeWidth={1.5 + (e.confidence / 100) * 1.5}
                  markerEnd={`url(#arrow-${e.kind})`} opacity={dim ? 0.12 : 0.7} />
              );
            })}
            {Object.entries(layout.nodes).map(([id, n]) => {
              const dim = hover && hover !== id && !edges.some((e) =>
                (e.from === hover && e.to === id) || (e.to === hover && e.from === id));
              const isMap = nameOf(id).toUpperCase().startsWith("MAP_") || nameOf(id).toUpperCase().startsWith("DIM_");
              return (
                <g key={id} transform={`translate(${n.x},${n.y})`} opacity={dim ? 0.3 : 1}
                  onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)}
                  onClick={() => setSelected(id)} style={{ cursor: "pointer" }}>
                  <rect width={n.w} height={n.h} rx={8}
                    className={selected === id
                      ? "fill-loom-500/15 stroke-loom-500"
                      : isMap ? "fill-violet-500/10 stroke-violet-500/40" : "fill-white stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600"}
                    strokeWidth={selected === id ? 2.5 : 1.5} />
                  <text x={10} y={20} className="fill-slate-700 text-[12px] font-semibold dark:fill-slate-100">{nameOf(id)}</text>
                  <text x={10} y={35} className="fill-slate-400 text-[9px]">{shortDs(id).split(".")[0]}</text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Right panel */}
      <div className="space-y-4">
        {/* Deep-dive on the clicked node */}
        {selected && (() => {
          const d = datasets.find((x) => x.id === selected);
          if (!d) return null;
          const doc = state?.docs[d.id];
          const ins = edges.filter((e) => e.to === d.id);
          const outs = edges.filter((e) => e.from === d.id);
          return (
            <div className="card p-4 animate-fade-in">
              <div className="flex items-center gap-2">
                <Workflow size={15} className="text-loom-500" />
                <span className="font-semibold">{d.name}</span>
                {doc?.domain && <span className="chip bg-loom-500/10 text-loom-500">{doc.domain}</span>}
                <button onClick={() => setSelected(null)} className="btn-ghost ml-auto !p-1"><X size={14} /></button>
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">{d.schema} · {d.columns.length} fields · ~{d.row_estimate.toLocaleString()} rows</div>
              {doc?.definition && <p className="mt-1.5 text-xs text-slate-500">{doc.definition}</p>}
              {doc?.synthesis && <p className="mt-1.5 rounded-lg bg-slate-100 p-2 text-[11px] text-slate-500 dark:bg-slate-800">{doc.synthesis}</p>}

              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <div className="mb-1 font-semibold text-slate-400">Feeds from ({ins.length})</div>
                  {ins.length ? ins.map((e, i) => <div key={i} className="truncate font-mono text-slate-500">← {nameOf(e.from)}</div>)
                    : <div className="italic text-slate-400">—</div>}
                </div>
                <div>
                  <div className="mb-1 font-semibold text-slate-400">Feeds into ({outs.length})</div>
                  {outs.length ? outs.map((e, i) => <div key={i} className="truncate font-mono text-slate-500">→ {nameOf(e.to)}</div>)
                    : <div className="italic text-slate-400">—</div>}
                </div>
              </div>

              <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-slate-100 dark:border-slate-800">
                {d.columns.map((c) => (
                  <div key={c.name} className="flex items-center gap-1.5 border-b border-slate-100 px-2 py-1 text-[11px] last:border-0 dark:border-slate-800/60">
                    {c.profile.is_key_candidate && <KeyRound size={9} className="shrink-0 text-amber-500" />}
                    <span className="truncate font-mono">{c.name}</span>
                    {c.profile.sensitivity === "PII" && <Lock size={9} className="shrink-0 text-rose-400" />}
                    <span className={`chip ml-auto shrink-0 ${semanticColor(c.profile.semantic_type)}`}>{c.profile.semantic_type}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Add edge form */}
        <AddEdgePanel datasets={datasets} />

        {/* Edge list */}
        {edges.length > 0 && (
          <div className="card p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">All edges ({edges.length})</div>
            <div className="max-h-52 space-y-1 overflow-auto">
              {edges.map((e, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-800">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: EDGE_COLOR[e.kind] }} />
                  <span className="truncate font-mono text-slate-500">{nameOf(e.from)}</span>
                  <ArrowRight size={11} className="shrink-0 text-slate-400" />
                  <span className="truncate font-mono text-slate-500">{nameOf(e.to)}</span>
                  <button onClick={() => delEdge(i)} className="ml-auto text-slate-400 hover:text-rose-500 shrink-0">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notes panel */}
        <div className="card p-4">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <StickyNote size={15} className="text-emerald-500" /> Describe your model
          </div>
          <p className="mb-2 text-xs text-slate-400">
            Describe a chain with arrows. E.g.{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">CUSTOMERS -&gt; DIM_CLIENT</code>.
            Re-run the Lineage agent to integrate.
          </p>
          <textarea className="input min-h-[60px] font-mono text-xs" value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={"CUSTOMERS -> ORDERS -> ORDER_ITEMS\nMAP_COUNTRY -> DIM_CLIENT"} />
          <button onClick={addNote} className="btn-primary mt-2 w-full justify-center text-xs"><Plus size={14} /> Add note</button>
        </div>

        {(state?.model_notes.length ?? 0) > 0 && (
          <div className="card p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Model notes</div>
            <div className="space-y-2">
              {state!.model_notes.map((n) => (
                <pre key={n.id} className="whitespace-pre-wrap rounded-lg bg-slate-100 p-2 font-mono text-[11px] text-slate-500 dark:bg-slate-800">{n.text}</pre>
              ))}
            </div>
          </div>
        )}

        <div className="card flex items-start gap-2 p-3 text-xs text-slate-500">
          <Info size={14} className="mt-0.5 shrink-0 text-loom-500" />
          {edges.length} edges · {datasets.length} tables. Hover a node to isolate dependencies.
        </div>
      </div>
    </div>
  );
}

function AddEdgePanel({ datasets }: { datasets: { id: string; schema: string; name: string }[] }) {
  const { mutate, toast } = useCatalog();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [via, setVia] = useState("");
  const [kind, setKind] = useState<"manual" | "key" | "mapping">("manual");

  const add = async () => {
    if (!from || !to) { toast("err", "Select both tables"); return; }
    if (from === to) { toast("err", "Source and target must differ"); return; }
    await mutate((v) => api.addLineageEdge({ from_id: from, to_id: to, via, kind, confidence: 100 }, v));
    toast("ok", "Lineage edge added ✓"); setOpen(false);
    setFrom(""); setTo(""); setVia("");
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-outline w-full justify-center text-xs">
        <Plus size={14} /> Add lineage edge manually
      </button>
    );
  }

  return (
    <div className="card animate-fade-in space-y-2 p-4">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">New lineage edge</div>
      <div className="space-y-1">
        <label className="text-[10px] text-slate-400">Source (upstream)</label>
        <select className="input text-xs" value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">Select source table…</option>
          {datasets.map((d) => <option key={d.id} value={d.id}>{d.schema}.{d.name}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-[10px] text-slate-400">Target (downstream)</label>
        <select className="input text-xs" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Select target table…</option>
          {datasets.filter((d) => d.id !== from).map((d) => <option key={d.id} value={d.id}>{d.schema}.{d.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] text-slate-400">Via (key / join)</label>
          <input className="input !py-1 text-xs" value={via} onChange={(e) => setVia(e.target.value)} placeholder="e.g. customer_id" />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-slate-400">Kind</label>
          <select className="input !py-1 text-xs" value={kind} onChange={(e) => setKind(e.target.value as any)}>
            <option value="manual">Manual</option>
            <option value="key">Key</option>
            <option value="mapping">Mapping</option>
          </select>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={add} className="btn-primary flex-1 justify-center text-xs"><Check size={13} /> Add</button>
        <button onClick={() => setOpen(false)} className="btn-outline text-xs">Cancel</button>
      </div>
    </div>
  );
}

function buildLayout(ids: string[], edges: { from: string; to: string }[]) {
  const NODE_W = 150, NODE_H = 44, GAP_X = 200, GAP_Y = 16, PAD = 20;
  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  ids.forEach((id) => { adj.set(id, []); indeg.set(id, 0); });
  for (const e of edges) {
    if (!adj.has(e.from) || !adj.has(e.to)) continue;
    adj.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const level = new Map<string, number>();
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  queue.forEach((id) => level.set(id, 0));
  const work = [...queue];
  const localIndeg = new Map(indeg);
  while (work.length) {
    const id = work.shift()!;
    for (const nb of adj.get(id) ?? []) {
      level.set(nb, Math.max(level.get(nb) ?? 0, (level.get(id) ?? 0) + 1));
      localIndeg.set(nb, (localIndeg.get(nb) ?? 1) - 1);
      if ((localIndeg.get(nb) ?? 0) <= 0) work.push(nb);
    }
  }
  ids.forEach((id) => { if (!level.has(id)) level.set(id, 0); });
  const byLevel = new Map<number, string[]>();
  ids.forEach((id) => {
    const l = level.get(id)!;
    (byLevel.get(l) ?? byLevel.set(l, []).get(l)!).push(id);
  });
  const nodes: Record<string, { x: number; y: number; w: number; h: number }> = {};
  let maxY = 0;
  for (const [l, group] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
    group.forEach((id, i) => {
      const x = PAD + l * GAP_X;
      const y = PAD + i * (NODE_H + GAP_Y);
      nodes[id] = { x, y, w: NODE_W, h: NODE_H };
      maxY = Math.max(maxY, y + NODE_H);
    });
  }
  return { nodes, height: maxY + PAD };
}
