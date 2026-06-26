import { useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutDashboard, Database, Table2, GitCompare, Workflow, Bot, Tags,
  Search, Settings as SettingsIcon, Sparkles, CornerDownLeft, Zap,
} from "lucide-react";
import { useCatalog } from "../store";
import { api } from "../api";
import { shortDs } from "../lib/ui";
import type { Tab } from "../App";

interface Item { id: string; label: string; sub?: string; icon: typeof Database; run: () => void; group: string; }

export function CommandPalette({ open, onClose, goto }: { open: boolean; onClose: () => void; goto: (t: Tab) => void; }) {
  const { state, mutate, setActiveRun, toast } = useCatalog();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);

  const items = useMemo<Item[]>(() => {
    const nav: Item[] = [
      { id: "n-overview", group: "Navigate", label: "Overview", icon: LayoutDashboard, run: () => goto("overview") },
      { id: "n-conn", group: "Navigate", label: "Connections", icon: Database, run: () => goto("connections") },
      { id: "n-cat", group: "Navigate", label: "Catalog", icon: Table2, run: () => goto("catalog") },
      { id: "n-rel", group: "Navigate", label: "Relationships", icon: GitCompare, run: () => goto("relationships") },
      { id: "n-lin", group: "Navigate", label: "Lineage", icon: Workflow, run: () => goto("lineage") },
      { id: "n-agt", group: "Navigate", label: "Agents", icon: Bot, run: () => goto("agents") },
      { id: "n-glo", group: "Navigate", label: "Glossary", icon: Tags, run: () => goto("glossary") },
      { id: "n-search", group: "Navigate", label: "Search", icon: Search, run: () => goto("search") },
      { id: "n-set", group: "Navigate", label: "Settings", icon: SettingsIcon, run: () => goto("settings") },
    ];
    const actions: Item[] = [];
    const firstConn = state?.connections[0];
    if (firstConn) {
      actions.push({
        id: "a-magic", group: "Actions", label: "✨ Magic Enrich — full pipeline",
        sub: firstConn.name, icon: Zap,
        run: async () => {
          const r = await mutate((v) => api.launchRun(firstConn.id, null, v));
          if (r) { setActiveRun(r.run); goto("agents"); toast("info", "Pipeline started"); }
        },
      });
    }
    const ds: Item[] = (state?.datasets ?? []).map((d) => ({
      id: `d-${d.id}`, group: "Tables", label: `${d.schema}.${d.name}`,
      sub: `${d.columns.length} columns`, icon: Table2,
      run: () => goto("catalog"),
    }));
    return [...actions, ...nav, ...ds];
  }, [state, goto, mutate, setActiveRun, toast]);

  const filtered = useMemo(() => {
    if (!q.trim()) return items.slice(0, 12);
    const ql = q.toLowerCase();
    return items.filter((i) => (i.label + (i.sub ?? "")).toLowerCase().includes(ql)).slice(0, 14);
  }, [q, items]);

  useEffect(() => { setSel(0); }, [q]);

  if (!open) return null;

  const groups = filtered.reduce<Record<string, Item[]>>((acc, i) => {
    (acc[i.group] ??= []).push(i); return acc;
  }, {});
  let flatIndex = 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 dark:border-slate-700">
          <Sparkles size={16} className="text-loom-500" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search tables, actions, navigation…"
            className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-slate-400"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter") { filtered[sel]?.run(); onClose(); }
              if (e.key === "Escape") onClose();
            }} />
          <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 dark:bg-slate-800">esc</kbd>
        </div>
        <div className="max-h-80 overflow-auto p-2">
          {filtered.length === 0 && <div className="px-3 py-6 text-center text-sm text-slate-400">No results</div>}
          {Object.entries(groups).map(([group, gi]) => (
            <div key={group} className="mb-1">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{group}</div>
              {gi.map((i) => {
                const idx = flatIndex++;
                const Icon = i.icon;
                const active = idx === sel;
                return (
                  <button key={i.id} onMouseEnter={() => setSel(idx)}
                    onClick={() => { i.run(); onClose(); }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm ${
                      active ? "bg-loom-500/10 text-loom-600 dark:text-loom-300" : "text-slate-700 dark:text-slate-300"
                    }`}>
                    <Icon size={16} className="opacity-70" />
                    <span className="flex-1 truncate">{i.label}</span>
                    {i.sub && <span className="text-xs text-slate-400">{i.sub}</span>}
                    {active && <CornerDownLeft size={13} className="text-slate-400" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
