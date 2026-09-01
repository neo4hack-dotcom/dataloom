import { useEffect, useState } from "react";
import { Activity, Database, History, Loader2, OctagonX, Clock } from "lucide-react";
import { api } from "../api";
import { useCatalog } from "../store";
import { EmptyState } from "../lib/ui";
import type { QueryLogEntry } from "../types";

function Duration({ start, end }: { start: number; end: number | null }) {
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    if (end) return;
    const t = setInterval(() => setNow(Date.now() / 1000), 500);
    return () => clearInterval(t);
  }, [end]);
  const s = (end ?? now) - start;
  return <span className="font-mono tabular-nums">{s < 60 ? `${s.toFixed(1)}s` : `${(s / 60).toFixed(1)}min`}</span>;
}

const STATUS_STYLE: Record<string, string> = {
  running: "text-loom-500 bg-loom-500/10",
  done: "text-emerald-500 bg-emerald-500/10",
  cancelled: "text-amber-500 bg-amber-500/10",
  error: "text-rose-500 bg-rose-500/10",
};

const SOURCE_LABEL: Record<string, string> = {
  profiler: "Profiler", discover: "Discovery", mapping: "ETL mapping", mcp: "MCP", pipeline: "Pipeline",
};

export function QueryLog() {
  const { toast } = useCatalog();
  const [active, setActive] = useState<QueryLogEntry[]>([]);
  const [recent, setRecent] = useState<QueryLogEntry[]>([]);
  const [cancelling, setCancelling] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const r = await api.listQueries();
        if (!stop) { setActive(r.active); setRecent(r.recent); }
      } catch { /* ignore transient errors while polling */ }
      finally { if (!stop) setLoading(false); }
    };
    poll();
    const t = setInterval(poll, 1500);
    return () => { stop = true; clearInterval(t); };
  }, []);

  const cancel = async (id: string) => {
    setCancelling((s) => new Set(s).add(id));
    try {
      await api.cancelQuery(id);
      toast("ok", "Cancellation requested");
    } catch (e) {
      toast("err", (e as Error).message);
    } finally {
      setCancelling((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Activity size={16} className="text-loom-500" /> Running now
          <span className="chip bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{active.length}</span>
        </div>
        {loading ? (
          <div className="card p-6 text-sm text-slate-400">Loading…</div>
        ) : active.length === 0 ? (
          <EmptyState icon={<Database size={28} />} title="No query is running against a source right now"
            hint="Launch a profiling run or an MCP tool call to see it here in real time." />
        ) : (
          <div className="card divide-y divide-slate-100 dark:divide-slate-800/60">
            {active.map((q) => (
              <div key={q.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="chip bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {SOURCE_LABEL[q.source] ?? q.source}
                </span>
                <span className="w-32 shrink-0 truncate text-xs font-medium text-slate-400">{q.connection_name}</span>
                <span className="font-mono text-xs">{q.operation}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-500">{q.target}</span>
                {q.row_limit != null && (
                  <span className="chip bg-loom-500/10 text-loom-500">limit {q.row_limit}</span>
                )}
                <span className="flex items-center gap-1 text-xs text-slate-400">
                  <Clock size={12} /> <Duration start={q.started_at} end={q.finished_at} />
                </span>
                <button onClick={() => cancel(q.id)} disabled={cancelling.has(q.id)}
                  className="btn-outline !px-2 !py-1 text-xs text-rose-500 hover:bg-rose-500/10">
                  {cancelling.has(q.id) ? <Loader2 size={13} className="animate-spin" /> : <OctagonX size={13} />}
                  Cancel
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <History size={16} className="text-slate-400" /> Recent
        </div>
        {recent.length === 0 ? (
          <div className="card p-6 text-sm text-slate-400">Nothing yet.</div>
        ) : (
          <div className="card divide-y divide-slate-100 dark:divide-slate-800/60">
            {recent.slice(0, 80).map((q) => (
              <div key={q.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className={`chip ${STATUS_STYLE[q.status] ?? ""}`}>{q.status}</span>
                <span className="chip bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {SOURCE_LABEL[q.source] ?? q.source}
                </span>
                <span className="w-32 shrink-0 truncate text-xs font-medium text-slate-400">{q.connection_name}</span>
                <span className="font-mono text-xs">{q.operation}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-500">{q.target}</span>
                {q.rows_returned != null && (
                  <span className="text-xs text-slate-400">{q.rows_returned} rows</span>
                )}
                {q.finished_at && (
                  <span className="flex items-center gap-1 text-xs text-slate-400">
                    <Clock size={12} /> <Duration start={q.started_at} end={q.finished_at} />
                  </span>
                )}
                {q.error && <span className="max-w-xs truncate text-xs text-rose-500" title={q.error}>{q.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
