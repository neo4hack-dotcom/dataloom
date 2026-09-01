import { useState } from "react";
import {
  Database, Plus, Trash2, Zap, Server, Boxes, FlaskConical, Cpu, Check, Package, Link2,
  Pencil, PlugZap, Loader2, CheckCircle2, XCircle, History,
} from "lucide-react";
import { useCatalog } from "../store";
import { api } from "../api";
import { EmptyState, timeAgo } from "../lib/ui";
import { useConfirm } from "../components/ConfirmDialog";
import type { Connection } from "../types";
import type { Tab } from "../App";

const TYPE_META: Record<string, { label: string; icon: typeof Server; color: string }> = {
  demo:       { label: "Demo",             icon: FlaskConical, color: "text-violet-500 bg-violet-500/10" },
  oracle:     { label: "Oracle",           icon: Database,     color: "text-rose-500 bg-rose-500/10" },
  clickhouse: { label: "ClickHouse",       icon: Boxes,        color: "text-amber-500 bg-amber-500/10" },
  okf:        { label: "Frictionless/OKF", icon: Package,      color: "text-teal-500 bg-teal-500/10" },
};

type ConnType = "demo" | "oracle" | "clickhouse" | "okf";

export function Connections({ goto }: { goto: (t: Tab) => void }) {
  const { state, health, mutate, setActiveRun, toast } = useCatalog();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Connection | null>(null);
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
          Connect a warehouse or import a <b>Frictionless Data Package</b> (OKF / datapackage.json).
          Use <b>Demo</b> to explore with a synthetic dataset.
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
            return (
              <div key={c.id} className="card group p-4">
                <div className="flex items-start gap-3">
                  <div className={`grid h-10 w-10 place-items-center rounded-lg ${Mt.color}`}>
                    <Icon size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{c.name}</div>
                    <div className="text-xs text-slate-400">{Mt.label} · {dsCount} tables · added {timeAgo(c.created_at)}</div>
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
                <div className="mt-3 flex gap-2">
                  <button onClick={() => test(c.id)} className="btn-outline !px-2.5 text-xs" title="Test connection">
                    {pingState === "busy" ? <Loader2 size={13} className="animate-spin" /> :
                     pingState === "ok" ? <CheckCircle2 size={13} className="text-emerald-500" /> :
                     pingState === "fail" ? <XCircle size={13} className="text-rose-500" /> :
                     <PlugZap size={13} />}
                    Test
                  </button>
                  <button onClick={() => launch(c.id)} className="btn-primary flex-1 justify-center">
                    <Zap size={15} /> Run pipeline
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
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
      ? Object.fromEntries(Object.entries(initial.config).map(([k, v]) => [k, String(v ?? "")]))
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
    } else {
      config = cfg;
    }
    if (mode === "add") {
      const r = await mutate((v) => api.addConnection({
        name: name || (effectiveType === "demo" ? `Demo ${flavor}` : effectiveType === "okf" ? "Frictionless Package" : effectiveType),
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
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {(["demo", "oracle", "clickhouse", "okf"] as ConnType[]).map((t) => {
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
              effectiveType === "okf" ? "Frictionless Package" : "My warehouse"} />
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

      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="btn-outline">Cancel</button>
        <button onClick={submit} className="btn-primary">
          {mode === "add" ? <><Plus size={15} /> Add</> : <><Check size={15} /> Save</>}
        </button>
      </div>
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
