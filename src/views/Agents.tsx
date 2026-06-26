import { useEffect, useMemo, useRef } from "react";
import {
  ScanLine, GitCompare, BookOpen, Workflow, ShieldCheck, Tags, Bot,
  Zap, Loader2, CheckCircle2, XCircle, Terminal, ShieldAlert, X,
} from "lucide-react";
import { useCatalog } from "../store";
import { api } from "../api";
import { EmptyState } from "../lib/ui";

const ICONS: Record<string, typeof Bot> = {
  "scan-line": ScanLine, "git-compare": GitCompare, "book-open": BookOpen,
  workflow: Workflow, "shield-check": ShieldCheck, tags: Tags,
};

const LOG_COLORS: Record<string, string> = {
  agent: "text-loom-400", ok: "text-emerald-400", info: "text-slate-400",
  warn: "text-amber-400", error: "text-rose-400", done: "text-emerald-300", default: "text-slate-400",
};

export function Agents() {
  const { state, health, activeRun, setActiveRun, mutate, toast } = useCatalog();
  const logRef = useRef<HTMLDivElement>(null);
  const agents = health?.agents ?? [];

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [activeRun?.logs.length]);

  const firstConn = state?.connections[0];
  const running = activeRun && (activeRun.status === "running" || activeRun.status === "queued");

  const launch = async (agentIds: string[] | null) => {
    if (!firstConn) { toast("err", "Add a connection first."); return; }
    const r = await mutate((v) => api.launchRun(firstConn.id, agentIds, v));
    if (r) { setActiveRun(r.run); toast("info", "Agents started"); }
  };

  const dismissQA = async (idx: number) => {
    await mutate((v) => api.dismissQA(idx, v));
    toast("ok", "Issue dismissed");
  };

  const qa = state?.qa_issues ?? [];
  const qaCounts = useMemo(() => ({
    high: qa.filter((i) => i.severity === "high").length,
    medium: qa.filter((i) => i.severity === "medium").length,
    low: qa.filter((i) => i.severity === "low").length,
  }), [qa]);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
      {/* left: agents + history */}
      <div className="space-y-5">
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Bot size={18} className="text-loom-500" /> Built-in agents
            </div>
            <button onClick={() => launch(null)} disabled={!!running} className="btn-primary">
              {running ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
              Magic Enrich
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Orchestrated as a pipeline, or run individually. Local LLM is{" "}
            <span className={health?.llm.up ? "text-emerald-500" : "text-rose-500"}>
              {health?.llm.up ? "active" : "offline (heuristic fallback)"}</span>.
          </p>

          <div className="mt-4 space-y-2">
            {agents.map((a, idx) => {
              const Icon = ICONS[a.icon] ?? Bot;
              const isCurrent = running && activeRun?.current_agent === a.name;
              const done = activeRun?.summary?.[a.id];
              return (
                <div key={a.id}
                  className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                    isCurrent ? "border-loom-500 bg-loom-500/5" : "border-slate-200 dark:border-slate-800"
                  }`}>
                  <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
                    isCurrent ? "bg-loom-500 text-white" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}>
                    {isCurrent ? <Loader2 size={17} className="animate-spin" /> : <Icon size={17} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{idx + 1}. {a.name}</span>
                      {done && <CheckCircle2 size={14} className="text-emerald-500" />}
                    </div>
                    <div className="text-xs text-slate-400">{a.desc}</div>
                    {done && (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {Object.entries(done).map(([k, v]) => (
                          <span key={k} className="chip bg-emerald-500/10 text-emerald-500">{k}: {String(v)}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => launch([a.id])} disabled={!!running}
                    className="btn-ghost shrink-0 text-xs">Run</button>
                </div>
              );
            })}
          </div>
        </div>

        {/* QA issues */}
        {qa.length > 0 && (
          <div className="card p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <ShieldAlert size={16} className="text-amber-500" /> Quality audit
              <span className="ml-auto flex gap-1.5 text-xs">
                <span className="chip bg-rose-500/10 text-rose-500">{qaCounts.high} critical</span>
                <span className="chip bg-amber-500/10 text-amber-500">{qaCounts.medium} medium</span>
                <span className="chip bg-slate-500/10 text-slate-500">{qaCounts.low} low</span>
              </span>
            </div>
            <div className="max-h-64 space-y-1 overflow-auto">
              {qa.map((issue, k) => (
                <div key={k} className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${
                    issue.severity === "high" ? "bg-rose-500" : issue.severity === "medium" ? "bg-amber-500" : "bg-slate-400"}`} />
                  <span className="flex-1 text-slate-500">{issue.message}</span>
                  <button onClick={() => dismissQA(k)}
                    className="text-slate-400 hover:text-rose-500 shrink-0" title="Dismiss">
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* run history */}
        {(state?.runs.length ?? 0) > 0 && (
          <div className="card p-5">
            <div className="mb-3 text-sm font-semibold">Run history</div>
            <div className="space-y-1.5">
              {state!.runs.slice(0, 8).map((r) => (
                <button key={r.id} onClick={() => setActiveRun(r)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800">
                  {r.status === "done" ? <CheckCircle2 size={14} className="text-emerald-500" /> :
                    r.status === "error" ? <XCircle size={14} className="text-rose-500" /> :
                    <Loader2 size={14} className="animate-spin text-loom-500" />}
                  <span className="font-mono text-slate-400">{r.id.replace("run_", "#")}</span>
                  <span className="text-slate-500">{r.agents.length} agents</span>
                  <span className="ml-auto text-slate-400">{Math.round(r.progress * 100)}%</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* right: live console */}
      <div className="card flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <Terminal size={15} className="text-loom-500" />
          <span className="text-sm font-semibold">Agent console</span>
          {running && (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-500">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              {activeRun?.current_agent}
            </span>
          )}
        </div>

        {activeRun && (
          <div className="px-4 pt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div className="h-full rounded-full bg-gradient-to-r from-loom-500 to-violet-500 transition-all duration-500"
                style={{ width: `${Math.round((activeRun.progress ?? 0) * 100)}%` }} />
            </div>
          </div>
        )}

        <div ref={logRef} className="min-h-[420px] flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
          {!activeRun ? (
            <EmptyState icon={<Terminal size={36} />} title="No run yet"
              hint="Click Magic Enrich to watch agents work in real time." />
          ) : activeRun.logs.length === 0 ? (
            <div className="text-slate-400">Initializing…</div>
          ) : (
            activeRun.logs.map((l, i) => (
              <div key={i} className="flex gap-2">
                <span className="select-none text-slate-600">{new Date(l.ts * 1000).toLocaleTimeString()}</span>
                <span className={LOG_COLORS[l.level] ?? LOG_COLORS.default}>{l.message}</span>
              </div>
            ))
          )}
          {activeRun?.status === "done" && (
            <div className="mt-2 flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 size={14} /> Done.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
