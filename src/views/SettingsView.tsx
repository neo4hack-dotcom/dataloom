import { useEffect, useRef, useState } from "react";
import {
  Cpu, Download, FileJson, FileText, History, Check, Server,
  Table2, AppWindow, Package, RotateCcw, AlertTriangle, Upload, Link2,
  RefreshCw, Zap, Loader2, Gauge, Save, DatabaseBackup, FileUp,
} from "lucide-react";
import { useCatalog } from "../store";
import { api } from "../api";
import { timeAgo } from "../lib/ui";

type ExportTargetT = "catalog" | "app" | "full";

type ExportTarget = "catalog" | "app" | "full";

export function SettingsView() {
  const { state, health, refresh, mutate, toast } = useCatalog();
  const [resetConfirm, setResetConfirm] = useState(false);

  // -- LLM configuration (OpenAI-compatible) --
  const cfg = health?.llm.config;
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState(0.2);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<"" | "save" | "test" | "models">("");

  // hydrate the form once health/config arrives
  useEffect(() => {
    if (!cfg) return;
    setBaseUrl((b) => b || cfg.base_url);
    setModel((m) => m || cfg.model);
    setTemperature(cfg.temperature);
    setMaxTokens(cfg.max_tokens);
    setModels(health?.llm.models ?? []);
  }, [cfg?.base_url, cfg?.model]); // eslint-disable-line

  const presets = health?.llm.presets ?? [];
  const lastTest = health?.llm.last_test;

  const draft = () => ({ base_url: baseUrl.trim(), model: model.trim(), ...(apiKey ? { api_key: apiKey } : {}) });

  const saveLlm = async () => {
    setBusy("save");
    try {
      await mutate((v) => api.saveLlmConfig({
        base_url: baseUrl.trim(), model: model.trim(),
        temperature, max_tokens: maxTokens, ...(apiKey ? { api_key: apiKey } : {}),
      }, v));
      setApiKey("");
      toast("ok", "LLM settings saved");
    } finally { setBusy(""); }
  };

  const testLlm = async () => {
    setBusy("test");
    try {
      const r = await api.testLlm(draft());
      await refresh();
      toast(r.result.ok ? "ok" : "err", r.result.message);
    } catch (e) {
      toast("err", (e as Error).message);
    } finally { setBusy(""); }
  };

  const loadModels = async () => {
    setBusy("models");
    try {
      const r = await api.listLlmModels({ base_url: baseUrl.trim(), ...(apiKey ? { api_key: apiKey } : {}) });
      setModels(r.models);
      if (r.models.length && !r.models.includes(model)) setModel(r.models[0]);
      toast(r.models.length ? "ok" : "err", `${r.models.length} model(s) found`);
    } catch (e) {
      toast("err", (e as Error).message);
    } finally { setBusy(""); }
  };

  // OKF import state
  const [okfMode, setOkfMode] = useState<"url" | "json">("url");
  const [okfUrl, setOkfUrl] = useState("");
  const [okfJson, setOkfJson] = useState("");
  const [okfLoading, setOkfLoading] = useState(false);

  const doExport = async (target: ExportTarget, fmt: "markdown" | "json" | "okf") => {
    let result: { content: unknown; filename: string };
    if (target === "catalog") result = await api.exportCatalog(fmt as any);
    else if (target === "app") result = await api.exportApp();
    else result = await api.exportFull(fmt as any);
    const text = typeof result.content === "string"
      ? result.content : JSON.stringify(result.content, null, 2);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = result.filename; a.click();
    URL.revokeObjectURL(url);
    toast("ok", `${result.filename} downloaded`);
  };

  const doReset = async () => {
    await mutate((v) => api.resetCatalog(v));
    toast("ok", "Catalog reset — all profiled data cleared.");
    setResetConfirm(false);
  };

  const doImportOKF = async () => {
    setOkfLoading(true);
    try {
      let body: { url?: string; content?: Record<string, unknown> } = {};
      if (okfMode === "url") {
        if (!okfUrl.trim()) { toast("err", "Enter a URL"); return; }
        body = { url: okfUrl.trim() };
      } else {
        if (!okfJson.trim()) { toast("err", "Paste JSON content"); return; }
        try { body = { content: JSON.parse(okfJson) }; }
        catch { toast("err", "Invalid JSON"); return; }
      }
      const r = await mutate((v) => api.importOKF(body, v));
      if (r) toast("ok", `Frictionless Data imported — ${r.imported} table(s).`);
      setOkfUrl(""); setOkfJson("");
    } finally {
      setOkfLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* LLM */}
      <div className="card p-5">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Cpu size={16} className="text-loom-500" /> Local LLM
          <span className="text-xs font-normal text-slate-400">— any OpenAI-compatible API</span>
          <span className="ml-auto flex items-center gap-2">
            {lastTest && (
              <span className={`chip ${lastTest.ok ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"}`}>
                <Zap size={11} /> {lastTest.ok ? `OK · ${lastTest.latency_ms.toFixed(0)} ms` : "failed"}
              </span>
            )}
            <span className={`flex items-center gap-1 text-xs ${health?.llm.up ? "text-emerald-500" : "text-rose-500"}`}>
              <Server size={13} /> {health?.llm.up ? "reachable" : "offline"}
            </span>
          </span>
        </div>
        <p className="mb-3 text-xs text-slate-400">Ollama, LM Studio, vLLM, llama.cpp… — runs fully offline.</p>

        {/* provider presets */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button key={p.name} onClick={() => setBaseUrl(p.base_url)}
              className={`chip border ${baseUrl === p.base_url
                ? "border-loom-500 bg-loom-500/10 text-loom-600 dark:text-loom-300"
                : "border-slate-200 text-slate-500 hover:border-loom-400 dark:border-slate-700"}`}>
              {p.name}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-500">Base URL (OpenAI-compatible)</span>
            <input className="input font-mono text-xs" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://127.0.0.1:11434/v1" />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-500">
                API key {cfg?.api_key_set && <span className="text-slate-400">· saved</span>}
              </span>
              <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                placeholder={cfg?.api_key_set ? "••••••••  (type to replace)" : "(usually none locally)"} />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-500">Model</span>
              <div className="flex gap-1.5">
                {models.length > 0 ? (
                  <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
                    {models.map((m) => <option key={m} value={m}>{m}</option>)}
                    {!models.includes(model) && model && <option value={model}>{model}</option>}
                  </select>
                ) : (
                  <input className="input font-mono text-xs" value={model} onChange={(e) => setModel(e.target.value)}
                    placeholder="qwen2.5-coder:7b" />
                )}
                <button onClick={loadModels} disabled={busy === "models"}
                  className="btn-outline shrink-0 !px-2.5" title="List the server's models">
                  {busy === "models" ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                </button>
              </div>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="flex items-center gap-1 text-xs font-medium text-slate-500">
                <Gauge size={12} /> Temperature: <span className="font-mono">{temperature.toFixed(2)}</span>
              </span>
              <input type="range" min={0} max={1} step={0.05} value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full accent-loom-600" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-500">Max tokens</span>
              <input className="input" type="number" value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value, 10) || 2048)} />
            </label>
          </div>

          <div className="flex items-center gap-2">
            {lastTest && (
              <span className="flex-1 truncate text-[11px] text-slate-400" title={lastTest.message}>
                {lastTest.message}
              </span>
            )}
            <button onClick={testLlm} disabled={busy === "test"} className="btn-outline ml-auto">
              {busy === "test" ? <Loader2 size={15} className="animate-spin" /> : <Cpu size={15} />} Test connection
            </button>
            <button onClick={saveLlm} disabled={busy === "save"} className="btn-primary">
              {busy === "save" ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Save
            </button>
          </div>
        </div>
      </div>

      {/* OKF Import */}
      <div className="card p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Upload size={16} className="text-violet-500" /> Import Frictionless Data Package (OKF)
        </div>
        <p className="mb-3 text-xs text-slate-400">
          Import a <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">datapackage.json</code> (Open Knowledge Foundation / Google Dataset Search format) to populate the catalog with table schemas, field definitions, and FK relationships.
        </p>
        <div className="mb-3 flex gap-1.5">
          {(["url", "json"] as const).map((m) => (
            <button key={m} onClick={() => setOkfMode(m)}
              className={`btn text-xs !py-1 !px-2.5 ${okfMode === m ? "btn-primary" : "btn-outline"}`}>
              {m === "url" ? <><Link2 size={13} /> URL</> : <><FileJson size={13} /> Paste JSON</>}
            </button>
          ))}
        </div>
        {okfMode === "url" ? (
          <input className="input text-sm" value={okfUrl} onChange={(e) => setOkfUrl(e.target.value)}
            placeholder="https://raw.githubusercontent.com/…/datapackage.json" />
        ) : (
          <textarea className="input min-h-[120px] font-mono text-xs" value={okfJson}
            onChange={(e) => setOkfJson(e.target.value)}
            placeholder={'{\n  "name": "my-package",\n  "resources": [{"name": "orders", "schema": {"fields": [{"name": "order_id", "type": "integer"}]}}]\n}'} />
        )}
        <button onClick={doImportOKF} disabled={okfLoading} className="btn-primary mt-2 w-full justify-center">
          {okfLoading ? "Importing…" : <><Upload size={15} /> Import</>}
        </button>
      </div>

      {/* Export */}
      <div className="card p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Download size={16} className="text-loom-500" /> Export
        </div>
        <div className="mb-4 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Table2 size={13} /> Catalog export
          </div>
          <p className="mb-3 text-xs text-slate-400">
            Tables, columns, definitions, relationships, lineage, and glossary — your full data dictionary.
          </p>
          <div className="flex gap-2">
            <button onClick={() => doExport("catalog", "markdown")} className="btn-outline flex-1 justify-center">
              <FileText size={15} /> Markdown
            </button>
            <button onClick={() => doExport("catalog", "json")} className="btn-outline flex-1 justify-center">
              <FileJson size={15} /> JSON
            </button>
            <button onClick={() => doExport("catalog", "okf")} className="btn-outline flex-1 justify-center">
              <Package size={15} /> OKF
            </button>
          </div>
        </div>
        <div className="mb-4 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <AppWindow size={13} /> App configuration export
          </div>
          <p className="mb-3 text-xs text-slate-400">
            Connections, settings, run history, and audit log.
          </p>
          <button onClick={() => doExport("app", "json")} className="btn-outline w-full justify-center">
            <FileJson size={15} /> Export app config (JSON)
          </button>
        </div>
        <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Package size={13} /> Full snapshot
          </div>
          <p className="mb-3 text-xs text-slate-400">Complete state — catalog + app config in one file.</p>
          <div className="flex gap-2">
            <button onClick={() => doExport("full", "markdown")} className="btn-outline flex-1 justify-center">
              <FileText size={15} /> Markdown
            </button>
            <button onClick={() => doExport("full", "json")} className="btn-outline flex-1 justify-center">
              <FileJson size={15} /> JSON
            </button>
          </div>
        </div>
      </div>

      {/* Backup & restore */}
      <BackupRestore doExport={doExport} />

      {/* Reset */}
      <div className="card border-rose-500/20 p-5">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-rose-500">
          <RotateCcw size={16} /> Reset catalog
        </div>
        <p className="mb-3 text-xs text-slate-400">
          Removes all profiled tables, columns, relationships, lineage, glossary, and agent runs.
          Connections and settings are preserved.
        </p>
        {!resetConfirm ? (
          <button onClick={() => setResetConfirm(true)} className="btn-outline border-rose-300 text-rose-500 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950">
            <AlertTriangle size={15} /> Reset all catalog data…
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={doReset} className="flex-1 rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-600">
              Yes, reset everything
            </button>
            <button onClick={() => setResetConfirm(false)} className="btn-outline flex-1 justify-center">Cancel</button>
          </div>
        )}
      </div>

      {/* Audit log */}
      <div className="card p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <History size={16} className="text-loom-500" /> Audit log (time-travel)
        </div>
        <div className="max-h-72 space-y-1 overflow-auto">
          {(state?.audit ?? []).slice(0, 50).map((a) => (
            <div key={a.version} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800">
              <span className="font-mono text-slate-400">v{a.version}</span>
              <span className="font-medium text-loom-500">{a.action}</span>
              <span className="truncate text-slate-400">{a.detail}</span>
              <span className="ml-auto text-slate-400">{timeAgo(a.ts)}</span>
            </div>
          ))}
          {(state?.audit.length ?? 0) === 0 && (
            <div className="py-4 text-center text-sm text-slate-400">No mutations recorded yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Backup & restore (full app snapshot) --------------------------------- //
function BackupRestore({ doExport }: { doExport: (t: ExportTargetT, fmt: "markdown" | "json" | "okf") => void }) {
  const { mutate, refresh, toast } = useCatalog();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; backup: any; summary: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = (file: File) => {
    file.text().then((text) => {
      try {
        const parsed = JSON.parse(text);
        const data = parsed.data ?? parsed;
        const n = (k: string) => (Array.isArray(data[k]) ? data[k].length : 0);
        const summary = `${n("datasets")} tables · ${n("connections")} connections · ${n("relationships")} relationships · ${n("lineage")} lineage edges`;
        setPending({ name: file.name, backup: parsed, summary });
      } catch {
        toast("err", "Not a valid backup file (JSON expected).");
      }
    });
  };

  const restore = async (mode: "replace" | "merge") => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await mutate((v) => api.importBackup(pending.backup, mode, v));
      if (r) { await refresh(); toast("ok", `Backup ${mode === "replace" ? "restored" : "merged"} ✓`); }
      setPending(null);
    } finally { setBusy(false); }
  };

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <DatabaseBackup size={16} className="text-loom-500" /> Backup &amp; restore
      </div>
      <p className="mb-3 text-xs text-slate-400">
        Save everything (catalogue + connections + settings + LLM config) to one file, and reload it any time —
        e.g. to migrate to another machine or roll back.
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => doExport("full", "json")} className="btn-primary">
          <Save size={15} /> Download full backup
        </button>
        <button onClick={() => fileRef.current?.click()} className="btn-outline">
          <FileUp size={15} /> Restore from file…
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }} />
      </div>

      {pending && (
        <div className="mt-3 rounded-lg border border-loom-500/30 bg-loom-500/5 p-3">
          <div className="text-sm font-medium">{pending.name}</div>
          <div className="text-xs text-slate-400">{pending.summary}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => restore("replace")} disabled={busy} className="btn-primary text-xs">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Replace everything
            </button>
            <button onClick={() => restore("merge")} disabled={busy} className="btn-outline text-xs">
              Merge into current
            </button>
            <button onClick={() => setPending(null)} className="btn-ghost text-xs">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
