import { useState } from "react";
import {
  Database, Plus, Trash2, Zap, Server, Boxes, FlaskConical, Cpu, Check, Package, Link2,
} from "lucide-react";
import { useCatalog } from "../store";
import { api } from "../api";
import { EmptyState, timeAgo } from "../lib/ui";
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
  const [type, setType] = useState<ConnType>("demo");
  const [name, setName] = useState("");
  const [flavor, setFlavor] = useState("oracle");
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [model, setModel] = useState("");
  // OKF
  const [okfMode, setOkfMode] = useState<"url" | "paste">("url");
  const [okfUrl, setOkfUrl] = useState("");
  const [okfJson, setOkfJson] = useState("");

  const conns = state?.connections ?? [];
  const models = health?.llm.models ?? [];

  const add = async () => {
    let config: Record<string, unknown> = {};
    if (type === "demo") config = { flavor };
    else if (type === "okf") {
      if (okfMode === "url") config = { url: okfUrl.trim() };
      else { try { config = { content: JSON.parse(okfJson) }; } catch { toast("err", "Invalid JSON"); return; } }
    } else {
      config = cfg;
    }
    const r = await mutate((v) => api.addConnection({
      name: name || (type === "demo" ? `Demo ${flavor}` : type === "okf" ? "Frictionless Package" : type),
      type, config, llm_model: model || null,
    }, v));
    if (r) {
      toast("ok", "Connection added");
      setShowForm(false); setName(""); setCfg({}); setOkfUrl(""); setOkfJson("");
    }
  };

  const launch = async (cid: string) => {
    const r = await mutate((v) => api.launchRun(cid, null, v));
    if (r) { setActiveRun(r.run); goto("agents"); toast("info", "Pipeline started ✨"); }
  };

  const remove = async (cid: string) => {
    await mutate((v) => api.deleteConnection(cid, v));
    toast("ok", "Connection removed");
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="max-w-2xl text-sm text-slate-500">
          Connect a warehouse or import a <b>Frictionless Data Package</b> (OKF / datapackage.json).
          Use <b>Demo</b> to explore with a synthetic dataset.
        </p>
        <button onClick={() => setShowForm((s) => !s)} className="btn-primary">
          <Plus size={16} /> New connection
        </button>
      </div>

      {showForm && (
        <div className="card animate-fade-in space-y-4 p-5">
          {/* type selector */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {(["demo", "oracle", "clickhouse", "okf"] as ConnType[]).map((t) => {
              const Mt = TYPE_META[t];
              const Icon = Mt.icon;
              return (
                <button key={t} onClick={() => setType(t)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium ${
                    type === t ? "border-loom-500 bg-loom-500/10 text-loom-600 dark:text-loom-300"
                      : "border-slate-200 dark:border-slate-700"}`}>
                  <Icon size={16} />
                  <span className="truncate">{Mt.label}</span>
                  {type === t && <Check size={14} className="ml-auto shrink-0" />}
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-500">Name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)}
                placeholder={
                  type === "demo" ? `Demo ${flavor}` :
                  type === "okf" ? "Frictionless Package" : "My warehouse"} />
            </label>

            {type === "demo" && (
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-500">Flavor</span>
                <select className="input" value={flavor} onChange={(e) => setFlavor(e.target.value)}>
                  <option value="oracle">Oracle (retail star-schema)</option>
                  <option value="clickhouse">ClickHouse (clickstream)</option>
                  <option value="mixed">Mixed (both)</option>
                </select>
              </label>
            )}

            {type === "oracle" && (
              <>
                <Field label="DSN" k="dsn" cfg={cfg} setCfg={setCfg} ph="host:1521/service" />
                <Field label="Username" k="user" cfg={cfg} setCfg={setCfg} />
                <Field label="Password" k="password" cfg={cfg} setCfg={setCfg} type="password" />
                <Field label="Schemas (comma-separated)" k="schemas" cfg={cfg} setCfg={setCfg} ph="SALES,FINANCE" />
              </>
            )}
            {type === "clickhouse" && (
              <>
                <Field label="Host" k="host" cfg={cfg} setCfg={setCfg} ph="localhost" />
                <Field label="Port" k="port" cfg={cfg} setCfg={setCfg} ph="8123" />
                <Field label="Username" k="user" cfg={cfg} setCfg={setCfg} ph="default" />
                <Field label="Password" k="password" cfg={cfg} setCfg={setCfg} type="password" />
                <Field label="Database" k="database" cfg={cfg} setCfg={setCfg} ph="analytics" />
              </>
            )}

            {type !== "okf" && (
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
          {type === "okf" && (
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
            <button onClick={() => setShowForm(false)} className="btn-outline">Cancel</button>
            <button onClick={add} className="btn-primary"><Plus size={15} /> Add</button>
          </div>
        </div>
      )}

      {conns.length === 0 && !showForm ? (
        <EmptyState icon={<Database size={48} />} title="No connections"
          hint={<>Create a <b>Demo</b> connection and run Magic Enrich, or connect a real warehouse.</>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {conns.map((c) => {
            const Mt = TYPE_META[c.type] ?? TYPE_META.oracle;
            const Icon = Mt.icon;
            const dsCount = state?.datasets.filter((d) => d.connection_id === c.id).length ?? 0;
            return (
              <div key={c.id} className="card group p-4">
                <div className="flex items-start gap-3">
                  <div className={`grid h-10 w-10 place-items-center rounded-lg ${Mt.color}`}>
                    <Icon size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{c.name}</div>
                    <div className="text-xs text-slate-400">{Mt.label} · {dsCount} tables · {timeAgo(c.created_at)}</div>
                  </div>
                  <button onClick={() => remove(c.id)}
                    className="opacity-0 transition-opacity group-hover:opacity-100 text-slate-400 hover:text-rose-500">
                    <Trash2 size={16} />
                  </button>
                </div>
                <button onClick={() => launch(c.id)} className="btn-primary mt-3 w-full justify-center">
                  <Zap size={15} /> Run pipeline
                </button>
              </div>
            );
          })}
        </div>
      )}
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
