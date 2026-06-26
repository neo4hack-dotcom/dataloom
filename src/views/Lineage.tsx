import { useMemo, useState } from "react";
import { Workflow, Plus, StickyNote, Info } from "lucide-react";
import { useCatalog } from "../store";
import { api } from "../api";
import { EmptyState, shortDs } from "../lib/ui";

const EDGE_COLOR: Record<string, string> = {
  key: "#3b74f5", mapping: "#8b5cf6", manual: "#10b981",
};

export function Lineage() {
  const { state, mutate, toast } = useCatalog();
  const [note, setNote] = useState("");
  const [hover, setHover] = useState<string | null>(null);

  const datasets = state?.datasets ?? [];
  const edges = state?.lineage ?? [];

  const layout = useMemo(() => buildLayout(datasets.map((d) => d.id), edges), [datasets, edges]);

  const addNote = async () => {
    if (!note.trim()) return;
    await mutate((v) => api.addNote(note, v));
    setNote("");
    toast("ok", "Note added — re-run the Lineage agent to integrate it.");
  };

  if (datasets.length === 0) {
    return <EmptyState icon={<Workflow size={48} />} title="No lineage yet"
      hint="Run the pipeline: the Lineage agent reconstructs chains from keys, mapping tables and your model notes." />;
  }

  const nameOf = (id: string) => datasets.find((d) => d.id === id)?.name ?? shortDs(id);
  const W = 920, H = Math.max(360, layout.height);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <Workflow size={16} className="text-loom-500" />
          <span className="text-sm font-semibold">Lineage graph</span>
          <span className="ml-auto flex gap-2 text-[11px]">
            {Object.entries(EDGE_COLOR).map(([k, c]) => (
              <span key={k} className="flex items-center gap-1 text-slate-400">
                <span className="h-2 w-3 rounded" style={{ background: c }} />
                {k === "key" ? "key" : k === "mapping" ? "mapping" : "note"}
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
            {/* edges */}
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
            {/* nodes */}
            {Object.entries(layout.nodes).map(([id, n]) => {
              const dim = hover && hover !== id && !edges.some((e) =>
                (e.from === hover && e.to === id) || (e.to === hover && e.from === id));
              const isMap = nameOf(id).toUpperCase().startsWith("MAP_") || nameOf(id).toUpperCase().startsWith("DIM_");
              return (
                <g key={id} transform={`translate(${n.x},${n.y})`} opacity={dim ? 0.3 : 1}
                  onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }}>
                  <rect width={n.w} height={n.h} rx={8}
                    className={isMap ? "fill-violet-500/10 stroke-violet-500/40" : "fill-white stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600"}
                    strokeWidth={1.5} />
                  <text x={10} y={20} className="fill-slate-700 text-[12px] font-semibold dark:fill-slate-100">{nameOf(id)}</text>
                  <text x={10} y={35} className="fill-slate-400 text-[9px]">{shortDs(id).split(".")[0]}</text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* notes panel */}
      <div className="space-y-4">
        <div className="card p-4">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <StickyNote size={15} className="text-emerald-500" /> Describe your model
          </div>
          <p className="mb-2 text-xs text-slate-400">
            Describe a chain with arrows. E.g.{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">CUSTOMERS -&gt; DIM_CLIENT</code>.
            The Lineage agent integrates them into the graph.
          </p>
          <textarea className="input min-h-[80px] font-mono text-xs" value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={"CUSTOMERS -> ORDERS -> ORDER_ITEMS\nMAP_COUNTRY -> DIM_CLIENT"} />
          <button onClick={addNote} className="btn-primary mt-2 w-full justify-center"><Plus size={14} /> Add note</button>
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
          {edges.length} edges reconstructed · {datasets.length} tables. Hover a node to isolate its dependencies.
        </div>
      </div>
    </div>
  );
}

// --- simple layered DAG layout -------------------------------------------- //
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
