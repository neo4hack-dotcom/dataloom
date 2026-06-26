import { useState } from "react";
import {
  Cpu, Download, FileJson, FileText, History, Check, Server,
  Table2, AppWindow, Package,
} from "lucide-react";
import { useCatalog } from "../store";
import { api } from "../api";
import { timeAgo } from "../lib/ui";

type ExportTarget = "catalog" | "app" | "full";

export function SettingsView() {
  const { state, health, mutate, toast } = useCatalog();
  const [model, setModel] = useState(state?.settings.llm_model ?? "");

  const saveModel = async () => {
    await mutate((v) => fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Base-Version": String(v) },
      body: JSON.stringify({ patch: { llm_model: model } }),
    }).then((r) => r.json()));
    toast("ok", "Default model saved");
  };

  const doExport = async (target: ExportTarget, fmt: "markdown" | "json") => {
    let result: { content: unknown; filename: string };
    if (target === "catalog") {
      result = await api.exportCatalog(fmt);
    } else if (target === "app") {
      result = await api.exportApp();
    } else {
      result = await api.exportFull(fmt);
    }
    const text = typeof result.content === "string"
      ? result.content
      : JSON.stringify(result.content, null, 2);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename;
    a.click();
    URL.revokeObjectURL(url);
    toast("ok", `${result.filename} downloaded`);
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

      {/* Export */}
      <div className="card p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Download size={16} className="text-loom-500" /> Export
        </div>

        {/* Catalog export */}
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
          </div>
        </div>

        {/* App export */}
        <div className="mb-4 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <AppWindow size={13} /> App configuration export
          </div>
          <p className="mb-3 text-xs text-slate-400">
            Connections, settings, run history, and audit log — use to back up or migrate the app state.
          </p>
          <button onClick={() => doExport("app", "json")} className="btn-outline w-full justify-center">
            <FileJson size={15} /> Export app config (JSON)
          </button>
        </div>

        {/* Full export */}
        <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Package size={13} /> Full snapshot
          </div>
          <p className="mb-3 text-xs text-slate-400">
            Complete state — catalog + app configuration in a single file.
          </p>
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

      {/* Audit / time travel */}
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
