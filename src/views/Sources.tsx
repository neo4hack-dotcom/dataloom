import { useEffect, useMemo, useRef, useState } from "react";
import {
  Database, RefreshCw, Loader2, Search, CheckSquare, Square, Zap, Save,
  Filter, Layers, Table2, X, ListChecks, MinusSquare, Hash, OctagonX,
  CheckCircle2, XCircle, MinusCircle, RotateCcw,
} from "lucide-react";
import { useCatalog } from "../store";
import { api } from "../api";
import { EmptyState, timeAgo } from "../lib/ui";
import { useConfirm } from "../components/ConfirmDialog";
import type { DiscoveredTable } from "../types";
import type { Tab } from "../App";

const ROW_H = 38;       // px per row (for windowing)
const OVERSCAN = 8;
const DEFAULT_SAMPLE_LIMIT = 500;
const LARGE_BATCH_WARNING = 50;

const fmtCount = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : n.toLocaleString();

export function Sources({ goto }: { goto: (t: Tab) => void }) {
  const { state, activeConn, setActiveConn, mutate, setActiveRun, toast } = useCatalog();
  const conns = state?.connections ?? [];
  const { confirm, dialog } = useConfirm();

  // which connection are we scoping
  const [cid, setCid] = useState<string>(
    () => (activeConn !== "all" ? activeConn : conns[0]?.id) ?? "");
  useEffect(() => {
    if (!cid && conns[0]) setCid(conns[0].id);
  }, [conns, cid]);

  const conn = conns.find((c) => c.id === cid) ?? null;
  const inventory = conn?.discovered_tables ?? [];

  const [discovering, setDiscovering] = useState(false);
  const [q, setQ] = useState("");
  const [schemaFilter, setSchemaFilter] = useState<string>("all");
  const [onlyNew, setOnlyNew] = useState(false);
  const [sel, setSel] = useState<Set<string>>(() => new Set(conn?.scope ?? []));
  const [rowLimits, setRowLimits] = useState<Record<string, number>>(() => conn?.scope_row_limits ?? {});

  // re-seed selection + limits when switching connection
  useEffect(() => {
    setSel(new Set(conn?.scope ?? []));
    setRowLimits(conn?.scope_row_limits ?? {});
  }, [cid]); // eslint-disable-line

  const cataloged = useMemo(() => {
    const s = new Set<string>();
    for (const d of state?.datasets ?? [])
      if (d.connection_id === cid) s.add(`${d.schema}.${d.name}`);
    return s;
  }, [state?.datasets, cid]);

  const schemas = useMemo(
    () => [...new Set(inventory.map((t) => t.schema))].sort(), [inventory]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return inventory.filter((t) => {
      if (schemaFilter !== "all" && t.schema !== schemaFilter) return false;
      if (onlyNew && cataloged.has(`${t.schema}.${t.name}`)) return false;
      if (ql && !`${t.schema}.${t.name}`.toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [inventory, q, schemaFilter, onlyNew, cataloged]);

  const selectedTables = useMemo(
    () => inventory.filter((t) => sel.has(`${t.schema}.${t.name}`)),
    [inventory, sel]);

  const discover = async () => {
    if (!cid) return;
    setDiscovering(true);
    try {
      const r = await mutate((v) => api.discover(cid, v));
      if (r) toast("ok", `Discovered ${r.count} tables`);
    } finally { setDiscovering(false); }
  };

  const key = (t: DiscoveredTable) => `${t.schema}.${t.name}`;
  const toggle = (k: string) => setSel((s) => {
    const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n;
  });
  const selectAllFiltered = () => setSel((s) => {
    const n = new Set(s); filtered.forEach((t) => n.add(key(t))); return n;
  });
  const clearFiltered = () => setSel((s) => {
    const n = new Set(s); filtered.forEach((t) => n.delete(key(t))); return n;
  });
  const invertFiltered = () => setSel((s) => {
    const n = new Set(s);
    filtered.forEach((t) => { const k = key(t); n.has(k) ? n.delete(k) : n.add(k); });
    return n;
  });

  const limitsForSelection = () => {
    const out: Record<string, number> = {};
    for (const k of sel) out[k] = rowLimits[k] ?? DEFAULT_SAMPLE_LIMIT;
    return out;
  };

  const saveScope = async () => {
    await mutate((v) => api.setScope(cid, [...sel], v, limitsForSelection()));
    toast("ok", `Scope saved — ${sel.size} table(s)`);
  };

  const alreadyCatalogedCount = useMemo(
    () => [...sel].filter((k) => cataloged.has(k)).length, [sel, cataloged]);

  const runOnScope = async () => {
    if (sel.size === 0) { toast("err", "Select at least one table"); return; }
    if (alreadyCatalogedCount > 0) {
      const ok = await confirm({
        title: "Re-run on already-catalogued tables?",
        message: `${alreadyCatalogedCount} of your ${sel.size} selected table(s) are already in the catalog. Running agents again may overwrite existing profiling/documentation.`,
        tone: "warning", steps: 2, confirmLabel: "Run again",
      });
      if (!ok) return;
    }
    // Chain off the version returned by setScope itself — mutate()'s own `v` here would
    // still be the stale pre-save version captured by this closure, causing a 409.
    const scopeR = await mutate((v) => api.setScope(cid, [...sel], v, limitsForSelection()));
    if (!scopeR) return;
    const r = await mutate(() => api.launchRun(cid, null, scopeR.version, [...sel]));
    if (r) {
      setActiveConn(cid);
      setActiveRun(r.run);
      goto("agents");
      toast("info", `Running agents on ${sel.size} selected table(s) ✨`);
    }
  };

  if (conns.length === 0) {
    return <EmptyState icon={<Database size={48} />} title="No source connected"
      hint={<>Add a connection first, then discover and scope its tables here.</>} />;
  }

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Database size={18} className="text-loom-500" />
          <select value={cid} onChange={(e) => { setCid(e.target.value); }}
            className="input max-w-xs !py-1.5 text-sm font-medium">
            {conns.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
          </select>
          <button onClick={discover} disabled={discovering} className="btn-outline">
            {discovering ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            {inventory.length ? "Re-discover" : "Discover tables"}
          </button>
          <span className="text-xs text-slate-400">
            {inventory.length > 0
              ? <>{inventory.length.toLocaleString()} tables in source · {cataloged.size} already catalogued</>
              : "Discover the source's table inventory (no profiling — instant even for 1000s of tables)."}
          </span>
        </div>
      </div>

      {inventory.length === 0 ? (
        <EmptyState icon={<ListChecks size={44} />} title="No inventory yet"
          hint="Click “Discover tables” to list this source's tables without profiling them." />
      ) : (
        <>
          {/* filters */}
          <div className="card flex flex-wrap items-center gap-2 p-3">
            <div className="relative min-w-[200px] flex-1">
              <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name or schema…"
                className="input !py-1.5 !pl-8 text-sm" />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              <Filter size={13} />
              <select value={schemaFilter} onChange={(e) => setSchemaFilter(e.target.value)}
                className="input !py-1.5 text-xs">
                <option value="all">All schemas ({schemas.length})</option>
                {schemas.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <button onClick={() => setOnlyNew((v) => !v)}
              className={`chip border ${onlyNew ? "border-loom-500 bg-loom-500/10 text-loom-600 dark:text-loom-300" : "border-slate-200 text-slate-500 dark:border-slate-700"}`}>
              Not yet catalogued
            </button>
            <span className="ml-auto text-xs text-slate-400">{filtered.length.toLocaleString()} shown</span>
          </div>

          {/* bulk actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={selectAllFiltered} className="btn-ghost text-xs"><CheckSquare size={14} /> Select all filtered</button>
            <button onClick={clearFiltered} className="btn-ghost text-xs"><Square size={14} /> Clear filtered</button>
            <button onClick={invertFiltered} className="btn-ghost text-xs"><MinusSquare size={14} /> Invert</button>
            <span className={`chip ml-auto ${sel.size ? "bg-loom-500/10 text-loom-600 dark:text-loom-300" : "bg-slate-500/10 text-slate-400"}`}>
              {sel.size.toLocaleString()} selected — scope
            </span>
          </div>

          {/* virtualized table list */}
          <VirtualList rows={filtered} sel={sel} onToggle={toggle} cataloged={cataloged} />

          {/* row-count check for the selected candidates — opt-in, sequential, cancellable */}
          {sel.size > 0 && (
            <RowCountPanel cid={cid} tables={selectedTables}
              cachedCounts={conn?.scope_row_counts} cachedCountsAt={conn?.scope_row_counts_at}
              rowLimits={rowLimits} setRowLimits={setRowLimits} confirm={confirm} />
          )}

          {/* footer actions */}
          <div className="sticky bottom-0 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/90 p-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
            <span className="text-sm text-slate-500">
              Agents will only run on your <b>{sel.size}</b> selected table(s) — never on the whole {inventory.length.toLocaleString()}-table source.
            </span>
            <div className="ml-auto flex gap-2">
              <button onClick={saveScope} className="btn-outline"><Save size={15} /> Save scope</button>
              <button onClick={runOnScope} disabled={sel.size === 0}
                className={alreadyCatalogedCount > 0 ? "btn-danger" : "btn-ai"}>
                <Zap size={15} /> Run agents on selection
              </button>
            </div>
          </div>
        </>
      )}
      {dialog}
    </div>
  );
}

// ---- row-count check: opt-in, sequential (never parallel), cancellable ---- //
type CountStatus = "idle" | "counting" | "ok" | "cancelled" | "error";

function RowCountPanel({ cid, tables, cachedCounts, cachedCountsAt, rowLimits, setRowLimits, confirm }: {
  cid: string; tables: DiscoveredTable[];
  cachedCounts?: Record<string, number>; cachedCountsAt?: Record<string, number>;
  rowLimits: Record<string, number>;
  setRowLimits: (f: (r: Record<string, number>) => Record<string, number>) => void;
  confirm: ReturnType<typeof useConfirm>["confirm"];
}) {
  const key = (t: DiscoveredTable) => `${t.schema}.${t.name}`;
  const [status, setStatus] = useState<Record<string, CountStatus>>({});
  const [counts, setCounts] = useState<Record<string, number>>(cachedCounts ?? {});
  const [countedAt, setCountedAt] = useState<Record<string, number>>(cachedCountsAt ?? {});
  const [queryIds, setQueryIds] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);

  // reset ephemeral run state (not the cache) when the candidate set changes
  useEffect(() => {
    setStatus({}); setQueryIds({});
    setCounts(cachedCounts ?? {});
    setCountedAt(cachedCountsAt ?? {});
  }, [cid]); // eslint-disable-line

  const pollForQueryId = async (tableKey: string) => {
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 150));
      try {
        const { active } = await api.listQueries();
        const match = active.find((qq) =>
          qq.connection_id === cid && qq.operation === "count_rows" && qq.target === tableKey);
        if (match) { setQueryIds((q) => ({ ...q, [tableKey]: match.id })); return; }
      } catch { /* ignore */ }
      if (status[tableKey] !== "counting") return; // already resolved
    }
  };

  const countOne = async (t: DiscoveredTable) => {
    const k = key(t);
    setStatus((s) => ({ ...s, [k]: "counting" }));
    setErrors((e) => { const n = { ...e }; delete n[k]; return n; });
    pollForQueryId(k); // fire and forget — updates queryIds when the active query shows up
    const r = await api.countTableRows(cid, t.schema, t.name);
    setQueryIds((q) => { const n = { ...q }; delete n[k]; return n; });
    if (r.ok && r.count != null) {
      setCounts((c) => ({ ...c, [k]: r.count! }));
      setCountedAt((a) => ({ ...a, [k]: Date.now() / 1000 }));
      setStatus((s) => ({ ...s, [k]: "ok" }));
    } else if (r.cancelled) {
      setStatus((s) => ({ ...s, [k]: "cancelled" }));
    } else {
      setErrors((e) => ({ ...e, [k]: r.error || "count failed" }));
      setStatus((s) => ({ ...s, [k]: "error" }));
    }
  };

  const runChecks = async (only?: DiscoveredTable[]) => {
    const targets = only ?? tables.filter((t) => status[key(t)] !== "ok");
    if (targets.length === 0) return;
    if (!only && targets.length > LARGE_BATCH_WARNING) {
      const ok = await confirm({
        title: "Count a large batch of tables?",
        message: `You're about to run ${targets.length} sequential row counts against the source. This can take a while — each one is tracked in the Query Log and you can stop the batch at any time.`,
        tone: "warning", steps: 1, confirmLabel: "Start",
      });
      if (!ok) return;
    }
    stopRef.current = false;
    setRunning(true);
    for (const t of targets) {
      if (stopRef.current) break;
      await countOne(t);
    }
    setRunning(false);
  };

  const stopBatch = async () => {
    stopRef.current = true;
    const counting = tables.find((t) => status[key(t)] === "counting");
    const qid = counting && queryIds[key(counting)];
    if (qid) { try { await api.cancelQuery(qid); } catch { /* ignore */ } }
  };

  const cancelOne = async (t: DiscoveredTable) => {
    const qid = queryIds[key(t)];
    if (qid) { try { await api.cancelQuery(qid); } catch { /* ignore */ } }
  };

  const setLimit = (t: DiscoveredTable, v: number) => {
    setRowLimits((r) => ({ ...r, [key(t)]: Math.max(1, v) }));
  };

  const checkedCount = tables.filter((t) => status[key(t)] === "ok" || counts[key(t)] != null).length;

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center gap-2">
        <Hash size={15} className="text-loom-500" />
        <div className="text-sm font-semibold">Row-count check</div>
        <span className="text-xs text-slate-400">— optional, one table at a time, never touches the DB until you ask</span>
        <span className="ml-auto chip bg-slate-500/10 text-slate-400">{checkedCount}/{tables.length} checked</span>
        {running ? (
          <button onClick={stopBatch} className="btn-outline !px-2.5 text-xs text-rose-500 hover:bg-rose-500/10">
            <OctagonX size={13} /> Stop
          </button>
        ) : (
          <button onClick={() => runChecks()} className="btn-primary !px-2.5 text-xs">
            <RefreshCw size={13} /> Check row counts
          </button>
        )}
      </div>

      <div className="max-h-72 space-y-1 overflow-auto">
        {tables.map((t) => {
          const k = key(t);
          const st = status[k] ?? (counts[k] != null ? "ok" : "idle");
          const count = counts[k];
          const at = countedAt[k];
          return (
            <div key={k} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5 text-xs dark:border-slate-800/60">
              <span className="w-24 shrink-0 truncate text-slate-400">{t.schema}</span>
              <span className="min-w-0 flex-1 truncate font-mono">{t.name}</span>

              {st === "idle" && <span className="shrink-0 text-slate-400">not checked</span>}
              {st === "counting" && (
                <span className="flex shrink-0 items-center gap-1.5 text-loom-500">
                  <Loader2 size={12} className="animate-spin" /> counting…
                  <button onClick={() => cancelOne(t)} className="text-rose-500 hover:underline">cancel</button>
                </span>
              )}
              {st === "ok" && count != null && (
                <span className="flex shrink-0 items-center gap-1.5 text-emerald-500">
                  <CheckCircle2 size={12} /> {fmtCount(count)} rows
                  {at && <span className="text-slate-400">({timeAgo(at)} ago)</span>}
                  <button onClick={() => countOne(t)} title="Recount" className="text-slate-400 hover:text-loom-500"><RotateCcw size={11} /></button>
                </span>
              )}
              {st === "cancelled" && (
                <span className="flex shrink-0 items-center gap-1.5 text-slate-400">
                  <MinusCircle size={12} /> cancelled
                  <button onClick={() => countOne(t)} className="text-loom-500 hover:underline">retry</button>
                </span>
              )}
              {st === "error" && (
                <span className="flex shrink-0 items-center gap-1.5 text-rose-500" title={errors[k]}>
                  <XCircle size={12} /> failed
                  <button onClick={() => countOne(t)} className="text-loom-500 hover:underline">retry</button>
                </span>
              )}

              <label className="flex shrink-0 items-center gap-1 text-slate-400">
                sample
                <input type="number" min={1} value={rowLimits[k] ?? DEFAULT_SAMPLE_LIMIT}
                  onChange={(e) => setLimit(t, Number(e.target.value) || 1)}
                  className="input !w-20 !py-0.5 !px-1.5 text-right text-xs" />
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- lightweight virtualized list (handles 1000s of rows) ----------------- //
function VirtualList({ rows, sel, onToggle, cataloged }: {
  rows: DiscoveredTable[]; sel: Set<string>; onToggle: (k: string) => void; cataloged: Set<string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [h, setH] = useState(480);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener("scroll", onScroll);
    setH(el.clientHeight);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const total = rows.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(total, Math.ceil((scrollTop + h) / ROW_H) + OVERSCAN);
  const visible = rows.slice(start, end);

  return (
    <div ref={ref} className="card overflow-auto" style={{ height: 480 }}>
      <div style={{ height: total * ROW_H, position: "relative" }}>
        {visible.map((t, i) => {
          const k = `${t.schema}.${t.name}`;
          const checked = sel.has(k);
          const inCat = cataloged.has(k);
          return (
            <div key={k} onClick={() => onToggle(k)}
              className={`absolute left-0 right-0 flex cursor-pointer items-center gap-2.5 border-b border-slate-100 px-3 text-sm dark:border-slate-800/60 ${
                checked ? "bg-loom-500/10" : "hover:bg-slate-50 dark:hover:bg-slate-800/40"}`}
              style={{ top: (start + i) * ROW_H, height: ROW_H }}>
              {checked ? <CheckSquare size={16} className="shrink-0 text-loom-500" />
                       : <Square size={16} className="shrink-0 text-slate-300 dark:text-slate-600" />}
              <Table2 size={14} className="shrink-0 text-slate-400" />
              <span className="w-28 shrink-0 truncate text-[11px] font-medium text-slate-400">{t.schema}</span>
              <span className="min-w-0 flex-1 truncate font-mono">{t.name}</span>
              {inCat && <span className="chip shrink-0 bg-emerald-500/10 text-emerald-500">in catalog</span>}
              <span className="w-16 shrink-0 text-right font-mono text-[11px] text-slate-400">{fmtCount(t.row_estimate)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
