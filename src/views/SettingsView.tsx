import { useState } from "react";
import {
  Cpu, Download, FileJson, FileText, History, Check, Server,
  Table2, AppWindow, Package, RotateCcw, AlertTriangle, Upload, Link2,
} from "lucide-react";
import { useCatalog } from "../store";
import { api } from "../api";
import { timeAgo } from "../lib/ui";

type ExportTarget = "catalog" | "app" | "full";

export function SettingsView() {
  const { state, health, mutate, toast } = useCatalog();
  const [model, setModel] = useState(state?.settings.llm_model ?? "");
  const [resetConfirm, setResetConfirm] = useState(false);

  // OKF import state
  const [okfMode, setOkfMode] = useState<"url" | "json">("url");
  const [okfUrl, setOkfUrl] = useState("");
  const [okfJson, setOkfJson] = useState("");
  const [okfLoading, setOkfLoading] = useState(false);

  const saveModel = async () => {
    await mutate((v) => fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Base-Version": String(v) },
      body: JSON.stringify({ patch: { llm_model: model } }),
    }).then((r) => r.json()));
    toast("ok", "Default model saved");
  };

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
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Cpu size={16} className="text-loom-500" /> Local LLM (Ollama)
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-800">
          <Server size={15} className={health?.llm.up ? "text-emerald-500" : "text-rose-500"} />
          <span>{health?.llm.up ? "Connected" : "Offline"} · localhost:11434</span>
          <span className="ml-auto text-xs text-slate-400">{health?.llm.models.length ?? 0} models</span>
        </div>
        <div className="mt-3 flex items-end gap-2">
          <label className="flex-1 space-y-1">
            <span className="text-xs font-medium text-slate-500">Default agent model</span>
            <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
              {(health?.llm.models ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <button onClick={saveModel} className="btn-primary"><Check size={15} /> Save</button>
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
