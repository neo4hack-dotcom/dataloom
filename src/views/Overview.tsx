import { useMemo } from "react";
import {
  Table2, Columns3, GitCompare, Workflow, ShieldAlert, Sparkles,
  Zap, Database, TrendingUp, Lock,
} from "lucide-react";
import { useCatalog } from "../store";
import { api } from "../api";
import { Stat, Donut, EmptyState, semanticColor, shortDs } from "../lib/ui";
import type { Tab } from "../App";

export function Overview({ goto }: { goto: (t: Tab) => void }) {
  const { state, mutate, setActiveRun, toast } = useCatalog();

  const m = useMemo(() => {
    const datasets = state?.datasets ?? [];
    const cols = datasets.flatMap((d) => d.columns);
    const docs = state?.docs ?? {};
    const documented = cols.filter((c) => {
      const cd = docs[c.dataset_id]?.columns?.[c.name];
      return cd?.definition;
    }).length;
    const pii = cols.filter((c) => c.profile.sensitivity === "PII").length;
    const avgQ = cols.length ? cols.reduce((s, c) => s + c.profile.quality_score, 0) / cols.length : 0;
    const semCount: Record<string, number> = {};
    for (const c of cols) semCount[c.profile.semantic_type] = (semCount[c.profile.semantic_type] ?? 0) + 1;
    return {
      datasets: datasets.length, cols: cols.length, documented,
      coverage: cols.length ? Math.round((documented / cols.length) * 100) : 0,
      pii, avgQ, semCount, allCols: cols,
    };
  }, [state]);

  const hasData = m.datasets > 0;
  const firstConn = state?.connections[0];

  const launchMagic = async () => {
    if (!firstConn) { goto("connections"); return; }
    const r = await mutate((v) => api.launchRun(firstConn.id, null, v));
    if (r) { setActiveRun(r.run); goto("agents"); toast("info", "Magic Enrich started ✨"); }
  };

  const semPalette = ["#3b74f5", "#ec4899", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#f97316", "#14b8a6"];
  const semSegments = Object.entries(m.semCount)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([k, v], i) => ({ value: v, color: semPalette[i % semPalette.length], label: k }));

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="card relative overflow-hidden p-6">
        <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-gradient-to-br from-loom-500/20 to-violet-500/10 blur-2xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-loom-500">
              <Sparkles size={14} /> Autonomous Catalog
            </div>
            <h2 className="mt-1 text-2xl font-bold">Weave your data dictionary</h2>
            <p className="mt-1 max-w-xl text-sm text-slate-500">
              Value-fingerprinting, key detection via real overlap tests, and enrichment
              by local LLM agents. One click and DOINg.Catalogue rebuilds your data chains.
            </p>
          </div>
          <button onClick={launchMagic} className="btn-primary !px-5 !py-2.5 text-base shadow-lg">
            <Zap size={18} /> Magic Enrich
          </button>
        </div>
      </div>

      {!hasData ? (
        <EmptyState
          icon={<Database size={48} />}
          title="No source connected"
          hint={<>Add a connection (or use <b>Demo</b> mode) then run the agent pipeline to populate the catalog.</>}
        />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Tables" value={m.datasets} icon={<Table2 size={22} />} />
            <Stat label="Columns" value={m.cols} icon={<Columns3 size={22} />} />
            <Stat label="PK/FK Relationships" value={state?.relationships.length ?? 0}
              sub={`${state?.matches.length ?? 0} identical fields`} icon={<GitCompare size={22} />} accent="text-violet-500" />
            <Stat label="PII Fields" value={m.pii} sub="sensitivity detected"
              icon={<Lock size={22} />} accent="text-rose-500" />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* coverage donut */}
            <div className="card p-5">
              <div className="mb-3 text-sm font-semibold">Documentation coverage</div>
              <div className="flex items-center gap-5">
                <Donut
                  segments={[
                    { value: m.documented, color: "#3b74f5" },
                    { value: m.cols - m.documented, color: "transparent" },
                  ]}
                  center={<div className="text-center"><div className="text-2xl font-bold">{m.coverage}%</div>
                    <div className="text-[10px] text-slate-400">documented</div></div>} />
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-loom-500" />
                    {m.documented} columns documented</div>
                  <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-slate-700" />
                    {m.cols - m.documented} to enrich</div>
                  <div className="flex items-center gap-2 pt-1 text-slate-500">
                    <TrendingUp size={15} className="text-emerald-500" /> Avg. quality {m.avgQ.toFixed(0)}/100</div>
                </div>
              </div>
            </div>

            {/* semantic distribution */}
            <div className="card p-5">
              <div className="mb-3 text-sm font-semibold">Semantic types</div>
              <div className="flex items-center gap-5">
                <Donut segments={semSegments} center={<div className="text-center">
                  <div className="text-xl font-bold">{Object.keys(m.semCount).length}</div>
                  <div className="text-[10px] text-slate-400">types</div></div>} />
                <div className="grid flex-1 grid-cols-1 gap-1 text-xs">
                  {semSegments.slice(0, 6).map((s) => (
                    <div key={s.label} className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                      <span className={`chip flex-1 truncate ${semanticColor(s.label)}`}>{s.label}</span>
                      <span className="font-mono text-slate-400">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* QA snapshot */}
            <div className="card p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <ShieldAlert size={16} className="text-amber-500" /> Quality audit
              </div>
              {(state?.qa_issues.length ?? 0) === 0 ? (
                <div className="py-6 text-center text-sm text-slate-400">Run the pipeline to audit quality.</div>
              ) : (
                <div className="space-y-2">
                  {(["high", "medium", "low"] as const).map((sev) => {
                    const n = state!.qa_issues.filter((i) => i.severity === sev).length;
                    const color = sev === "high" ? "bg-rose-500" : sev === "medium" ? "bg-amber-500" : "bg-slate-400";
                    const label = sev === "high" ? "Critical" : sev === "medium" ? "Medium" : "Low";
                    return (
                      <div key={sev} className="flex items-center gap-2 text-sm">
                        <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
                        <span className="flex-1 text-slate-500">{label}</span>
                        <span className="font-mono font-semibold">{n}</span>
                      </div>
                    );
                  })}
                  <button onClick={() => goto("agents")} className="btn-ghost mt-1 w-full justify-center text-xs">
                    View details →
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* top relations preview */}
          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Workflow size={16} className="text-loom-500" /> Detected data chains
              </div>
              <button onClick={() => goto("relationships")} className="btn-ghost text-xs">View all →</button>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {(state?.relationships ?? []).slice(0, 6).map((r, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                  <span className="font-mono text-xs text-slate-500">{shortDs(r.child.dataset_id)}.{r.child.column}</span>
                  <span className="text-loom-500">→</span>
                  <span className="font-mono text-xs">{shortDs(r.parent.dataset_id)}.{r.parent.column}</span>
                  <span className="ml-auto font-mono text-xs text-emerald-500">{r.confidence.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
