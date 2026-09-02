import { useEffect, useMemo, useRef, useState } from "react";
import {
  Microscope, Loader2, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2,
  XCircle, MinusCircle, OctagonX, FileDown, Trash2, Sparkles, Settings2, Table2,
  Wrench, History, Zap, ListChecks, Terminal,
} from "lucide-react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { useCatalog } from "../store";
import { api } from "../api";
import { EmptyState, shortDs, timeAgo } from "../lib/ui";
import { useConfirm } from "../components/ConfirmDialog";
import type { QualityRun, QualityThresholds, QualityTableResult, QualityFinding } from "../types";

const DEFAULT_THRESHOLDS: QualityThresholds = {
  zscore: 3, iqr_multiplier: 1.5, outlier_pct_high: 0.05, duplicate_pct_high: 0.05,
  categorical_cardinality_max: 0.5, pattern_dominance_min: 0.9, value_sample_size: 3000, row_sample_size: 2000,
};

const PHASE_LABEL: Record<string, string> = {
  planning: "Planning the analysis…", checking: "Running deep checks…",
  refining: "Reviewing results for follow-ups…", interpreting: "Writing the report…", done: "Done",
};

const SEV_DOT: Record<string, string> = { high: "bg-rose-500", medium: "bg-amber-500", low: "bg-slate-400" };
const SEV_CHIP: Record<string, string> = {
  high: "bg-rose-500/10 text-rose-500", medium: "bg-amber-500/10 text-amber-500", low: "bg-slate-500/10 text-slate-400",
};
const RISK_RING: Record<string, string> = {
  high: "border-rose-500/40 bg-rose-500/5", medium: "border-amber-500/40 bg-amber-500/5", low: "border-loom-500/30 bg-loom-500/5",
};

export function QualityChecks() {
  const { state, mutate, toast } = useCatalog();
  const { confirm, dialog } = useConfirm();
  const conns = state?.connections ?? [];
  const [cid, setCid] = useState(conns[0]?.id ?? "");
  const [selTables, setSelTables] = useState<Set<string>>(new Set());
  const [thresholds, setThresholds] = useState<QualityThresholds>(DEFAULT_THRESHOLDS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [focusNotes, setFocusNotes] = useState("");
  const [run, setRun] = useState<QualityRun | null>(null);
  const [history, setHistory] = useState<Omit<QualityRun, "tables" | "logs">[]>([]);
  const [launching, setLaunching] = useState(false);
  const [exporting, setExporting] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const tablesForConn = useMemo(
    () => (state?.datasets ?? []).filter((d) => d.connection_id === cid), [state, cid]);

  useEffect(() => { if (!cid && conns[0]) setCid(conns[0].id); }, [conns, cid]); // eslint-disable-line
  useEffect(() => { setSelTables(new Set()); }, [cid]);

  const loadHistory = async () => {
    try { const r = await api.listQualityRuns(); setHistory(r.runs); } catch { /* ignore */ }
  };
  useEffect(() => { loadHistory(); }, []); // eslint-disable-line

  useEffect(() => {
    if (!run || ["done", "error", "cancelled"].includes(run.status)) return;
    const t = setInterval(async () => {
      try {
        const r = await api.getQualityRun(run.id);
        setRun(r);
        if (["done", "error", "cancelled"].includes(r.status)) {
          loadHistory();
          if (r.status === "done") toast("ok", "Deep analysis complete ✓");
          else if (r.status === "cancelled") toast("info", "Analysis cancelled");
          else toast("err", "Analysis failed");
        }
      } catch { /* ignore transient poll errors */ }
    }, 800);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, run?.status]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [run?.logs?.length]);

  const toggleTable = (id: string) => setSelTables((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const launch = async () => {
    if (selTables.size === 0) { toast("err", "Select at least one table"); return; }
    setLaunching(true);
    try {
      const scope: Record<string, string[] | null> = {};
      for (const id of selTables) scope[id] = null;
      const r = await mutate((v) => api.launchQualityRun(
        { connection_id: cid, scope, thresholds, focus_notes: focusNotes }, v));
      if (r) { setRun(r.run); toast("info", "Deep analysis started ✨"); }
    } finally { setLaunching(false); }
  };

  const cancel = async () => {
    if (!run) return;
    try { await api.cancelQualityRun(run.id); toast("info", "Cancelling…"); }
    catch (e) { toast("err", (e as Error).message); }
  };

  const openHistoryRun = async (id: string) => {
    try { setRun(await api.getQualityRun(id)); }
    catch (e) { toast("err", (e as Error).message); }
  };

  const deleteHistoryRun = async (id: string) => {
    const ok = await confirm({
      title: "Delete this report?", message: "This report will be permanently removed.",
      tone: "danger", steps: 1, confirmLabel: "Delete",
    });
    if (!ok) return;
    await api.deleteQualityRun(id);
    if (run?.id === id) setRun(null);
    loadHistory();
  };

  const exportPDF = async () => {
    if (!run || run.status !== "done") return;
    setExporting(true);
    try {
      await exportQualityReportPDF(run, conns.find((c) => c.id === run.connection_id)?.name ?? run.connection_id);
    } catch (e) {
      toast("err", `PDF export failed: ${(e as Error).message}`);
    } finally { setExporting(false); }
  };

  const running = !!run && (run.status === "running" || run.status === "queued");
  const totalFindings = run?.status === "done" ? run.tables.reduce((s, t) => s + t.findings.length, 0) : 0;
  const highCount = run?.status === "done" ? run.tables.filter((t) => t.interpretation.risk_level === "high").length : 0;

  if (conns.length === 0) {
    return <EmptyState icon={<Microscope size={48} />} title="No connections"
      hint="Add and profile a connection first, then come back to run a deep quality analysis on its tables." />;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
      {/* left: scope + config + history */}
      <div className="space-y-4">
        <div className="card p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Microscope size={16} className="text-loom-500" /> Scope
          </div>
          <label className="mb-3 block space-y-1">
            <span className="text-xs font-medium text-slate-500">Connection</span>
            <select className="input !py-1.5 text-sm" value={cid} onChange={(e) => setCid(e.target.value)}>
              {conns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
            <span>{selTables.size} of {tablesForConn.length} table(s) selected</span>
            <div className="flex gap-2">
              <button onClick={() => setSelTables(new Set(tablesForConn.map((d) => d.id)))}
                className="text-loom-500 hover:underline">All</button>
              <button onClick={() => setSelTables(new Set())} className="text-slate-400 hover:underline">None</button>
            </div>
          </div>
          <div className="max-h-56 space-y-0.5 overflow-auto rounded-lg border border-slate-200 p-1.5 dark:border-slate-800">
            {tablesForConn.length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-400">No profiled tables on this connection yet.</div>
            ) : tablesForConn.map((d) => (
              <label key={d.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-800">
                <input type="checkbox" checked={selTables.has(d.id)} onChange={() => toggleTable(d.id)} />
                <Table2 size={12} className="shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate font-mono">{d.schema}.{d.name}</span>
                <span className="shrink-0 text-slate-400">{d.columns.length} col</span>
              </label>
            ))}
          </div>
        </div>

        <div className="card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Sparkles size={16} className="text-loom-500" /> Focus notes <span className="text-xs font-normal text-slate-400">(optional)</span>
          </div>
          <textarea className="input min-h-[70px] text-xs" value={focusNotes} onChange={(e) => setFocusNotes(e.target.value)}
            placeholder="Any specific tables, columns, or concerns to prioritise? e.g. “check payment amounts for fraud-like outliers” or “focus on the customer_id join keys”." />
        </div>

        <div className="card p-4">
          <button onClick={() => setShowAdvanced((s) => !s)}
            className="flex w-full items-center gap-2 text-sm font-semibold">
            <Settings2 size={16} className="text-loom-500" /> Thresholds
            <span className="ml-auto text-xs font-normal text-slate-400">{showAdvanced ? "hide" : "customise"}</span>
            {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {showAdvanced && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <ThresholdField label="Z-score" value={thresholds.zscore}
                onChange={(v) => setThresholds((t) => ({ ...t, zscore: v }))} step={0.5} />
              <ThresholdField label="IQR multiplier" value={thresholds.iqr_multiplier}
                onChange={(v) => setThresholds((t) => ({ ...t, iqr_multiplier: v }))} step={0.1} />
              <ThresholdField label="Outlier % → high" value={thresholds.outlier_pct_high * 100}
                onChange={(v) => setThresholds((t) => ({ ...t, outlier_pct_high: v / 100 }))} suffix="%" />
              <ThresholdField label="Duplicate % → high" value={thresholds.duplicate_pct_high * 100}
                onChange={(v) => setThresholds((t) => ({ ...t, duplicate_pct_high: v / 100 }))} suffix="%" />
              <ThresholdField label="Value sample size" value={thresholds.value_sample_size}
                onChange={(v) => setThresholds((t) => ({ ...t, value_sample_size: v }))} step={500} />
              <ThresholdField label="Row sample size" value={thresholds.row_sample_size}
                onChange={(v) => setThresholds((t) => ({ ...t, row_sample_size: v }))} step={500} />
            </div>
          )}
        </div>

        <button onClick={launch} disabled={launching || running || selTables.size === 0}
          className="btn-ai w-full justify-center">
          {launching || running ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
          Run deep analysis
        </button>

        {history.length > 0 && (
          <div className="card p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <History size={16} className="text-loom-500" /> Past reports
            </div>
            <div className="space-y-1">
              {history.map((h) => (
                <div key={h.id}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${
                    run?.id === h.id ? "bg-loom-500/10 text-loom-600 dark:text-loom-300" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
                  <button onClick={() => openHistoryRun(h.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                    {h.status === "done" ? <CheckCircle2 size={12} className="shrink-0 text-emerald-500" /> :
                     h.status === "error" ? <XCircle size={12} className="shrink-0 text-rose-500" /> :
                     h.status === "cancelled" ? <MinusCircle size={12} className="shrink-0 text-slate-400" /> :
                     <Loader2 size={12} className="shrink-0 animate-spin text-loom-500" />}
                    <span className="truncate">{timeAgo(h.created_at)} ago — {Object.keys(h.scope).length} table(s)</span>
                  </button>
                  <button onClick={() => deleteHistoryRun(h.id)} className="shrink-0 text-slate-400 hover:text-rose-500" title="Delete">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* right: live progress / results */}
      <div className="min-h-0">
        {!run ? (
          <EmptyState icon={<Microscope size={44} />} title="No analysis yet"
            hint="Pick a connection and tables on the left, then run a deep analysis — the local LLM plans which checks matter most, runs them, and writes a plain-English report." />
        ) : running ? (
          <div className="card flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <Terminal size={16} className="text-loom-500" />
              <span className="text-sm font-semibold">{PHASE_LABEL[run.phase ?? "planning"] ?? "Working…"}</span>
              <button onClick={cancel} className="btn-outline ml-auto !px-2.5 !py-1 text-xs text-rose-500 hover:bg-rose-500/10">
                <OctagonX size={12} /> Cancel
              </button>
            </div>
            <div className="px-4 pt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div className="h-full rounded-full bg-gradient-to-r from-loom-400 to-loom-600 transition-all duration-500"
                  style={{ width: `${Math.round((run.progress ?? 0) * 100)}%` }} />
              </div>
            </div>
            {run.plan?.narrative && (
              <div className="mx-4 mt-3 flex items-start gap-1.5 rounded-lg border border-loom-500/30 bg-loom-500/5 p-2.5 text-xs text-slate-600 dark:text-slate-300">
                <Sparkles size={13} className="mt-0.5 shrink-0 text-loom-500" /> {run.plan.narrative}
              </div>
            )}
            <div ref={logRef} className="min-h-[300px] flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
              {run.logs.length === 0 ? <div className="text-slate-400">Initializing…</div> : run.logs.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <span className="select-none text-slate-600">{new Date(l.ts * 1000).toLocaleTimeString()}</span>
                  <span className={
                    l.level === "ok" ? "text-emerald-400" : l.level === "warn" ? "text-amber-400" :
                    l.level === "error" ? "text-rose-400" : l.level === "agent" ? "text-loom-400" :
                    l.level === "done" ? "text-emerald-300" : "text-slate-400"}>{l.message}</span>
                </div>
              ))}
            </div>
          </div>
        ) : run.status === "error" ? (
          <EmptyState icon={<XCircle size={44} className="text-rose-500" />} title="Analysis failed"
            hint={run.error || "See the log for details."} />
        ) : run.status === "cancelled" ? (
          <EmptyState icon={<MinusCircle size={44} />} title="Analysis cancelled" hint="Run it again when ready." />
        ) : (
          <div className="space-y-4">
            <div className="card flex flex-wrap items-center gap-4 p-4">
              <div>
                <div className="text-2xl font-bold">{totalFindings}</div>
                <div className="text-xs text-slate-400">finding(s) across {run.tables.length} table(s)</div>
              </div>
              <div className="h-8 w-px bg-slate-200 dark:bg-slate-800" />
              <div>
                <div className={`text-2xl font-bold ${highCount > 0 ? "text-rose-500" : "text-emerald-500"}`}>{highCount}</div>
                <div className="text-xs text-slate-400">table(s) at high risk</div>
              </div>
              <button onClick={exportPDF} disabled={exporting} className="btn-ai ml-auto">
                {exporting ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />} Export PDF report
              </button>
            </div>
            {run.plan?.narrative && (
              <div className="card flex items-start gap-2 p-3.5 text-sm text-slate-600 dark:text-slate-300">
                <ListChecks size={15} className="mt-0.5 shrink-0 text-loom-500" />
                <span><b>Analysis strategy:</b> {run.plan.narrative}</span>
              </div>
            )}
            {run.tables.length === 0 ? (
              <EmptyState icon={<CheckCircle2 size={44} className="text-emerald-500" />} title="No findings"
                hint="The deep analysis didn't turn up anything worth flagging in the selected scope." />
            ) : [...run.tables].sort((a, b) =>
                ({ high: 0, medium: 1, low: 2 }[a.interpretation.risk_level] -
                 { high: 0, medium: 1, low: 2 }[b.interpretation.risk_level]))
              .map((t) => <TableResultCard key={t.dataset_id} table={t} />)}
          </div>
        )}
      </div>
      {dialog}
    </div>
  );
}

function ThresholdField({ label, value, onChange, step = 1, suffix }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string;
}) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] text-slate-500">{label}</span>
      <div className="relative">
        <input type="number" step={step} className="input !py-1 text-xs" value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)} />
        {suffix && <span className="pointer-events-none absolute right-2 top-1.5 text-slate-400">{suffix}</span>}
      </div>
    </label>
  );
}

function TableResultCard({ table }: { table: QualityTableResult }) {
  const [open, setOpen] = useState(true);
  const risk = table.interpretation.risk_level;
  const byIndex = new Map(table.findings.map((f, i) => [i, f]));
  const highlighted = new Set(table.interpretation.highlights.map((h) => h.finding_index));
  const rest = table.findings.filter((_, i) => !highlighted.has(i));

  return (
    <div className={`card overflow-hidden border ${RISK_RING[risk]}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2.5 p-4 text-left">
        {risk === "high" ? <AlertTriangle size={18} className="shrink-0 text-rose-500" /> :
         risk === "medium" ? <AlertTriangle size={18} className="shrink-0 text-amber-500" /> :
         <CheckCircle2 size={18} className="shrink-0 text-loom-500" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono font-semibold">{table.name}</span>
            <span className={`chip shrink-0 ${SEV_CHIP[risk]}`}>{risk} risk</span>
            <span className="chip shrink-0 bg-slate-500/10 text-slate-400">{table.findings.length} finding(s)</span>
          </div>
          <p className="mt-1 text-sm text-slate-500">{table.interpretation.summary}</p>
        </div>
        {open ? <ChevronDown size={16} className="shrink-0 text-slate-400" /> : <ChevronRight size={16} className="shrink-0 text-slate-400" />}
      </button>
      {open && (
        <div className="space-y-2 border-t border-slate-200 p-4 dark:border-slate-800">
          {table.interpretation.highlights.map((h, i) => {
            const f = byIndex.get(h.finding_index);
            if (!f) return null;
            return (
              <div key={i} className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${SEV_DOT[f.severity]}`} />
                  <span className="font-mono font-semibold">{f.column ? `${f.column} · ` : ""}{f.kind.replace(/_/g, " ")}</span>
                  <span className={`chip shrink-0 ${SEV_CHIP[f.severity]}`}>{f.severity}</span>
                </div>
                <p className="mt-1.5 text-slate-600 dark:text-slate-300">{f.message}</p>
                {h.explanation && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-loom-600 dark:text-loom-300">
                    <Sparkles size={11} className="mt-0.5 shrink-0" /> {h.explanation}
                  </p>
                )}
                {h.suggested_action && (
                  <p className="mt-1 flex items-start gap-1.5 text-slate-500">
                    <Wrench size={11} className="mt-0.5 shrink-0" /> {h.suggested_action}
                  </p>
                )}
              </div>
            );
          })}
          {rest.length > 0 && (
            <details className="rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-800">
              <summary className="cursor-pointer text-slate-400">{rest.length} more minor finding(s)</summary>
              <div className="mt-2 space-y-1">
                {rest.map((f, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${SEV_DOT[f.severity]}`} />
                    <span className="text-slate-500">{f.column ? `${f.column}: ` : ""}{f.message}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ---- PDF export — renders an off-screen, print-styled report and rasterizes it --- //
async function exportQualityReportPDF(run: QualityRun, connName: string) {
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-99999px;top:0;width:800px;background:#ffffff;";
  container.innerHTML = buildReportHTML(run, connName);
  document.body.appendChild(container);
  try {
    const canvas = await html2canvas(container, { scale: 2, backgroundColor: "#ffffff", windowWidth: 800 });
    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const imgData = canvas.toDataURL("image/png");
    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    const dateStr = new Date().toISOString().slice(0, 10);
    pdf.save(`data-quality-report-${connName.replace(/\s+/g, "-").toLowerCase()}-${dateStr}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildReportHTML(run: QualityRun, connName: string): string {
  const font = "font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;";
  const totalFindings = run.tables.reduce((s, t) => s + t.findings.length, 0);
  const highCount = run.tables.filter((t) => t.interpretation.risk_level === "high").length;
  const medCount = run.tables.filter((t) => t.interpretation.risk_level === "medium").length;
  const riskColor: Record<string, string> = { high: "#e11d48", medium: "#f59e0b", low: "#009f3d" };
  const sevColor: Record<string, string> = { high: "#e11d48", medium: "#f59e0b", low: "#94a3b8" };

  const tableSections = [...run.tables].sort((a, b) =>
      ({ high: 0, medium: 1, low: 2 }[a.interpretation.risk_level] - { high: 0, medium: 1, low: 2 }[b.interpretation.risk_level]))
    .map((t) => {
      const rc = riskColor[t.interpretation.risk_level];
      const byIndex = new Map(t.findings.map((f, i) => [i, f]));
      const rows = t.interpretation.highlights.map((h) => {
        const f = byIndex.get(h.finding_index);
        if (!f) return "";
        const sc = sevColor[f.severity];
        return `<tr>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;white-space:nowrap;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${sc};margin-right:6px;"></span>
            <span style="font-size:11px;font-weight:600;color:${sc};text-transform:uppercase;">${esc(f.severity)}</span>
          </td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-family:ui-monospace,monospace;font-size:12px;">${esc(f.column || "(table)")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#334155;">
            ${esc(f.message)}
            ${h.explanation ? `<div style="margin-top:4px;color:#009f3d;">✦ ${esc(h.explanation)}</div>` : ""}
            ${h.suggested_action ? `<div style="margin-top:2px;color:#64748b;">→ ${esc(h.suggested_action)}</div>` : ""}
          </td>
        </tr>`;
      }).join("");
      return `
      <div style="margin-top:22px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;page-break-inside:avoid;">
        <div style="padding:14px 16px;border-left:5px solid ${rc};background:#f8fafc;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-family:ui-monospace,monospace;font-weight:700;font-size:14px;color:#0f172a;">${esc(t.name)}</span>
            <span style="font-size:11px;font-weight:700;color:${rc};text-transform:uppercase;letter-spacing:.03em;">${esc(t.interpretation.risk_level)} risk</span>
            <span style="margin-left:auto;font-size:11px;color:#94a3b8;">~${t.row_estimate.toLocaleString()} rows · ${t.findings.length} finding(s)</span>
          </div>
          <p style="margin:8px 0 0;font-size:12.5px;color:#475569;line-height:1.5;">${esc(t.interpretation.summary)}</p>
        </div>
        ${rows ? `<table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:#fff;">
            <th style="text-align:left;padding:6px 10px;font-size:10px;color:#94a3b8;text-transform:uppercase;">Severity</th>
            <th style="text-align:left;padding:6px 10px;font-size:10px;color:#94a3b8;text-transform:uppercase;">Column</th>
            <th style="text-align:left;padding:6px 10px;font-size:10px;color:#94a3b8;text-transform:uppercase;">Finding</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>` : `<div style="padding:14px 16px;font-size:12px;color:#94a3b8;">No highlighted findings.</div>`}
      </div>`;
    }).join("");

  return `
    <div style="${font}padding:36px 40px;color:#0f172a;">
      <div style="display:flex;align-items:center;gap:10px;border-bottom:3px solid #009f3d;padding-bottom:16px;">
        <div style="width:36px;height:36px;border-radius:9px;background:linear-gradient(135deg,#40b76e,#00722c);"></div>
        <div>
          <div style="font-size:19px;font-weight:800;">DOINg.Catalogue</div>
          <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">Data Quality Report</div>
        </div>
        <div style="margin-left:auto;text-align:right;font-size:11px;color:#94a3b8;">
          <div>${esc(connName)}</div>
          <div>${new Date(run.finished_at ? run.finished_at * 1000 : Date.now()).toLocaleString()}</div>
        </div>
      </div>

      <div style="display:flex;gap:14px;margin-top:20px;">
        <div style="flex:1;border:1px solid #e2e8f0;border-radius:10px;padding:14px;">
          <div style="font-size:24px;font-weight:800;">${run.tables.length}</div>
          <div style="font-size:11px;color:#94a3b8;">table(s) analysed</div>
        </div>
        <div style="flex:1;border:1px solid #e2e8f0;border-radius:10px;padding:14px;">
          <div style="font-size:24px;font-weight:800;">${totalFindings}</div>
          <div style="font-size:11px;color:#94a3b8;">finding(s) total</div>
        </div>
        <div style="flex:1;border:1px solid #e2e8f0;border-radius:10px;padding:14px;">
          <div style="font-size:24px;font-weight:800;color:#e11d48;">${highCount}</div>
          <div style="font-size:11px;color:#94a3b8;">high-risk table(s)</div>
        </div>
        <div style="flex:1;border:1px solid #e2e8f0;border-radius:10px;padding:14px;">
          <div style="font-size:24px;font-weight:800;color:#f59e0b;">${medCount}</div>
          <div style="font-size:11px;color:#94a3b8;">medium-risk table(s)</div>
        </div>
      </div>

      ${run.plan?.narrative ? `<div style="margin-top:18px;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:10px;padding:14px 16px;">
        <div style="font-size:11px;font-weight:700;color:#008934;text-transform:uppercase;margin-bottom:4px;">Analysis strategy</div>
        <div style="font-size:12.5px;color:#166534;line-height:1.5;">${esc(run.plan.narrative)}</div>
      </div>` : ""}

      ${tableSections}

      <div style="margin-top:28px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8;">
        Generated by DOINg.Catalogue's Data Quality Checks module — statistical checks (outlier detection, pattern
        consistency, duplicate rows) combined with local-LLM planning and interpretation. Thresholds: z-score
        ${run.thresholds.zscore}, IQR × ${run.thresholds.iqr_multiplier}, outlier severity cutoff
        ${(run.thresholds.outlier_pct_high * 100).toFixed(0)}%. Review findings before acting on them.
      </div>
    </div>`;
}
