import { useEffect, useMemo, useState } from "react";
import {
  Plug, Sparkles, Loader2, RotateCcw, Code2, FileCode, Table2, Link2, Check, X, Plus,
  ChevronDown, ChevronUp, Trash2, ArrowRight, Gauge, Wrench, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { useCatalog } from "../store";
import { api } from "../api";
import { EmptyState, timeAgo } from "../lib/ui";
import { useConfirm } from "../components/ConfirmDialog";
import type { Connection, McpCoverageGap, McpMappingTable, McpQueryDef, McpTool } from "../types";
import type { Tab } from "../App";

function mappingTables(conn: Connection): McpMappingTable[] {
  return (conn.config?.mcp_mapping as { tables?: McpMappingTable[] } | undefined)?.tables ?? [];
}

function mappedDatasetId(conn: Connection, tool: string): string | null {
  const t = mappingTables(conn).find((m) => m.tool === tool);
  if (!t) return null;
  return `${conn.id}::${t.schema || "MCP"}.${t.table_name}`;
}

const RECON_META: Record<string, { label: string; color: string; icon: typeof Check }> = {
  matches: { label: "confirmed by code", color: "text-emerald-500 bg-emerald-500/10", icon: CheckCircle2 },
  only_in_code: { label: "code has it, mapping missed it", color: "text-amber-500 bg-amber-500/10", icon: AlertTriangle },
  only_in_mapping: { label: "mapping has it, code doesn't", color: "text-rose-500 bg-rose-500/10", icon: AlertTriangle },
};

export function McpLibrary({ goto }: { goto: (t: Tab) => void }) {
  const { state, mutate, toast } = useCatalog();
  const { confirm, dialog } = useConfirm();
  const mcpConns = useMemo(() => (state?.connections ?? []).filter((c) => c.type === "mcp"), [state]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = mcpConns.find((c) => c.id === selectedId) ?? mcpConns[0] ?? null;

  const [tab, setTab] = useState<"tools" | "queries" | "coverage">("tools");
  const [addOpen, setAddOpen] = useState<string | null>(null); // tool name being documented, or "" for free pick
  const [refreshing, setRefreshing] = useState(false);
  const [coverage, setCoverage] = useState<McpCoverageGap[] | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { setTab("tools"); setCoverage(null); }, [selected?.id]);

  const loadCoverage = async () => {
    if (!selected) return;
    setCoverageLoading(true);
    try {
      const r = await api.mcpCoverage(selected.id);
      setCoverage(r.gaps);
    } catch (e) { toast("err", (e as Error).message); }
    finally { setCoverageLoading(false); }
  };

  const rediscover = async () => {
    if (!selected) return;
    setRefreshing(true);
    try {
      await mutate((v) => api.mcpRefreshTools(selected.id, v));
      toast("ok", "Tool inventory refreshed");
    } finally { setRefreshing(false); }
  };

  const deleteQuery = async (qid: string) => {
    if (!selected) return;
    const ok = await confirm({
      title: "Remove this query definition?",
      message: "The pasted code/SQL and its extracted description will be deleted. This can't be undone.",
      tone: "danger", steps: 1, confirmLabel: "Remove",
    });
    if (!ok) return;
    await mutate((v) => api.mcpDeleteQuery(selected.id, qid, v));
  };

  const reextract = async (qid: string) => {
    if (!selected) return;
    await mutate((v) => api.mcpReextractQuery(selected.id, qid, v));
    toast("ok", "Re-extracted with AI ✨");
  };

  const addLink = async (fromId: string, toId: string, via: string) => {
    const r = await mutate((v) => api.addLineageEdge({ from_id: fromId, to_id: toId, via, kind: "mapping", confidence: 80 }, v));
    if (r) toast("ok", "Lineage link added — see Lineage / Impact Analysis");
  };

  if (mcpConns.length === 0) {
    return (
      <EmptyState icon={<Plug size={48} />} title="No MCP sources yet"
        hint={<>Add an <b>MCP source</b> connection first, then come back here to browse its tools, document
          the real queries behind them, and link them to the rest of your catalog.
          <button onClick={() => goto("connections")} className="mt-3 block text-loom-500 underline">
            Go to Connections
          </button></>} />
    );
  }

  const tools: McpTool[] = selected?.mcp_tools ?? [];
  const mapped = selected ? new Set(mappingTables(selected).map((t) => t.tool)) : new Set<string>();
  const queried = selected ? new Set((selected.mcp_queries ?? []).map((q) => q.tool)) : new Set<string>();
  const datasetIds = new Set((state?.datasets ?? []).map((d) => d.id));

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      {/* sources list */}
      <div className="space-y-2">
        <p className="px-1 text-xs text-slate-400">
          Every referenced MCP server — its tool surface, mapped tables, and documented queries.
        </p>
        {mcpConns.map((c) => {
          const t = c.mcp_tools?.length ?? 0;
          const m = mappingTables(c).length;
          const q = c.mcp_queries?.length ?? 0;
          const active = selected?.id === c.id;
          return (
            <button key={c.id} onClick={() => setSelectedId(c.id)}
              className={`card w-full p-3 text-left transition-colors ${active ? "border-loom-500 bg-loom-500/5" : ""}`}>
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-cyan-500/10 text-cyan-500">
                  <Plug size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{c.name}</div>
                  <div className="text-[11px] text-slate-400">
                    {t} tool{t === 1 ? "" : "s"} · {m} mapped · {q} documented
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* detail */}
      {!selected ? (
        <div className="card p-6 text-sm text-slate-400">Select a source.</div>
      ) : (
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{selected.name}</h2>
            {selected.mcp_tools_at && (
              <span className="text-[11px] text-slate-400">inventory refreshed {timeAgo(selected.mcp_tools_at)} ago</span>
            )}
            <button onClick={rediscover} disabled={refreshing} className="btn-outline ml-auto text-xs">
              {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Rediscover tools
            </button>
          </div>

          <div className="flex gap-1.5 border-b border-slate-200 dark:border-slate-800">
            {([
              ["tools", `Tools (${tools.length})`],
              ["queries", `Queries (${selected.mcp_queries?.length ?? 0})`],
              ["coverage", "Coverage"],
            ] as const).map(([id, label]) => (
              <button key={id} onClick={() => { setTab(id); if (id === "coverage" && !coverage) loadCoverage(); }}
                className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                  tab === id ? "border-loom-500 text-loom-600 dark:text-loom-300" : "border-transparent text-slate-400 hover:text-slate-600"}`}>
                {label}
              </button>
            ))}
          </div>

          {tab === "tools" && (
            <div className="space-y-1.5">
              {tools.length === 0 ? (
                <EmptyState icon={<Wrench size={40} />} title="No tools discovered yet"
                  hint="Click Rediscover tools above to list the server's full tool surface." />
              ) : tools.map((t) => {
                const isMapped = mapped.has(t.name);
                const isQueried = queried.has(t.name);
                return (
                  <div key={t.name} className="card flex items-start gap-3 p-3">
                    <Wrench size={15} className="mt-0.5 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs font-semibold">{t.name}</span>
                        {isMapped && <span className="chip bg-emerald-500/10 text-emerald-500"><Table2 size={10} /> mapped</span>}
                        {isQueried && <span className="chip bg-loom-500/10 text-loom-500"><FileCode size={10} /> documented</span>}
                      </div>
                      {t.description && <div className="mt-0.5 text-xs text-slate-500">{t.description}</div>}
                    </div>
                    <button onClick={() => setAddOpen(t.name)} className="btn-ai-outline shrink-0 text-xs">
                      <Plus size={13} /> Add code/SQL
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "queries" && (
            <div className="space-y-2">
              {(selected.mcp_queries ?? []).length === 0 ? (
                <EmptyState icon={<FileCode size={40} />} title="No query definitions yet"
                  hint="Open a tool in the Tools tab and click Add code/SQL — the local LLM will read it and describe what it actually does." />
              ) : (selected.mcp_queries ?? []).slice().reverse().map((q) => (
                <QueryCard key={q.id} q={q} conn={selected} datasetIds={datasetIds}
                  expanded={expanded === q.id} onToggle={() => setExpanded(expanded === q.id ? null : q.id)}
                  onDelete={() => deleteQuery(q.id)} onReextract={() => reextract(q.id)} onAddLink={addLink} />
              ))}
              <button onClick={() => setAddOpen("")} className="btn-ai-outline text-xs">
                <Plus size={13} /> Add code/SQL for a tool
              </button>
            </div>
          )}

          {tab === "coverage" && (
            <div className="space-y-1.5">
              <p className="text-xs text-slate-400">
                Tools ranked by how much they'd add to catalog coverage if you documented them next.
              </p>
              {coverageLoading ? (
                <div className="flex items-center gap-2 py-6 text-sm text-slate-400">
                  <Loader2 size={15} className="animate-spin" /> Computing coverage…
                </div>
              ) : !coverage || coverage.length === 0 ? (
                <div className="card p-4 text-center text-sm text-emerald-500">
                  <Gauge size={20} className="mx-auto mb-1" /> Every tool is either mapped and documented, or fully covered.
                </div>
              ) : coverage.map((g) => (
                <div key={g.tool} className="card flex items-start gap-3 p-3">
                  <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-amber-500/10 text-[11px] font-bold text-amber-500">
                    {g.priority}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold">{g.tool}</span>
                      {g.has_mapping && <span className="chip bg-emerald-500/10 text-emerald-500">mapped</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">{g.reason}</div>
                  </div>
                  <button onClick={() => setAddOpen(g.tool)} className="btn-ai-outline shrink-0 text-xs">
                    <Plus size={13} /> Document
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {addOpen !== null && selected && (
        <AddQueryModal conn={selected} defaultTool={addOpen} tools={tools}
          onClose={() => setAddOpen(null)}
          onDone={() => { setAddOpen(null); setTab("queries"); }} />
      )}
      {dialog}
    </div>
  );
}

function QueryCard({ q, conn, datasetIds, expanded, onToggle, onDelete, onReextract, onAddLink }: {
  q: McpQueryDef; conn: Connection; datasetIds: Set<string>; expanded: boolean;
  onToggle: () => void; onDelete: () => void; onReextract: () => void;
  onAddLink: (fromId: string, toId: string, via: string) => void;
}) {
  const dsId = mappedDatasetId(conn, q.tool);
  const dsExists = !!dsId && datasetIds.has(dsId);
  const ex = q.extraction;
  return (
    <div className="card overflow-hidden">
      <button onClick={onToggle} className="flex w-full items-center gap-2.5 p-3 text-left">
        {q.language === "sql" ? <Code2 size={15} className="shrink-0 text-loom-500" /> : <FileCode size={15} className="shrink-0 text-loom-500" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{q.title}</div>
          <div className="text-[11px] text-slate-400">
            {q.tool} · {q.language} · added {timeAgo(q.created_at)} ago
            {q.extracted_at ? ` · extracted ${timeAgo(q.extracted_at)} ago` : ""}
          </div>
        </div>
        {expanded ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-slate-200 p-3 dark:border-slate-800">
          <pre className="max-h-40 overflow-auto rounded-lg bg-slate-100 p-2.5 text-[11px] leading-relaxed dark:bg-slate-800/60">{q.code}</pre>

          {!ex ? (
            <div className="text-xs text-slate-400">No extraction yet.</div>
          ) : (
            <>
              <p className="text-sm">{ex.functional_description}</p>

              {ex.tables_referenced.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {ex.tables_referenced.map((t, i) => (
                    <span key={i} className={`chip ${t.role === "target" ? "bg-violet-500/10 text-violet-500" : "bg-slate-500/10 text-slate-400"}`}>
                      <Table2 size={10} /> {t.name} · {t.role}
                    </span>
                  ))}
                </div>
              )}

              {ex.columns.length > 0 && (
                <div className="space-y-1">
                  {ex.columns.map((c, i) => (
                    <div key={i} className="text-xs">
                      <span className="font-mono font-semibold">{c.name}</span>
                      <span className="text-slate-500"> — {c.description}</span>
                      {c.source_expression && <span className="text-slate-400"> ({c.source_expression})</span>}
                    </div>
                  ))}
                </div>
              )}

              {ex.column_reconciliation.length > 0 && (
                <div className="space-y-1 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Mapping reconciliation</div>
                  {ex.column_reconciliation.map((r, i) => {
                    const meta = RECON_META[r.status] ?? RECON_META.matches;
                    const Icon = meta.icon;
                    return (
                      <div key={i} className="flex items-start gap-1.5 text-xs">
                        <span className={`chip shrink-0 ${meta.color}`}><Icon size={10} /> {r.column}</span>
                        <span className="text-slate-500">{meta.label}{r.note ? ` — ${r.note}` : ""}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {ex.link_candidates.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Suggested links to other databases</div>
                  {ex.link_candidates.map((lc, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <Link2 size={12} className="shrink-0 text-loom-500" />
                      <span className="font-mono">{lc.matched_table}</span>
                      <ArrowRight size={11} className="shrink-0 text-slate-400" />
                      <span className="font-mono">{lc.label}</span>
                      <span className="chip bg-slate-500/10 text-slate-400">{Math.round(lc.score * 100)}%</span>
                      <button disabled={!dsExists}
                        title={!dsExists ? "Map & run the pipeline for this tool first so it becomes a catalog table" : undefined}
                        onClick={() => dsId && onAddLink(lc.dataset_id, dsId, lc.matched_table)}
                        className="btn-ai-outline ml-auto !py-0.5 !px-2 text-[11px]">
                        <Plus size={11} /> Add link
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onReextract} className="btn-ai-outline text-xs"><Sparkles size={12} /> Re-extract</button>
            <button onClick={onDelete} className="btn-outline ml-auto text-xs text-rose-500"><Trash2 size={12} /> Remove</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddQueryModal({ conn, defaultTool, tools, onClose, onDone }: {
  conn: Connection; defaultTool: string; tools: McpTool[]; onClose: () => void; onDone: () => void;
}) {
  const { mutate, toast } = useCatalog();
  const [tool, setTool] = useState(defaultTool);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<"sql" | "code">("sql");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!tool.trim() || !code.trim()) { toast("err", "Pick a tool and paste some code/SQL"); return; }
    setBusy(true);
    try {
      const r = await mutate((v) => api.mcpAddQuery(conn.id, { tool: tool.trim(), title, language, code }, v));
      if (r) { toast("ok", "Extracted with AI ✨"); onDone(); }
    } catch (e) {
      toast("err", (e as Error).message.includes("503") ? "Local LLM unavailable" : "Extraction failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <Sparkles size={18} className="text-loom-500" />
          <h3 className="font-semibold">Document a tool with code/SQL</h3>
          <button onClick={onClose} className="btn-ghost ml-auto !p-1"><X size={16} /></button>
        </div>
        <div className="space-y-3 overflow-auto">
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-500">Tool</span>
            <select className="input" value={tool} onChange={(e) => setTool(e.target.value)}>
              <option value="">— choose a tool —</option>
              {tools.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-500">Title (optional)</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tool || "e.g. Orders export query"} />
          </label>
          <div className="flex gap-1.5">
            {(["sql", "code"] as const).map((l) => (
              <button key={l} onClick={() => setLanguage(l)}
                className={`btn text-xs !py-1 !px-2.5 ${language === l ? "btn-primary" : "btn-outline"}`}>
                {l === "sql" ? <><Code2 size={13} /> SQL</> : <><FileCode size={13} /> Code</>}
              </button>
            ))}
          </div>
          <textarea className="input min-h-[180px] font-mono text-xs" value={code} onChange={(e) => setCode(e.target.value)}
            placeholder={language === "sql"
              ? "SELECT o.id, o.customer_id, c.name AS customer_name\nFROM orders o JOIN customers c ON c.id = o.customer_id\nWHERE o.status = 'open'"
              : "def list_orders():\n    return db.query(Order).join(Customer).filter(Order.status == 'open').all()"} />
          <p className="text-[11px] text-slate-400">
            The local LLM reads this to describe what the query does, which tables/columns it really
            touches, and — if this tool is already mapped — flags any drift against the mapped columns.
          </p>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="btn-outline">Cancel</button>
          <button onClick={submit} disabled={busy} className="btn-ai">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Extract with AI
          </button>
        </div>
      </div>
    </div>
  );
}
