import { useState } from "react";
import {
  Database, Plus, Trash2, Zap, Server, Boxes, FlaskConical, Cpu, Check,
} from "lucide-react";
import { useCatalog } from "../store";
import { api } from "../api";
import { EmptyState, timeAgo } from "../lib/ui";
import type { Tab } from "../App";

const TYPE_META: Record<string, { label: string; icon: typeof Server; color: string }> = {
  demo: { label: "Demo", icon: FlaskConical, color: "text-violet-500 bg-violet-500/10" },
  oracle: { label: "Oracle", icon: Database, color: "text-rose-500 bg-rose-500/10" },
  clickhouse: { label: "ClickHouse", icon: Boxes, color: "text-amber-500 bg-amber-500/10" },
};

export function Connections({ goto }: { goto: (t: Tab) => void }) {
  const { state, health, mutate, setActiveRun, toast } = useCatalog();
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<"demo" | "oracle" | "clickhouse">("demo");
  const [name, setName] = useState("");
  const [flavor, setFlavor] = useState("oracle");
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [model, setModel] = useState("");

  const conns = state?.connections ?? [];
  const models = health?.llm.models ?? [];

  const add = async () => {
    const config = type === "demo" ? { flavor } : cfg;
    const r = await mutate((v) => api.addConnection({
      name: name || (type === "demo" ? `Demo ${flavor}` : type), type, config,
      llm_model: model || null,
    }, v));
    if (r) {
      toast("ok", "Connection added");
      setShowForm(false); setName(""); setCfg({});
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
          Connect an <b>Oracle</b> or <b>ClickHouse</b> warehouse, or start instantly with a
          <b> Demo</b> source (synthetic realistic warehouse with intentionally overlapping values).
        </p>
        <button onClick={() => setShowForm((s) => !s)} className="btn-primary">
          <Plus size={16} /> New connection
        </button>
      </div>

      {showForm && (
        <div className="card animate-fade-in space-y-4 p-5">
          <div className="grid grid-cols-3 gap-2">
            {(["demo", "oracle", "clickhouse"] as const).map((t) => {
              const Mt = TYPE_META[t];
              const Icon = Mt.icon;
              return (
                <button key={t} onClick={() => setType(t)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium ${
                    type === t ? "border-loom-500 bg-loom-500/10 text-loom-600 dark:text-loom-300"
                      : "border-slate-200 dark:border-slate-700"}`}>
                  <Icon size={17} /> {Mt.label}
                  {type === t && <Check size={15} className="ml-auto" />}
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-500">Name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)}
                placeholder={type === "demo" ? `Demo ${flavor}` : "My warehouse"} />
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

            <label className="space-y-1">
              <span className="flex items-center gap-1 text-xs font-medium text-slate-500">
                <Cpu size={12} /> LLM model (agents)
              </span>
              <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">Default (qwen2.5-coder:7b)</option>
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="btn-outline">Cancel</button>
            <button onClick={add} className="btn-primary"><Plus size={15} /> Add</button>
          </div>
        </div>
      )}

      {conns.length === 0 && !showForm ? (
        <EmptyState icon={<Database size={48} />} title="No connections"
          hint={<>Fastest start: create a <b>Demo</b> connection and run Magic Enrich.</>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {conns.map((c) => {
            const Mt = TYPE_META[c.type];
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
