import { useMemo, useState } from "react";
import { Tag as TagIcon, Table2, Hash } from "lucide-react";
import { useCatalog, useScopedDatasets } from "../store";
import { EmptyState, TagChip, nameColor } from "../lib/ui";
import type { Tab } from "../App";

interface TagUsage {
  tag: string;
  datasets: { dsId: string; label: string }[];
  columns: { dsId: string; col: string; label: string }[];
}

export function TagsView({ goto }: { goto: (t: Tab) => void }) {
  const { state, setFocusDataset } = useCatalog();
  const datasets = useScopedDatasets();
  const [selected, setSelected] = useState<string | null>(null);

  const usage = useMemo(() => {
    const map = new Map<string, TagUsage>();
    const get = (tag: string) => {
      if (!map.has(tag)) map.set(tag, { tag, datasets: [], columns: [] });
      return map.get(tag)!;
    };
    for (const d of datasets) {
      const doc = state?.docs[d.id];
      for (const t of doc?.tags ?? []) get(t).datasets.push({ dsId: d.id, label: `${d.schema}.${d.name}` });
      for (const c of d.columns) {
        for (const t of doc?.columns?.[c.name]?.tags ?? []) {
          get(t).columns.push({ dsId: d.id, col: c.name, label: `${d.schema}.${d.name}.${c.name}` });
        }
      }
    }
    return [...map.values()].sort((a, b) => (b.datasets.length + b.columns.length) - (a.datasets.length + a.columns.length));
  }, [datasets, state?.docs]);

  const activeUsage = usage.find((u) => u.tag === selected) ?? usage[0] ?? null;

  const openDataset = (dsId: string, col?: string) => {
    setFocusDataset({ dsId, col });
    goto("catalog");
  };

  if (usage.length === 0) {
    return <EmptyState icon={<TagIcon size={48} />} title="No tags yet"
      hint="Tag datasets and columns from the Catalog view's Overview tab to organize and discover them here." />;
  }

  return (
    <div className="grid h-[calc(100vh-9rem)] gap-4 lg:grid-cols-[280px_1fr]">
      <div className="card flex flex-col overflow-hidden">
        <div className="border-b border-slate-200 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800">
          All tags ({usage.length})
        </div>
        <div className="flex-1 overflow-auto p-1.5">
          {usage.map((u) => {
            const n = u.datasets.length + u.columns.length;
            const isActive = activeUsage?.tag === u.tag;
            const c = nameColor(u.tag);
            return (
              <button key={u.tag} onClick={() => setSelected(u.tag)}
                className={`mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm ${
                  isActive ? "bg-loom-500/10 text-loom-600 dark:text-loom-300" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${c.bg}`} style={{ background: c.solid }} />
                <span className="min-w-0 flex-1 truncate text-left">{u.tag}</span>
                <span className="chip bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {activeUsage && (
        <div className="card flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-800">
            <TagChip tag={activeUsage.tag} />
            <span className="ml-auto text-xs text-slate-400">
              {activeUsage.datasets.length} table(s) · {activeUsage.columns.length} column(s)
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4 space-y-4">
            {activeUsage.datasets.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <Table2 size={12} /> Tables
                </div>
                <div className="space-y-1">
                  {activeUsage.datasets.map((d) => (
                    <button key={d.dsId} onClick={() => openDataset(d.dsId)}
                      className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-loom-500/40 hover:bg-loom-500/5 dark:border-slate-800">
                      <Table2 size={14} className="text-slate-400" /> <span className="font-mono">{d.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {activeUsage.columns.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <Hash size={12} /> Columns
                </div>
                <div className="space-y-1">
                  {activeUsage.columns.map((c, i) => (
                    <button key={i} onClick={() => openDataset(c.dsId, c.col)}
                      className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-loom-500/40 hover:bg-loom-500/5 dark:border-slate-800">
                      <Hash size={14} className="text-slate-400" /> <span className="font-mono">{c.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
