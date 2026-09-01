import { useEffect, useMemo, useState } from "react";
import { Route, ArrowRight, AlertTriangle, Plus, Trash2, Workflow } from "lucide-react";
import { useCatalog, useScopedDatasets } from "../store";
import { api } from "../api";
import { buildLayout } from "../lib/graphLayout";
import { EmptyState, shortDs } from "../lib/ui";

type NodeRef = { dataset_id: string; column: string };
const key = (n: NodeRef) => `${n.dataset_id}::${n.column}`;

export function ImpactAnalysis() {
  const { state, mutate, focusImpact, setFocusImpact, toast } = useCatalog();
  const datasets = useScopedDatasets();
  const [dsId, setDsId] = useState<string>("");
  const [col, setCol] = useState<string>("");
  const [addOpen, setAddOpen] = useState(false);
  const [toDs, setToDs] = useState(""); const [toCol, setToCol] = useState(""); const [via, setVia] = useState("");

  useEffect(() => {
    if (focusImpact) {
      setDsId(focusImpact.dsId); setCol(focusImpact.col); setFocusImpact(null);
    } else if (!dsId && datasets[0]) {
      setDsId(datasets[0].id); setCol(datasets[0].columns[0]?.name ?? "");
    }
  }, [focusImpact]); // eslint-disable-line

  const activeDs = datasets.find((d) => d.id === dsId);

  // unified directed graph: relationship parent -> child (key feeds FK), plus explicit column_lineage from -> to
  const edges = useMemo(() => {
    const rel = (state?.relationships ?? []).map((r) => ({ from: r.parent, to: r.child, label: `key ${r.confidence.toFixed(0)}%`, kind: "key" }));
    const cl = (state?.column_lineage ?? []).map((e) => ({ from: e.from, to: e.to, label: e.via || e.kind, kind: e.kind }));
    return [...rel, ...cl];
  }, [state?.relationships, state?.column_lineage]);

  const impact = useMemo(() => {
    if (!dsId || !col) return null;
    const root = key({ dataset_id: dsId, column: col });
    const fwd = new Map<string, NodeRef[]>();
    const bwd = new Map<string, NodeRef[]>();
    for (const e of edges) {
      const fk = key(e.from), tk = key(e.to);
      (fwd.get(fk) ?? fwd.set(fk, []).get(fk)!).push(e.to);
      (bwd.get(tk) ?? bwd.set(tk, []).get(tk)!).push(e.from);
    }
    const bfs = (start: string, adj: Map<string, NodeRef[]>) => {
      const seen = new Set([start]);
      const order: NodeRef[] = [];
      let frontier = [start];
      while (frontier.length) {
        const next: string[] = [];
        for (const cur of frontier) {
          for (const n of adj.get(cur) ?? []) {
            const k = key(n);
            if (!seen.has(k)) { seen.add(k); order.push(n); next.push(k); }
          }
        }
        frontier = next;
      }
      return order;
    };
    const downstream = bfs(root, fwd);
    const upstream = bfs(root, bwd);
    const nodeIds = [root, ...downstream.map(key), ...upstream.map(key)];
    const uniqueIds = [...new Set(nodeIds)];
    const relevantEdges = edges
      .filter((e) => uniqueIds.includes(key(e.from)) && uniqueIds.includes(key(e.to)))
      .map((e) => ({ from: key(e.from), to: key(e.to), label: e.label }));
    const layout = buildLayout(uniqueIds, relevantEdges, { nodeW: 190, nodeH: 40, gapX: 240 });
    return { root, downstream, upstream, layout, edges: relevantEdges };
  }, [dsId, col, edges]);

  const nodeLabel = (id: string) => {
    const [ds, c] = id.split("::");
    return { table: shortDs(ds), col: c };
  };

  const addEdge = async () => {
    if (!toDs || !toCol) { toast("err", "Pick a target column"); return; }
    await mutate((v) => api.addColumnLineage({
      from_dataset_id: dsId, from_column: col, to_dataset_id: toDs, to_column: toCol, via, kind: "derived",
    }, v));
    toast("ok", "Lineage edge added ✓");
    setAddOpen(false); setToDs(""); setToCol(""); setVia("");
  };

  if (datasets.length === 0) {
    return <EmptyState icon={<Route size={48} />} title="Nothing to analyse yet" hint="Profile a connection first." />;
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <Route size={18} className="text-loom-500" />
        <select value={dsId} onChange={(e) => { setDsId(e.target.value); setCol(""); }} className="input max-w-xs !py-1.5 text-sm">
          {datasets.map((d) => <option key={d.id} value={d.id}>{d.schema}.{d.name}</option>)}
        </select>
        <select value={col} onChange={(e) => setCol(e.target.value)} className="input max-w-xs !py-1.5 text-sm font-mono">
          <option value="">Select column…</option>
          {activeDs?.columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <button onClick={() => setAddOpen((v) => !v)} className="btn-outline ml-auto text-xs">
          <Plus size={13} /> Add manual lineage edge
        </button>
      </div>

      {addOpen && (
        <div className="card flex flex-wrap items-end gap-2 p-4">
          <span className="text-xs text-slate-400">From <b className="font-mono">{shortDs(dsId)}.{col}</b> derives →</span>
          <select value={toDs} onChange={(e) => { setToDs(e.target.value); setToCol(""); }} className="input !py-1.5 text-xs">
            <option value="">Target table…</option>
            {datasets.map((d) => <option key={d.id} value={d.id}>{d.schema}.{d.name}</option>)}
          </select>
          <select value={toCol} onChange={(e) => setToCol(e.target.value)} className="input !py-1.5 text-xs font-mono">
            <option value="">Target column…</option>
            {datasets.find((d) => d.id === toDs)?.columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
          <input value={via} onChange={(e) => setVia(e.target.value)} placeholder="via (e.g. ETL job name)" className="input !py-1.5 text-xs" />
          <button onClick={addEdge} className="btn-primary text-xs">Add</button>
        </div>
      )}

      {!impact || !col ? (
        <EmptyState icon={<Workflow size={44} />} title="Pick a column" hint="Choose a table and column above to trace its impact." />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="card flex items-center gap-3 p-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-rose-500/10 text-rose-500"><AlertTriangle size={18} /></div>
              <div>
                <div className="text-2xl font-bold">{impact.downstream.length}</div>
                <div className="text-xs text-slate-400">
                  downstream column(s) across {new Set(impact.downstream.map((n) => n.dataset_id)).size} table(s) would be affected by a change
                </div>
              </div>
            </div>
            <div className="card flex items-center gap-3 p-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-loom-500/10 text-loom-500"><Route size={18} /></div>
              <div>
                <div className="text-2xl font-bold">{impact.upstream.length}</div>
                <div className="text-xs text-slate-400">
                  upstream source(s) across {new Set(impact.upstream.map((n) => n.dataset_id)).size} table(s) feed into this column
                </div>
              </div>
            </div>
          </div>

          {/* graph */}
          <div className="card overflow-auto p-4">
            <svg width={Math.max(...Object.values(impact.layout.nodes).map((n) => n.x + n.w), 400) + 40}
              height={impact.layout.height} className="min-w-full">
              <defs>
                <marker id="impact-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" fill="#8b93a8" />
                </marker>
              </defs>
              {impact.edges.map((e, i) => {
                const a = impact.layout.nodes[e.from], b = impact.layout.nodes[e.to];
                if (!a || !b) return null;
                const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
                const mx = (x1 + x2) / 2;
                return (
                  <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                    fill="none" stroke="#8b93a8" strokeOpacity={0.5} strokeWidth={1.5} markerEnd="url(#impact-arrow)" />
                );
              })}
              {Object.entries(impact.layout.nodes).map(([id, pos]) => {
                const { table, col: c } = nodeLabel(id);
                const isRoot = id === impact.root;
                const isDown = impact.downstream.some((n) => key(n) === id);
                const color = isRoot ? "#009f3d" : isDown ? "#f43f5e" : "#ff6600";
                return (
                  <g key={id} transform={`translate(${pos.x},${pos.y})`}>
                    <rect width={pos.w} height={pos.h} rx={8} fill={isRoot ? "#009f3d15" : "#ffffff08"}
                      stroke={color} strokeWidth={isRoot ? 2 : 1.2} />
                    <text x={8} y={16} fontSize={11} fontWeight={600} fill={color}>{table}</text>
                    <text x={8} y={30} fontSize={10} fontFamily="monospace" className="fill-slate-400">{c}</text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ImpactList title="Upstream (feeds this column)" color="text-flame-500" items={impact.upstream} />
            <ImpactList title="Downstream (would be affected)" color="text-rose-500" items={impact.downstream} />
          </div>
        </>
      )}
    </div>
  );
}

function ImpactList({ title, color, items }: { title: string; color: string; items: NodeRef[] }) {
  return (
    <div className="card p-4">
      <div className={`mb-2 text-xs font-semibold uppercase tracking-wide ${color}`}>{title} ({items.length})</div>
      {items.length === 0 ? (
        <div className="text-xs text-slate-400">None found.</div>
      ) : (
        <div className="max-h-48 space-y-1 overflow-auto">
          {items.map((n, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs">
              <ArrowRight size={11} className="shrink-0 text-slate-400" />
              <span className="font-mono text-slate-500">{shortDs(n.dataset_id)}.</span>
              <span className="font-mono font-semibold">{n.column}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
