import { useEffect, useMemo, useState } from "react";
import {
  Waypoints, Search, ZoomIn, ZoomOut, Maximize2, ChevronsUpDown, ChevronsDownUp,
  Database, Table2, Plug, Wrench, X, KeyRound, Lock, Filter,
} from "lucide-react";
import { useCatalog } from "../store";
import { buildLayout } from "../lib/graphLayout";
import { useZoomPan } from "../lib/useZoomPan";
import { EmptyState, healthColor, semanticColor } from "../lib/ui";
import type { Connection, Dataset, McpMappingTable } from "../types";

type NodeKind = "connection" | "dataset" | "tool";
interface GNode { id: string; kind: NodeKind; label: string; sub: string; color?: string; count?: number; }
interface GEdge { from: string; to: string; kind: string; }

const EDGE_COLOR: Record<string, string> = {
  key: "#009f3d", mapping: "#ff6600", manual: "#10b981", contains: "#94a3b8", tool: "#06b6d4", datamart: "#8b5cf6",
};
const EDGE_LABEL: Record<string, string> = {
  key: "key relationship", mapping: "ETL mapping", manual: "manual lineage", contains: "contains",
  tool: "MCP tool", datamart: "datamart",
};
const CONN_ICON: Record<string, typeof Database> = { mcp: Plug };
const COLLAPSE_THRESHOLD = 6;

function mappingTables(conn: Connection): McpMappingTable[] {
  return (conn.config?.mcp_mapping as { tables?: McpMappingTable[] } | undefined)?.tables ?? [];
}

function avgQuality(d: Dataset): number {
  if (d.columns.length === 0) return 100;
  return d.columns.reduce((s, c) => s + c.profile.quality_score, 0) / d.columns.length;
}

export function CatalogGraph() {
  const { state } = useCatalog();
  const connections = state?.connections ?? [];
  const datasets = state?.datasets ?? [];

  const [scopeConn, setScopeConn] = useState<Set<string> | null>(null); // null = all
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(connections.filter((c) => datasets.filter((d) => d.connection_id === c.id).length > COLLAPSE_THRESHOLD).map((c) => c.id)));
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [q, setQ] = useState("");
  const { containerRef, transform, onMouseDown, onMouseMove, onMouseUp, zoomIn, zoomOut, fit } = useZoomPan();

  const inScope = (cid: string) => !scopeConn || scopeConn.has(cid);

  // -- build nodes -- //
  const { nodes, edges, byId } = useMemo(() => {
    const nodeMap = new Map<string, GNode>();
    const rawEdges: GEdge[] = [];
    const dsById = new Map(datasets.map((d) => [d.id, d]));
    const mappedToolNames = new Map<string, Set<string>>(); // connection_id -> tool names already a table

    for (const c of connections) {
      if (!inScope(c.id)) continue;
      const dsOfConn = datasets.filter((d) => d.connection_id === c.id);
      const isCollapsed = collapsed.has(c.id) && dsOfConn.length > 0;
      nodeMap.set(`conn:${c.id}`, {
        id: `conn:${c.id}`, kind: "connection", label: c.name,
        sub: isCollapsed ? `${dsOfConn.length} tables (collapsed)` : c.type, count: dsOfConn.length,
      });
      if (!isCollapsed) {
        for (const d of dsOfConn) {
          const isDatamart = (state?.docs[d.id]?.tags ?? []).includes("datamart");
          nodeMap.set(d.id, {
            id: d.id, kind: "dataset", label: d.name, sub: isDatamart ? `${d.schema} · datamart` : d.schema,
            color: healthColor(avgQuality(d)),
          });
          rawEdges.push({ from: `conn:${c.id}`, to: d.id, kind: "contains" });
        }
        if (c.type === "mcp") {
          const mapped = new Set(mappingTables(c).map((t) => t.tool));
          mappedToolNames.set(c.id, mapped);
          for (const t of c.mcp_tools ?? []) {
            if (mapped.has(t.name)) continue; // already represented by its dataset node
            const tid = `tool:${c.id}:${t.name}`;
            nodeMap.set(tid, { id: tid, kind: "tool", label: t.name, sub: "MCP tool (unmapped)" });
            rawEdges.push({ from: `conn:${c.id}`, to: tid, kind: "tool" });
          }
        }
      }
    }

    // resolve a dataset id to whatever node currently represents it (itself, or its collapsed connection cluster)
    const resolve = (dsId: string): string | null => {
      const d = dsById.get(dsId);
      if (!d) return null;
      if (!inScope(d.connection_id)) return null;
      return collapsed.has(d.connection_id) ? `conn:${d.connection_id}` : dsId;
    };

    for (const r of state?.relationships ?? []) {
      const a = resolve(r.child.dataset_id), b = resolve(r.parent.dataset_id);
      if (a && b && a !== b) rawEdges.push({ from: b, to: a, kind: "key" });
    }
    for (const l of state?.lineage ?? []) {
      const a = resolve(l.from), b = resolve(l.to);
      if (a && b && a !== b) rawEdges.push({ from: a, to: b, kind: l.kind === "mapping" || l.kind === "datamart" ? l.kind : "manual" });
    }

    // dedupe parallel edges between the same resolved pair+kind
    const seen = new Set<string>();
    const edges = rawEdges.filter((e) => {
      if (hiddenKinds.has(e.kind)) return false;
      const key = `${e.from}|${e.to}|${e.kind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return { nodes: [...nodeMap.values()], edges, byId: nodeMap };
  }, [connections, datasets, state?.relationships, state?.lineage, state?.docs, scopeConn, collapsed, hiddenKinds]);

  const layout = useMemo(
    () => buildLayout(nodes.map((n) => n.id), edges, { nodeW: 168, nodeH: 46, gapX: 220, gapY: 14 }),
    [nodes, edges]);

  const W = useMemo(() => Math.max(600, ...nodes.map((n) => (layout.nodes[n.id]?.x ?? 0) + 168 + 40)), [nodes, layout]);
  const H = Math.max(400, layout.height);

  useEffect(() => { fit(W, H); }, [W, H, fit]); // eslint-disable-line react-hooks/exhaustive-deps

  const neighborIds = useMemo(() => {
    if (!selected || !focusMode) return null;
    const s = new Set<string>([selected]);
    for (const e of edges) {
      if (e.from === selected) s.add(e.to);
      if (e.to === selected) s.add(e.from);
    }
    return s;
  }, [selected, focusMode, edges]);

  const matchId = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return null;
    const hit = nodes.find((n) => n.label.toLowerCase().includes(term) || n.sub.toLowerCase().includes(term));
    return hit?.id ?? null;
  }, [q, nodes]);

  useEffect(() => {
    if (matchId) setSelected(matchId);
  }, [matchId]);

  const toggleScope = (cid: string) => setScopeConn((s) => {
    const next = new Set(s ?? connections.map((c) => c.id));
    if (next.has(cid)) next.delete(cid); else next.add(cid);
    return next;
  });
  const toggleCollapse = (cid: string) => setCollapsed((s) => {
    const n = new Set(s);
    if (n.has(cid)) n.delete(cid); else n.add(cid);
    return n;
  });
  const toggleKind = (k: string) => setHiddenKinds((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  const selectedDataset = selected ? datasets.find((d) => d.id === selected) : null;
  const selectedConn = selected?.startsWith("conn:") ? connections.find((c) => c.id === selected.slice(5)) : null;

  if (connections.length === 0) {
    return <EmptyState icon={<Waypoints size={48} />} title="Nothing to graph yet"
      hint="Add a connection and run the pipeline — every table, MCP tool and relationship will show up here." />;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr_300px]">
      {/* scope panel */}
      <div className="space-y-3">
        <div className="card p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <Filter size={12} /> Scope: sources
          </div>
          <div className="space-y-1">
            {connections.map((c) => {
              const on = inScope(c.id);
              const dsCount = datasets.filter((d) => d.connection_id === c.id).length;
              return (
                <label key={c.id} className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={on} onChange={() => toggleScope(c.id)} />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <button onClick={() => toggleCollapse(c.id)} title={collapsed.has(c.id) ? "Expand" : "Collapse"}
                    className="shrink-0 text-slate-400 hover:text-loom-500" disabled={dsCount === 0}>
                    {collapsed.has(c.id) ? <ChevronsUpDown size={12} /> : <ChevronsDownUp size={12} />}
                  </button>
                </label>
              );
            })}
          </div>
        </div>
        <div className="card p-3">
          <div className="mb-2 text-xs font-semibold text-slate-500">Relationship types</div>
          <div className="space-y-1">
            {Object.entries(EDGE_LABEL).map(([k, label]) => (
              <label key={k} className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={!hiddenKinds.has(k)} onChange={() => toggleKind(k)} />
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: EDGE_COLOR[k] }} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div className="card p-3 text-[11px] text-slate-500">
          <div className="mb-1 font-semibold text-slate-400">Node color = data quality</div>
          <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> healthy (≥80)</div>
          <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" /> needs review (50-79)</div>
          <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-500" /> at risk (&lt;50)</div>
        </div>
      </div>

      {/* graph canvas */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
          <Waypoints size={16} className="text-loom-500" />
          <span className="text-sm font-semibold">Catalog Graph</span>
          <div className="relative ml-2 max-w-[220px] flex-1">
            <Search size={12} className="pointer-events-none absolute left-2 top-2 text-slate-400" />
            <input className="input !py-1 pl-6 text-xs" placeholder="Find a table, tool, source…"
              value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {selected && (
            <label className="flex items-center gap-1 text-[11px] text-slate-500">
              <input type="checkbox" checked={focusMode} onChange={(e) => setFocusMode(e.target.checked)} />
              Isolate neighborhood
            </label>
          )}
          <div className="ml-auto flex items-center gap-1">
            <button onClick={zoomOut} className="btn-ghost !p-1.5" title="Zoom out"><ZoomOut size={14} /></button>
            <button onClick={zoomIn} className="btn-ghost !p-1.5" title="Zoom in"><ZoomIn size={14} /></button>
            <button onClick={() => fit(W, H)} className="btn-ghost !p-1.5" title="Fit to view"><Maximize2 size={14} /></button>
          </div>
        </div>
        <div ref={containerRef}
          className="relative h-[560px] w-full cursor-grab overflow-hidden bg-grid active:cursor-grabbing"
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
          <svg width="100%" height="100%">
            <g transform={`translate(${transform.tx},${transform.ty}) scale(${transform.scale})`}>
              <defs>
                {Object.entries(EDGE_COLOR).map(([k, c]) => (
                  <marker key={k} id={`cg-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5"
                    markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill={c} />
                  </marker>
                ))}
              </defs>
              {edges.map((e, i) => {
                const a = layout.nodes[e.from], b = layout.nodes[e.to];
                if (!a || !b) return null;
                const dim = neighborIds && !(neighborIds.has(e.from) && neighborIds.has(e.to));
                const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
                const mx = (x1 + x2) / 2;
                return (
                  <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                    fill="none" stroke={EDGE_COLOR[e.kind]} strokeWidth={e.kind === "contains" ? 1 : 1.6}
                    strokeDasharray={e.kind === "contains" ? "3,3" : undefined}
                    markerEnd={e.kind === "contains" ? undefined : `url(#cg-arrow-${e.kind})`}
                    opacity={dim ? 0.08 : 0.6} />
                );
              })}
              {nodes.map((n) => {
                const pos = layout.nodes[n.id];
                if (!pos) return null;
                const dim = neighborIds && !neighborIds.has(n.id);
                const Icon = n.kind === "connection" ? (CONN_ICON[connections.find((c) => `conn:${c.id}` === n.id)?.type ?? ""] ?? Database)
                  : n.kind === "tool" ? Wrench : Table2;
                const isSel = selected === n.id;
                return (
                  <g key={n.id} transform={`translate(${pos.x},${pos.y})`} opacity={dim ? 0.15 : 1}
                    onClick={() => setSelected(n.id)} style={{ cursor: "pointer" }}>
                    <rect width={pos.w} height={pos.h} rx={9}
                      className={isSel ? "fill-loom-500/15" : "fill-white dark:fill-slate-800"}
                      stroke={n.kind === "dataset" ? (n.color ?? "#94a3b8") : isSel ? "#009f3d" : "#94a3b8"}
                      strokeWidth={isSel ? 2.5 : n.kind === "dataset" ? 2 : 1.3} />
                    <foreignObject x={6} y={5} width={16} height={16}>
                      <Icon size={13} className="text-slate-400" />
                    </foreignObject>
                    <text x={26} y={19} className="fill-slate-700 text-[11px] font-semibold dark:fill-slate-100">
                      {n.label.length > 20 ? n.label.slice(0, 19) + "…" : n.label}
                    </text>
                    <text x={26} y={34} className="fill-slate-400 text-[9px]">{n.sub}</text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
        <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400 dark:border-slate-800/60">
          {nodes.length} node(s) · {edges.length} edge(s) · scroll to zoom, drag to pan
        </div>
      </div>

      {/* detail panel */}
      <div className="space-y-3">
        {selectedDataset ? (
          <div className="card p-4 animate-fade-in">
            <div className="flex items-center gap-2">
              <Table2 size={15} className="text-loom-500" />
              <span className="min-w-0 truncate font-semibold">{selectedDataset.name}</span>
              <button onClick={() => setSelected(null)} className="btn-ghost ml-auto !p-1"><X size={14} /></button>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">
              {selectedDataset.schema} · {connections.find((c) => c.id === selectedDataset.connection_id)?.name ?? "—"} ·
              {" "}~{selectedDataset.row_estimate.toLocaleString()} rows
            </div>
            {state?.docs[selectedDataset.id]?.definition && (
              <p className="mt-1.5 text-xs text-slate-500">{state.docs[selectedDataset.id].definition}</p>
            )}
            <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-slate-100 dark:border-slate-800">
              {selectedDataset.columns.map((c) => (
                <div key={c.name} className="flex items-center gap-1.5 border-b border-slate-100 px-2 py-1 text-[11px] last:border-0 dark:border-slate-800/60">
                  {c.profile.is_key_candidate && <KeyRound size={9} className="shrink-0 text-amber-500" />}
                  <span className="truncate font-mono">{c.name}</span>
                  {c.profile.sensitivity === "PII" && <Lock size={9} className="shrink-0 text-rose-400" />}
                  <span className={`chip ml-auto shrink-0 ${semanticColor(c.profile.semantic_type)}`}>{c.profile.semantic_type}</span>
                </div>
              ))}
            </div>
          </div>
        ) : selectedConn ? (
          <div className="card p-4 animate-fade-in">
            <div className="flex items-center gap-2">
              <Plug size={15} className="text-loom-500" />
              <span className="min-w-0 truncate font-semibold">{selectedConn.name}</span>
              <button onClick={() => setSelected(null)} className="btn-ghost ml-auto !p-1"><X size={14} /></button>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">{selectedConn.type} connection</div>
            <div className="mt-2 text-xs text-slate-500">
              {datasets.filter((d) => d.connection_id === selectedConn.id).length} table(s)
              {selectedConn.type === "mcp" && <> · {selectedConn.mcp_tools?.length ?? 0} MCP tool(s)</>}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              This source is collapsed to keep the graph readable — click the
              <ChevronsUpDown size={10} className="mx-0.5 inline" /> icon in the scope panel to expand it.
            </p>
          </div>
        ) : (
          <div className="card p-4 text-xs text-slate-400">
            Click a node to inspect it. Search finds and selects a match anywhere in the graph.
          </div>
        )}
      </div>
    </div>
  );
}
