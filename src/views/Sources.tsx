import { useEffect, useMemo, useRef, useState } from "react";
import {
  Database, RefreshCw, Loader2, Search, CheckSquare, Square, Zap, Save,
  Filter, Layers, Table2, X, ListChecks, MinusSquare,
} from "lucide-react";
import { useCatalog } from "../store";
import { api } from "../api";
import { EmptyState } from "../lib/ui";
import type { DiscoveredTable } from "../types";
import type { Tab } from "../App";

const ROW_H = 38;       // px per row (for windowing)
const OVERSCAN = 8;

export function Sources({ goto }: { goto: (t: Tab) => void }) {
  const { state, activeConn, setActiveConn, mutate, setActiveRun, toast } = useCatalog();
  const conns = state?.connections ?? [];

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

  // re-seed selection when switching connection
  useEffect(() => { setSel(new Set(conn?.scope ?? [])); }, [cid]); // eslint-disable-line

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

  const saveScope = async () => {
    await mutate((v) => api.setScope(cid, [...sel], v));
    toast("ok", `Scope saved — ${sel.size} table(s)`);
  };

  const runOnScope = async () => {
    if (sel.size === 0) { toast("err", "Select at least one table"); return; }
    await mutate((v) => api.setScope(cid, [...sel], v));
    const r = await mutate((v) => api.launchRun(cid, null, v, [...sel]));
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

          {/* footer actions */}
          <div className="sticky bottom-0 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/90 p-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
            <span className="text-sm text-slate-500">
              Agents will only run on your <b>{sel.size}</b> selected table(s) — never on the whole {inventory.length.toLocaleString()}-table source.
            </span>
            <div className="ml-auto flex gap-2">
              <button onClick={saveScope} className="btn-outline"><Save size={15} /> Save scope</button>
              <button onClick={runOnScope} disabled={sel.size === 0} className="btn-primary"><Zap size={15} /> Run agents on selection</button>
            </div>
          </div>
        </>
      )}
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

  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n);

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
              <span className="w-16 shrink-0 text-right font-mono text-[11px] text-slate-400">{fmt(t.row_estimate)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
