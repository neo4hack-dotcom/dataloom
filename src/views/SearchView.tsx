import { useState } from "react";
import { Search, Sparkles, Loader2, Cpu, CornerDownLeft } from "lucide-react";
import { useCatalog } from "../store";
import { api } from "../api";
import { semanticColor, QualityBar } from "../lib/ui";

export function SearchView() {
  const { health } = useCatalog();
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<{ hits: any[]; answer: string | null; llm: boolean } | null>(null);

  const run = async () => {
    if (!q.trim()) return;
    setLoading(true);
    try { setRes(await api.search(q)); }
    catch { setRes({ hits: [], answer: null, llm: false }); }
    finally { setLoading(false); }
  };

  const examples = ["amount fields", "customer email location", "orders table keys", "PII data"];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="card p-5">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-loom-500">
          <Sparkles size={14} /> Natural language search
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
          {!res.llm && (
            <div className="text-center text-xs text-slate-400">LLM offline — lexical results only.</div>
          )}

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {res.hits.length} columns found
            </div>
            {res.hits.map((h, i) => (
              <div key={i} className="card flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-slate-400">{h.dataset}.</span>
                    <span className="font-semibold">{h.column}</span>
                    <span className={`chip ${semanticColor(h.semantic_type)}`}>{h.semantic_type}</span>
                    {h.domain && <span className="chip bg-loom-500/10 text-loom-500">{h.domain}</span>}
                  </div>
                  {h.definition && <div className="mt-0.5 truncate text-xs text-slate-400">{h.definition}</div>}
                </div>
                <QualityBar value={h.quality} />
              </div>
            ))}
            {res.hits.length === 0 && <div className="py-8 text-center text-sm text-slate-400">No results.</div>}
          </div>
        </>
      )}
    </div>
  );
}
