import { useMemo, useState } from "react";
import {
  Search, Sparkles, Loader2, Cpu, CornerDownLeft, Table2, Hash,
  BookOpen, Tag as TagIcon, Globe2, AlertTriangle,
} from "lucide-react";
import { useCatalog } from "../store";
import { api } from "../api";
import type { SearchHit } from "../types";
import type { Tab } from "../App";

const TYPE_META: Record<SearchHit["type"], { label: string; icon: typeof Table2; color: string }> = {
  dataset: { label: "Tables", icon: Table2, color: "text-loom-500 bg-loom-500/10" },
  column: { label: "Columns", icon: Hash, color: "text-teal-500 bg-teal-500/10" },
  glossary: { label: "Glossary", icon: BookOpen, color: "text-violet-500 bg-violet-500/10" },
  tag: { label: "Tags", icon: TagIcon, color: "text-amber-500 bg-amber-500/10" },
  domain: { label: "Domains", icon: Globe2, color: "text-cyan-500 bg-cyan-500/10" },
};

export function SearchView({ goto }: { goto: (t: Tab) => void }) {
  const { state, setFocusDataset } = useCatalog();
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<{ hits: SearchHit[]; facets: Record<string, number>; answer: string | null; llm: boolean } | null>(null);
  const [typeFilter, setTypeFilter] = useState<SearchHit["type"] | "all">("all");

  const run = async () => {
    if (!q.trim()) return;
    setLoading(true);
    setTypeFilter("all");
    try { setRes(await api.search(q)); }
    catch { setRes({ hits: [], facets: {}, answer: null, llm: false }); }
    finally { setLoading(false); }
  };

  const filtered = useMemo(() => {
    if (!res) return [];
    return typeFilter === "all" ? res.hits : res.hits.filter((h) => h.type === typeFilter);
  }, [res, typeFilter]);

  const openHit = (h: SearchHit) => {
    if (h.type === "dataset" || h.type === "column") { setFocusDataset({ dsId: h.dataset_id!, col: h.column }); goto("catalog"); }
    else if (h.type === "tag") goto("tags");
    else if (h.type === "domain") goto("domains");
    else if (h.type === "glossary") goto("glossary");
  };

  const examples = ["amount fields", "customer email", "orders table keys", "PII data"];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="card p-5">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-loom-500">
          <Sparkles size={14} /> Universal search — tables, columns, glossary, tags, domains
        </div>
        <div className="relative mt-3">
          <Search size={18} className="absolute left-3.5 top-3.5 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="Ask a question about your catalog…"
            className="input !py-3 !pl-11 !pr-24 text-base" autoFocus />
          <button onClick={run} disabled={loading} className="btn-primary absolute right-2 top-2">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <CornerDownLeft size={15} />} Search
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {examples.map((e) => (
            <button key={e} onClick={() => setQ(e)} className="chip bg-slate-500/10 text-slate-500 hover:bg-slate-500/20">{e}</button>
          ))}
        </div>
      </div>

      {res && (
        <>
          {res.answer && (
            <div className="card border-loom-500/30 bg-loom-500/5 p-4">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-loom-500">
                <Cpu size={13} /> Local LLM answer
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-200">{res.answer}</p>
            </div>
          )}
          {!res.llm && <div className="text-center text-xs text-slate-400">LLM offline — lexical results only.</div>}

          {/* facets */}
          {res.hits.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={() => setTypeFilter("all")}
                className={`chip border ${typeFilter === "all" ? "border-loom-500 bg-loom-500/10 text-loom-600 dark:text-loom-300" : "border-slate-200 text-slate-500 dark:border-slate-700"}`}>
                All ({res.hits.length})
              </button>
              {(Object.entries(res.facets) as [SearchHit["type"], number][]).map(([type, n]) => {
                const m = TYPE_META[type];
                return (
                  <button key={type} onClick={() => setTypeFilter(type)}
                    className={`chip border ${typeFilter === type ? "border-loom-500 bg-loom-500/10 text-loom-600 dark:text-loom-300" : "border-slate-200 text-slate-500 dark:border-slate-700"}`}>
                    <m.icon size={11} /> {m.label} ({n})
                  </button>
                );
              })}
            </div>
          )}

          <div className="space-y-1.5">
            {filtered.map((h, i) => {
              const m = TYPE_META[h.type];
              const deprecated = (h.type === "dataset" || h.type === "column") && h.dataset_id
                ? !!state?.docs[h.dataset_id]?.deprecated : false;
              return (
                <button key={i} onClick={() => openHit(h)}
                  className="card flex w-full items-center gap-3 p-3 text-left hover:border-loom-500/40">
                  <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${m.color}`}><m.icon size={15} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className={`truncate font-mono font-semibold ${deprecated ? "line-through opacity-60" : ""}`}>{h.label}</span>
                      <span className={`chip ${m.color} shrink-0`}>{m.label.replace(/s$/, "")}</span>
                      {deprecated && <span className="chip shrink-0 bg-rose-500/10 text-rose-500"><AlertTriangle size={10} /> deprecated</span>}
                    </div>
                    {h.sub && <div className="mt-0.5 truncate text-xs text-slate-400">{h.sub}</div>}
                  </div>
                </button>
              );
            })}
            {res.hits.length === 0 && <div className="py-8 text-center text-sm text-slate-400">No results.</div>}
          </div>
        </>
      )}
    </div>
  );
}
