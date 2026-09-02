import { useEffect, useState } from "react";
import {
  Database, Plus, Trash2, Zap, Server, Boxes, FlaskConical, Cpu, Check, Package, Link2,
  Pencil, PlugZap, Loader2, CheckCircle2, XCircle, History, Plug, Sparkles, X, Table2, Hash,
} from "lucide-react";
import { useCatalog } from "../store";
import { api } from "../api";
import { EmptyState, timeAgo } from "../lib/ui";
import { useConfirm } from "../components/ConfirmDialog";
import type { Connection, McpMappingTable, McpTool } from "../types";
import type { Tab } from "../App";

const TYPE_META: Record<string, { label: string; icon: typeof Server; color: string }> = {
  demo:       { label: "Demo",             icon: FlaskConical, color: "text-violet-500 bg-violet-500/10" },
  oracle:     { label: "Oracle",           icon: Database,     color: "text-rose-500 bg-rose-500/10" },
  clickhouse: { label: "ClickHouse",       icon: Boxes,        color: "text-amber-500 bg-amber-500/10" },
  okf:        { label: "Frictionless/OKF", icon: Package,      color: "text-teal-500 bg-teal-500/10" },
  mcp:        { label: "MCP source",       icon: Plug,         color: "text-cyan-500 bg-cyan-500/10" },
};

type ConnType = "demo" | "oracle" | "clickhouse" | "okf" | "mcp";

export function Connections({ goto }: { goto: (t: Tab) => void }) {
  const { state, health, mutate, setActiveRun, toast } = useCatalog();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [mapping, setMapping] = useState<Connection | null>(null);
  const { confirm, dialog } = useConfirm();
  const [pinging, setPinging] = useState<Record<string, "busy" | "ok" | "fail">>({});

  const conns = state?.connections ?? [];
  const models = health?.llm.models ?? [];

  const launch = async (cid: string) => {
    const priorRun = state?.runs.find((r) => r.connection_id === cid);
    if (priorRun) {
      const ok = await confirm({
        title: "Already profiled",
        message: `This connection was already profiled ${timeAgo(priorRun.created_at)} ago. Re-running will re-scan the selected tables and may overwrite existing profiling data.`,
        tone: "warning", steps: 1, confirmLabel: "Run again",
      });
      if (!ok) return;
    }
    const r = await mutate((v) => api.launchRun(cid, null, v));
    if (r) { setActiveRun(r.run); goto("agents"); toast("info", "Pipeline started ✨"); }
  };

  const remove = async (cid: string) => {
    const c = conns.find((x) => x.id === cid);
    const dsCount = state?.datasets.filter((d) => d.connection_id === cid).length ?? 0;
    const ok = await confirm({
      title: "Delete this connection?",
      message: dsCount > 0
        ? `"${c?.name}" and its ${dsCount} table(s) will be permanently removed — including their definitions, tags, relationships, lineage and QA history. This can't be undone.`
        : `"${c?.name}" will be permanently removed. This can't be undone.`,
      tone: "danger", steps: dsCount > 0 ? 2 : 1, confirmLabel: "Delete",
    });
    if (!ok) return;
    await mutate((v) => api.deleteConnection(cid, v));
    toast("ok", "Connection removed");
  };

  const test = async (cid: string) => {
    setPinging((p) => ({ ...p, [cid]: "busy" }));
    try {
      const r = await api.pingConnection(cid);
      setPinging((p) => ({ ...p, [cid]: r.ok ? "ok" : "fail" }));
    } catch {
      setPinging((p) => ({ ...p, [cid]: "fail" }));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="max-w-2xl text-sm text-slate-500">
          Connect a warehouse, import a <b>Frictionless Data Package</b> (OKF / datapackage.json), or pull
          data from another application over <b>MCP</b>. Use <b>Demo</b> to explore with a synthetic dataset.
        </p>
        <button onClick={() => { setEditing(null); setShowForm((s) => !s); }} className="btn-primary">
          <Plus size={16} /> New connection
        </button>
      </div>

      {showForm && (
        <ConnectionForm mode="add" models={models}
          onDone={() => setShowForm(false)} />
      )}
      {editing && (
        <ConnectionForm mode="edit" initial={editing} models={models}
          onDone={() => setEditing(null)} />
      )}

      {conns.length === 0 && !showForm ? (
        <EmptyState icon={<Database size={48} />} title="No connections"
          hint={<>Create a <b>Demo</b> connection and run the pipeline, or connect a real warehouse.</>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {conns.map((c) => {
            const Mt = TYPE_META[c.type] ?? TYPE_META.oracle;
            const Icon = Mt.icon;
            const dsCount = state?.datasets.filter((d) => d.connection_id === c.id).length ?? 0;
            const lastRun = state?.runs.find((r) => r.connection_id === c.id);
            const pingState = pinging[c.id];
            const mcpTables = (c.config?.mcp_mapping as { tables?: McpMappingTable[] } | undefined)?.tables ?? [];
            const isMcp = c.type === "mcp";
            return (
              <div key={c.id} className="card group p-4">
                <div className="flex items-start gap-3">
                  <div className={`grid h-10 w-10 place-items-center rounded-lg ${Mt.color}`}>
                    <Icon size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{c.name}</div>
                    <div className="text-xs text-slate-400">
                      {Mt.label} · {isMcp ? `${mcpTables.length} mapped table(s)` : `${dsCount} tables`} · added {timeAgo(c.created_at)}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
                      <History size={11} />
                      {lastRun ? <>last run {timeAgo(lastRun.created_at)} ago</> : "never run"}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button onClick={() => { setShowForm(false); setEditing(c); }}
                      className="text-slate-400 hover:text-loom-500" title="Edit"><Pencil size={15} /></button>
                    <button onClick={() => remove(c.id)}
                      className="text-slate-400 hover:text-rose-500" title="Delete"><Trash2 size={16} /></button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => test(c.id)} className="btn-outline !px-2.5 text-xs" title="Test connection">
                    {pingState === "busy" ? <Loader2 size={13} className="animate-spin" /> :
                     pingState === "ok" ? <CheckCircle2 size={13} className="text-emerald-500" /> :
                     pingState === "fail" ? <XCircle size={13} className="text-rose-500" /> :
                     <PlugZap size={13} />}
                    Test
                  </button>
                  {isMcp && (
                    <button onClick={() => setMapping(c)}
                      className={`text-xs ${mcpTables.length > 0 ? "btn-danger" : "btn-ai"}`}>
                      <Sparkles size={13} /> {mcpTables.length > 0 ? "Remap with AI" : "Map with AI"}
                    </button>
                  )}
                  <button onClick={() => launch(c.id)} disabled={isMcp && mcpTables.length === 0}
                    title={isMcp && mcpTables.length === 0 ? "Map this MCP source with AI first" : undefined}
                    className={`flex-1 justify-center ${lastRun ? "btn-danger" : "btn-ai"}`}>
                    <Zap size={15} /> Run pipeline
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {mapping && <McpMappingModal conn={mapping} onClose={() => setMapping(null)} />}
      {dialog}
    </div>
  );
}

function ConnectionForm({ mode, initial, models, onDone }: {
  mode: "add" | "edit"; initial?: Connection; models: string[]; onDone: () => void;
}) {
  const { mutate, toast } = useCatalog();
  const [type] = useState<ConnType>((initial?.type as ConnType) ?? "demo");
  const [typeDraft, setTypeDraft] = useState<ConnType>((initial?.type as ConnType) ?? "demo");
  const [name, setName] = useState(initial?.name ?? "");
  const [flavor, setFlavor] = useState((initial?.config?.flavor as string) ?? "oracle");
  const [cfg, setCfg] = useState<Record<string, string>>(
    initial && initial.type !== "demo" && initial.type !== "okf"
      ? Object.fromEntries(Object.entries(initial.config)
          .filter(([k]) => k !== "mcp_mapping").map(([k, v]) => [k, String(v ?? "")]))
      : {});
  const [model, setModel] = useState(initial?.llm_model ?? "");
  const [okfMode, setOkfMode] = useState<"url" | "paste">("url");
  const [okfUrl, setOkfUrl] = useState((initial?.config?.url as string) ?? "");
  const [okfJson, setOkfJson] = useState(
    initial?.config?.content ? JSON.stringify(initial.config.content, null, 2) : "");

  const effectiveType = mode === "edit" ? type : typeDraft;

  const submit = async () => {
    let config: Record<string, unknown> = {};
    if (effectiveType === "demo") config = { flavor };
    else if (effectiveType === "okf") {
      if (okfMode === "url") config = { url: okfUrl.trim() };
      else { try { config = { content: JSON.parse(okfJson) }; } catch { toast("err", "Invalid JSON"); return; } }
    } else if (effectiveType === "mcp") {
      // never clobber a previously-applied AI mapping just by editing the URL/token
      config = { url: (cfg.url ?? "").trim(), token: cfg.token || undefined,
        ...(initial?.config?.mcp_mapping ? { mcp_mapping: initial.config.mcp_mapping } : {}) };
    } else {
      config = cfg;
    }
    if (mode === "add") {
      const r = await mutate((v) => api.addConnection({
        name: name || (effectiveType === "demo" ? `Demo ${flavor}` : effectiveType === "okf" ? "Frictionless Package" : effectiveType === "mcp" ? "MCP source" : effectiveType),
        type: effectiveType, config, llm_model: model || null,
      }, v));
      if (r) { toast("ok", "Connection added"); onDone(); }
    } else if (initial) {
      const r = await mutate((v) => api.updateConnection(initial.id, {
        name: name || initial.name, config, llm_model: model || null,
      }, v));
      if (r) { toast("ok", "Connection updated"); onDone(); }
    }
  };

  return (
    <div className="card animate-fade-in space-y-4 p-5">
      {/* type selector — locked once a connection exists (editing) */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {(["demo", "oracle", "clickhouse", "okf", "mcp"] as ConnType[]).map((t) => {
          const Mt = TYPE_META[t];
          const Icon = Mt.icon;
          const active = effectiveType === t;
          const disabled = mode === "edit";
          return (
            <button key={t} disabled={disabled} onClick={() => setTypeDraft(t)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
                active ? "border-loom-500 bg-loom-500/10 text-loom-600 dark:text-loom-300"
                  : "border-slate-200 dark:border-slate-700"}`}>
              <Icon size={16} />
              <span className="truncate">{Mt.label}</span>
              {active && <Check size={14} className="ml-auto shrink-0" />}
            </button>
          );
        })}
      </div>
      {mode === "edit" && (
        <p className="text-[11px] text-slate-400">Connector type can't be changed after creation — delete and re-add if you need a different source type.</p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-medium text-slate-500">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)}
            placeholder={
              effectiveType === "demo" ? `Demo ${flavor}` :
              effectiveType === "okf" ? "Frictionless Package" :
              effectiveType === "mcp" ? "My app's MCP server" : "My warehouse"} />
        </label>

        {effectiveType === "demo" && (
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-500">Flavor</span>
            <select className="input" value={flavor} onChange={(e) => setFlavor(e.target.value)}>
              <option value="oracle">Oracle (retail star-schema)</option>
              <option value="clickhouse">ClickHouse (clickstream)</option>
              <option value="mixed">Mixed (both)</option>
              <option value="large">Large warehouse (420+ tables — test scoping)</option>
            </select>
          </label>
        )}

        {effectiveType === "oracle" && (
          <>
            <Field label="DSN" k="dsn" cfg={cfg} setCfg={setCfg} ph="host:1521/service" />
            <Field label="Username" k="user" cfg={cfg} setCfg={setCfg} />
            <Field label="Password" k="password" cfg={cfg} setCfg={setCfg} type="password" />
            <Field label="Schemas (comma-separated)" k="schemas" cfg={cfg} setCfg={setCfg} ph="SALES,FINANCE" />
          </>
        )}
        {effectiveType === "clickhouse" && (
          <>
            <Field label="Host" k="host" cfg={cfg} setCfg={setCfg} ph="localhost" />
            <Field label="Port" k="port" cfg={cfg} setCfg={setCfg} ph="8123" />
            <Field label="Username" k="user" cfg={cfg} setCfg={setCfg} ph="default" />
            <Field label="Password" k="password" cfg={cfg} setCfg={setCfg} type="password" />
            <Field label="Database" k="database" cfg={cfg} setCfg={setCfg} ph="analytics" />
          </>
        )}
        {effectiveType === "mcp" && (
          <>
            <Field label="MCP server URL (Streamable HTTP)" k="url" cfg={cfg} setCfg={setCfg}
              ph="http://localhost:8000/mcp/" />
            <Field label="Bearer token (optional)" k="token" cfg={cfg} setCfg={setCfg} type="password" />
          </>
        )}

        {effectiveType !== "okf" && (
          <label className="space-y-1">
            <span className="flex items-center gap-1 text-xs font-medium text-slate-500">
              <Cpu size={12} /> LLM model (agents)
            </span>
            <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">Default (qwen2.5-coder:7b)</option>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        )}
      </div>

      {/* OKF-specific fields */}
      {effectiveType === "okf" && (
        <div className="space-y-3 rounded-lg border border-teal-200 bg-teal-50/30 p-4 dark:border-teal-800/40 dark:bg-teal-900/10">
          <p className="text-xs text-slate-500">
            Provide a <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">datapackage.json</code> via URL or paste its content.
            The Profiler agent will read field schemas and sample CSVs if accessible.
          </p>
          <div className="flex gap-1.5">
            {(["url", "paste"] as const).map((m) => (
              <button key={m} onClick={() => setOkfMode(m)}
                className={`btn text-xs !py-1 !px-2.5 ${okfMode === m ? "btn-primary" : "btn-outline"}`}>
                {m === "url" ? <><Link2 size={13} /> URL</> : <><Package size={13} /> Paste JSON</>}
              </button>
            ))}
          </div>
          {okfMode === "url" ? (
            <input className="input text-sm" value={okfUrl} onChange={(e) => setOkfUrl(e.target.value)}
              placeholder="https://raw.githubusercontent.com/…/datapackage.json" />
          ) : (
            <textarea className="input min-h-[100px] font-mono text-xs" value={okfJson}
              onChange={(e) => setOkfJson(e.target.value)}
              placeholder={'{"name":"my-pkg","resources":[{"name":"orders","schema":{"fields":[{"name":"id","type":"integer"}]}}]}'} />
          )}
        </div>
      )}

      {/* MCP-specific note */}
      {effectiveType === "mcp" && (
        <div className="rounded-lg border border-cyan-200 bg-cyan-50/30 p-4 text-xs text-slate-500 dark:border-cyan-800/40 dark:bg-cyan-900/10">
          Connects to another application's MCP server as a data source — the mirror of this app's own MCP
          exposure in Settings. An MCP server has no declared table schema, so after adding the connection
          use <b>Map with AI</b> on its card: the local LLM inspects the server's tools and proposes a
          table/column mapping (grounded in a live sample where it can safely call one), which you review
          before it feeds the normal Discovery → Sources &amp; scope → Agents pipeline.
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="btn-outline">Cancel</button>
        <button onClick={submit} className="btn-primary">
          {mode === "add" ? <><Plus size={15} /> Add</> : <><Check size={15} /> Save</>}
        </button>
      </div>
    </div>
  );
}

// ---- MCP source: discover tools + preview/apply the LLM-proposed mapping -- //
function McpMappingModal({ conn, onClose }: { conn: Connection; onClose: () => void }) {
  const { mutate, toast } = useCatalog();
  const { confirm, dialog } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [proposed, setProposed] = useState<McpMappingTable[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  const existingTables = (conn.config?.mcp_mapping as { tables?: McpMappingTable[] } | undefined)?.tables ?? [];

  const load = async () => {
    setLoading(true); setFailed(false);
    try {
      const r = await api.mcpDiscoverMapping(conn.id);
      setTools(r.tools);
      setProposed(r.mapping.tables);
      setExcluded(new Set());
    } catch (e) {
      setFailed(true);
      toast("err", (e as Error).message.includes("503") ? "Local LLM unavailable" : "MCP discovery failed");
    } finally { setLoading(false); }
  };

  useEffect(() => {
    (async () => {
      if (existingTables.length > 0) {
        const ok = await confirm({
          title: "Re-map this MCP source?",
          message: `This connection already has ${existingTables.length} mapped table(s). Re-mapping proposes a fresh set from the server's current tools — table names may change, which can orphan any scope or profiling done under the old ones.`,
          tone: "warning", steps: 1, confirmLabel: "Discover again",
        });
        if (!ok) { onClose(); return; }
      }
      load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (name: string) => setExcluded((s) => {
    const n = new Set(s);
    if (n.has(name)) n.delete(name); else n.add(name);
    return n;
  });

  const toApply = proposed.filter((t) => !excluded.has(t.table_name));

  const apply = async () => {
    setApplying(true);
    try {
      const r = await mutate((v) => api.mcpApplyMapping(conn.id, toApply, v));
      if (r) toast("ok", `${toApply.length} table(s) mapped ✓`);
      onClose();
    } finally { setApplying(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center gap-2">
          <Sparkles size={18} className="text-loom-500" />
          <h3 className="font-semibold">Map "{conn.name}" with AI</h3>
          <button onClick={onClose} className="btn-ghost ml-auto !p-1"><X size={16} /></button>
        </div>

        {loading ? (
          <div className="grid flex-1 place-items-center py-10 text-slate-400">
            <div className="flex items-center gap-2"><Loader2 className="animate-spin" /> Discovering tools &amp; sampling…</div>
          </div>
        ) : failed ? (
          <div className="py-8 text-center text-sm text-slate-400">
            Couldn't map this source. <button onClick={load} className="text-loom-500 underline">Try again</button>
          </div>
        ) : (
          <>
            <p className="mb-2 text-xs text-slate-400">
              {tools.length} tool{tools.length === 1 ? "" : "s"} found on the server ·{" "}
              {proposed.length} proposed as table{proposed.length === 1 ? "" : "s"}. Uncheck any you don't want in the catalog.
            </p>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-auto rounded-lg border border-slate-200 p-2 dark:border-slate-800">
              {proposed.length === 0 ? (
                <div className="py-6 text-center text-sm text-slate-400">
                  No tabular tools identified — this server may only expose actions, not listable data.
                </div>
              ) : proposed.map((t) => {
                const isOn = !excluded.has(t.table_name);
                return (
                  <label key={t.table_name}
                    className={`flex items-start gap-2 rounded-lg border p-2 text-xs ${
                      isOn ? "border-loom-500/30 bg-loom-500/5" : "border-slate-200 opacity-50 dark:border-slate-800"}`}>
                    <input type="checkbox" checked={isOn} onChange={() => toggle(t.table_name)} className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 font-mono font-semibold">
                        <Table2 size={12} className="shrink-0 text-loom-500" /> {t.schema || "MCP"}.{t.table_name}
                        <span className="chip shrink-0 bg-slate-500/10 text-slate-400 normal-case">via {t.tool}</span>
                        {typeof t.row_estimate === "number" && (
                          <span className="chip shrink-0 bg-slate-500/10 text-slate-400 normal-case">~{t.row_estimate} rows</span>
                        )}
                      </div>
                      {t.comment && <div className="mt-0.5 text-slate-500">{t.comment}</div>}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {t.columns.slice(0, 8).map((c) => (
                          <span key={c.name} className="chip bg-slate-500/10 text-slate-400"><Hash size={9} /> {c.name}</span>
                        ))}
                        {t.columns.length > 8 && (
                          <span className="chip bg-slate-500/10 text-slate-400">+{t.columns.length - 8} more</span>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={load} disabled={applying} className="btn-ai-outline text-xs">
                <Sparkles size={13} /> Re-discover
              </button>
              <button onClick={apply} disabled={applying || toApply.length === 0} className="btn-ai flex-1 justify-center text-xs">
                {applying ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                Apply {toApply.length} table{toApply.length === 1 ? "" : "s"}
              </button>
            </div>
          </>
        )}
      </div>
      {dialog}
    </div>
  );
}

function Field({ label, k, cfg, setCfg, ph, type = "text" }: {
  label: string; k: string; cfg: Record<string, string>;
  setCfg: (f: (c: Record<string, string>) => Record<string, string>) => void;
  ph?: string; type?: string;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input className="input" type={type} placeholder={ph} value={cfg[k] ?? ""}
        onChange={(e) => setCfg((c) => ({ ...c, [k]: e.target.value }))} />
    </label>
  );
}
