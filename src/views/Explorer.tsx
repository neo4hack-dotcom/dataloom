import { useEffect, useMemo, useRef, useState } from "react";
import {
  Compass, Search, Sparkles, Table2, KeyRound, Lock, ChevronRight, Check, X,
  Loader2, MessageSquareText, ListTodo, Zap, Send, BookOpen, Star, ArrowRight,
  Wand2, ShieldCheck,
} from "lucide-react";
import { useCatalog, useScopedDatasets } from "../store";
import { api, type ColumnSuggestion, type CompletionItem, type TableSuggestion } from "../api";
import {
  EmptyState, semanticColor, confidenceColor, QualityBar, shortDs,
} from "../lib/ui";
import type { Column, Dataset } from "../types";

type Panel = "evidence" | "copilot" | "queue";

export function Explorer() {
  const { state, health } = useCatalog();
  const [q, setQ] = useState("");
  const [selDs, setSelDs] = useState<string | null>(null);
  const [selCol, setSelCol] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("evidence");
  const [pins, setPins] = useState<Set<string>>(new Set());

  const datasets = useScopedDatasets();
  const llmUp = health?.llm.up ?? false;

  const filtered = useMemo(() => {
    if (!q.trim()) return datasets;
    const ql = q.toLowerCase();
    return datasets
      .map((d) => {
        const tableMatch = `${d.schema}.${d.name}`.toLowerCase().includes(ql);
        const cols = d.columns.filter((c) => c.name.toLowerCase().includes(ql));
        if (tableMatch) return d;
        if (cols.length) return { ...d, columns: cols };
        return null;
      })
      .filter(Boolean) as Dataset[];
  }, [datasets, q]);

  const activeDs = datasets.find((d) => d.id === selDs) ?? null;
  const activeCol = activeDs?.columns.find((c) => c.name === selCol) ?? null;

  const togglePin = (key: string) => {
    setPins((p) => {
      const n = new Set(p);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  };

  if (datasets.length === 0) {
    return <EmptyState icon={<Compass size={48} />} title="Nothing to explore yet"
      hint="Import an OKF package or run the Profiler agent, then roam your schema here to complete the dictionary fast." />;
  }

  return (
    <div className="grid h-[calc(100vh-9rem)] gap-4 lg:grid-cols-[280px_1fr]">
      {/* schema tree */}
      <div className="card flex flex-col overflow-hidden">
        <div className="border-b border-slate-200 p-2.5 dark:border-slate-800">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tables & columns…"
              className="input !py-1.5 !pl-8 text-xs" />
          </div>
        </div>
        <div className="flex-1 overflow-auto p-1.5">
          {filtered.map((d) => (
            <TreeNode key={d.id} d={d} q={q}
              selCol={selDs === d.id ? selCol : null}
              pins={pins} onTogglePin={togglePin}
              onSelectCol={(col) => { setSelDs(d.id); setSelCol(col); setPanel("evidence"); }} />
          ))}
        </div>
      </div>

      {/* right pane */}
      <div className="flex min-h-0 flex-col gap-3">
        {/* panel switch */}
        <div className="flex items-center gap-1.5">
          {([["evidence", "Evidence", BookOpen],
             ["queue", "Next best action", ListTodo],
             ["copilot", "Copilot", MessageSquareText]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setPanel(id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${
                panel === id ? "bg-loom-500/10 text-loom-600 dark:text-loom-300" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
              <Icon size={15} /> {label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1.5 text-[11px]">
            <Sparkles size={13} className={llmUp ? "text-emerald-500" : "text-slate-400"} />
            <span className="text-slate-400">{llmUp ? "Local LLM ready" : "LLM offline"}</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {panel === "evidence" && (
            <EvidencePanel ds={activeDs} col={activeCol} llmUp={llmUp}
              onGoto={(dsId, col) => { setSelDs(dsId); setSelCol(col); }} />
          )}
          {panel === "queue" && (
            <CompletionQueue llmUp={llmUp}
              onPick={(dsId, col) => { setSelDs(dsId); setSelCol(col); setPanel("evidence"); }} />
          )}
          {panel === "copilot" && <Copilot llmUp={llmUp}
            onGoto={(dsId, col) => { setSelDs(dsId); setSelCol(col); setPanel("evidence"); }} />}
        </div>
      </div>
    </div>
  );
}

// ---- schema tree node ----------------------------------------------------- //
function TreeNode({ d, q, selCol, pins, onTogglePin, onSelectCol }: {
  d: Dataset; q: string; selCol: string | null;
  pins: Set<string>; onTogglePin: (k: string) => void; onSelectCol: (col: string) => void;
}) {
  const { state } = useCatalog();
  const [open, setOpen] = useState(!!q);
  useEffect(() => { if (q) setOpen(true); }, [q]);
  const doc = state?.docs[d.id];
  const documented = d.columns.filter((c) => doc?.columns?.[c.name]?.definition).length;
  const pii = d.columns.filter((c) => c.profile.sensitivity === "PII").length;

  return (
    <div className="mb-0.5">
      <button onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
        <ChevronRight size={13} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
        <Table2 size={14} className="shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
        {pii > 0 && <Lock size={11} className="text-rose-400" />}
        <span className="font-mono text-[10px] text-slate-400">{documented}/{d.columns.length}</span>
      </button>
      {open && (
        <div className="ml-4 border-l border-slate-200 pl-1.5 dark:border-slate-800">
          {d.columns.map((c) => {
            const p = c.profile;
            const cdoc = doc?.columns?.[c.name];
            const key = `${d.id}::${c.name}`;
            const pinned = pins.has(key);
            return (
              <div key={c.name}
                className={`group flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ${
                  selCol === c.name ? "bg-loom-500/10 text-loom-600 dark:text-loom-300" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
                <button onClick={() => onSelectCol(c.name)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                  {p.is_key_candidate && <KeyRound size={10} className="shrink-0 text-amber-500" />}
                  <span className="truncate font-mono">{c.name}</span>
                  {p.sensitivity === "PII" && <Lock size={9} className="shrink-0 text-rose-400" />}
                  {cdoc?.definition && <Check size={10} className="shrink-0 text-emerald-500" />}
                </button>
                <button onClick={() => onTogglePin(key)}
                  className={`shrink-0 transition-opacity ${pinned ? "text-amber-500" : "text-slate-300 opacity-0 group-hover:opacity-100 dark:text-slate-600"}`}>
                  <Star size={12} fill={pinned ? "currentColor" : "none"} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- evidence panel + LLM suggest ----------------------------------------- //
function EvidencePanel({ ds, col, llmUp, onGoto }: {
  ds: Dataset | null; col: Column | null; llmUp: boolean;
  onGoto: (dsId: string, col: string) => void;
}) {
  const { state, mutate, toast } = useCatalog();
  const [loading, setLoading] = useState(false);
  const [sugg, setSugg] = useState<ColumnSuggestion | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [tableSugg, setTableSugg] = useState<TableSuggestion | null>(null);

  useEffect(() => { setSugg(null); setTableSugg(null); }, [col?.name, ds?.id]);

  if (!ds) {
    return <div className="card grid h-full place-items-center text-sm text-slate-400">
      <div className="text-center"><Compass className="mx-auto mb-2 opacity-40" /> Pick a table or column in the tree.</div>
    </div>;
  }

  const doc = state?.docs[ds.id];

  const runSuggest = async () => {
    if (!col) return;
    setLoading(true); setSugg(null);
    try {
      const r = await api.suggestColumn(ds.id, col.name);
      setSugg(r.suggestion);
    } catch (e) {
      toast("err", (e as Error).message.includes("503") ? "Local LLM unavailable" : "Suggestion failed");
    } finally { setLoading(false); }
  };

  const applySuggest = async () => {
    if (!col || !sugg) return;
    await mutate((v) => api.applyColumn({
      dataset_id: ds.id, column: col.name,
      definition: sugg.definition, calculation: sugg.calculation,
      sensitivity: sugg.sensitivity, status: "validated",
    }, v));
    toast("ok", `${col.name} documented ✓`);
    setSugg(null);
  };

  const runDocTable = async () => {
    setDocLoading(true); setTableSugg(null);
    try {
      const r = await api.documentTable(ds.id);
      setTableSugg(r.result);
    } catch (e) {
      toast("err", (e as Error).message.includes("503") ? "Local LLM unavailable" : "Documentation failed");
    } finally { setDocLoading(false); }
  };

  const applyDocTable = async () => {
    if (!tableSugg) return;
    await mutate((v) => api.applyTable({
      dataset_id: ds.id, table_definition: tableSugg.table_definition,
      domain: tableSugg.domain, columns: tableSugg.columns,
    }, v));
    toast("ok", `${ds.name} fully documented ✓`);
    setTableSugg(null);
  };

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
        <Table2 size={16} className="text-loom-500" />
        <span className="font-semibold">{ds.schema}.{ds.name}</span>
        {doc?.domain && <span className="chip bg-loom-500/10 text-loom-500">{doc.domain}</span>}
        <button onClick={runDocTable} disabled={!llmUp || docLoading}
          className="btn-primary ml-auto !py-1 text-xs" title="Auto-document every column at once">
          {docLoading ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
          Auto-document table
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {/* table-level batch suggestion */}
        {tableSugg && (
          <div className="mb-4 rounded-xl border border-loom-500/30 bg-loom-500/5 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-loom-600 dark:text-loom-300">
              <Sparkles size={15} /> Suggested documentation for the whole table
              <span className="chip bg-loom-500/10 text-loom-500">{tableSugg.domain}</span>
            </div>
            <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">{tableSugg.table_definition}</p>
            <div className="max-h-48 space-y-1 overflow-auto rounded-lg bg-white/50 p-2 dark:bg-slate-900/40">
              {tableSugg.columns.map((c) => (
                <div key={c.name} className="flex items-start gap-2 text-xs">
                  <span className="font-mono font-semibold shrink-0">{c.name}</span>
                  {c.sensitivity === "PII" && <Lock size={10} className="mt-0.5 shrink-0 text-rose-400" />}
                  <span className="text-slate-500">{c.definition}</span>
                  <span className={`ml-auto shrink-0 font-mono ${confidenceColor(c.confidence)}`}>{c.confidence}%</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <button onClick={applyDocTable} className="btn-primary flex-1 justify-center text-xs">
                <Check size={13} /> Apply all
              </button>
              <button onClick={() => setTableSugg(null)} className="btn-outline text-xs"><X size={13} /></button>
            </div>
          </div>
        )}

        {!col ? (
          <div className="grid place-items-center py-10 text-sm text-slate-400">
            <div className="text-center">Select a column to see its evidence and get an AI suggestion.</div>
          </div>
        ) : (
          <ColumnEvidence ds={ds} col={col} doc={doc?.columns?.[col.name]}
            llmUp={llmUp} loading={loading} sugg={sugg}
            onSuggest={runSuggest} onApply={applySuggest} onDiscard={() => setSugg(null)} />
        )}
      </div>
    </div>
  );
}

function ColumnEvidence({ ds, col, doc, llmUp, loading, sugg, onSuggest, onApply, onDiscard }: {
  ds: Dataset; col: Column; doc: any; llmUp: boolean; loading: boolean;
  sugg: ColumnSuggestion | null; onSuggest: () => void; onApply: () => void; onDiscard: () => void;
}) {
  const p = col.profile;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="font-mono text-base font-semibold">{col.name}</span>
        <span className={`chip ${semanticColor(p.semantic_type)}`}>{p.semantic_type}</span>
        <span className="font-mono text-xs text-slate-400">{col.data_type}</span>
        {p.sensitivity === "PII" && <span className="chip bg-rose-500/10 text-rose-500"><Lock size={10} /> PII</span>}
        <button onClick={onSuggest} disabled={!llmUp || loading} className="btn-primary ml-auto !py-1 text-xs">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          AI suggest
        </button>
      </div>

      {/* current doc */}
      {doc?.definition && (
        <div className="rounded-lg border border-slate-200 p-2.5 text-sm dark:border-slate-800">
          <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-slate-400">
            Current definition {doc.status === "validated" && <ShieldCheck size={11} className="text-emerald-500" />}
          </div>
          <p className="text-slate-600 dark:text-slate-300">{doc.definition}</p>
        </div>
      )}

      {/* AI suggestion card */}
      {sugg && (
        <div className="rounded-xl border border-loom-500/30 bg-loom-500/5 p-3 animate-fade-in">
          <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-loom-600 dark:text-loom-300">
            <Sparkles size={15} /> AI suggestion
            <span className={`ml-auto chip ${confidenceColor(sugg.confidence)} bg-current/10`}>conf. {sugg.confidence}%</span>
          </div>
          <p className="text-sm text-slate-700 dark:text-slate-200">{sugg.definition}</p>
          {sugg.calculation && (
            <div className="mt-1.5 rounded bg-white/60 p-1.5 font-mono text-xs text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">
              {sugg.calculation}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className={`chip ${semanticColor(sugg.semantic_type)}`}>{sugg.semantic_type}</span>
            <span className={`chip ${sugg.sensitivity === "PII" ? "bg-rose-500/10 text-rose-500" : "bg-slate-500/10 text-slate-400"}`}>
              {sugg.sensitivity}
            </span>
          </div>
          {sugg.evidence.length > 0 && (
            <div className="mt-2 border-t border-loom-500/15 pt-2">
              <div className="mb-1 text-[10px] font-semibold uppercase text-slate-400">Grounded in</div>
              <ul className="space-y-0.5">
                {sugg.evidence.map((e, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-500">
                    <Check size={11} className="mt-0.5 shrink-0 text-emerald-500" /> {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-2.5 flex gap-2">
            <button onClick={onApply} className="btn-primary flex-1 justify-center text-xs"><Check size={13} /> Accept</button>
            <button onClick={onDiscard} className="btn-outline text-xs">Discard</button>
          </div>
        </div>
      )}

      {/* profiled evidence grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Mini label="Distinct" value={`${(p.distinct_ratio * 100).toFixed(0)}%`} />
        <Mini label="Nulls" value={`${(p.null_ratio * 100).toFixed(1)}%`} />
        <Mini label="Quality" value={String(p.quality_score)} />
        <Mini label="Key" value={p.is_key_candidate ? "yes" : "no"} />
      </div>

      {p.top_values.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase text-slate-400">Sample values</div>
          <div className="flex flex-wrap gap-1.5">
            {p.top_values.slice(0, 10).map((t, i) => (
              <span key={i} className="chip bg-slate-500/10 font-mono text-slate-500">{t.value}</span>
            ))}
          </div>
        </div>
      )}

      {p.format_masks.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase text-slate-400">Format fingerprint</div>
          <div className="flex flex-wrap gap-1.5">
            {p.format_masks.map((m, i) => (
              <span key={i} className="chip bg-slate-500/10 font-mono text-slate-500">{m.mask || "∅"} ×{m.count}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800/60">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

// ---- completion queue (next best action) ---------------------------------- //
function CompletionQueue({ llmUp, onPick }: {
  llmUp: boolean; onPick: (dsId: string, col: string) => void;
}) {
  const { state } = useCatalog();
  const [items, setItems] = useState<CompletionItem[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try { const r = await api.completionQueue(); setItems(r.items); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, [state?.version]);

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
        <ListTodo size={16} className="text-loom-500" />
        <span className="font-semibold">Next best action</span>
        <span className="text-xs text-slate-400">— highest-impact gaps first</span>
        <span className="ml-auto chip bg-slate-500/10 text-slate-400">{items.length} to close</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {loading ? (
          <div className="grid h-full place-items-center text-slate-400"><Loader2 className="animate-spin" /></div>
        ) : items.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-sm text-slate-400">
            <div><Check className="mx-auto mb-2 text-emerald-500" /> Catalog complete — no gaps left 🎉</div>
          </div>
        ) : (
          items.map((it, i) => (
            <button key={i} onClick={() => it.column && onPick(it.dataset_id, it.column)}
              className="mb-1 flex w-full items-center gap-2.5 rounded-lg border border-slate-200 p-2.5 text-left text-sm hover:border-loom-500/40 hover:bg-loom-500/5 dark:border-slate-800">
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg font-mono text-[11px] font-bold ${
                it.impact >= 70 ? "bg-rose-500/10 text-rose-500" :
                it.impact >= 45 ? "bg-amber-500/10 text-amber-500" : "bg-slate-500/10 text-slate-400"}`}>
                {it.impact}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{it.label}</div>
                {it.reasons && (
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {it.reasons.map((r, k) => <span key={k} className="chip bg-slate-500/10 text-[9px] text-slate-400">{r}</span>)}
                  </div>
                )}
              </div>
              {it.column && <ArrowRight size={15} className="shrink-0 text-slate-400" />}
            </button>
          ))
        )}
      </div>
      <div className="border-t border-slate-200 px-3 py-2 text-[11px] text-slate-400 dark:border-slate-800">
        Click an item → jump to its column, then <b>AI suggest</b> to close it in one click.
      </div>
    </div>
  );
}

// ---- copilot chat --------------------------------------------------------- //
function Copilot({ llmUp, onGoto }: {
  llmUp: boolean; onGoto: (dsId: string, col: string) => void;
}) {
  const [msgs, setMsgs] = useState<{ role: string; content: string; cited?: { dataset_id: string; column: string }[] }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs.length, loading]);

  const send = async () => {
    const q = input.trim();
    if (!q || loading) return;
    const history = msgs.map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setInput(""); setLoading(true);
    try {
      const r = await api.copilot(q, history);
      setMsgs((m) => [...m, { role: "assistant", content: r.answer, cited: r.cited }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: "⚠️ Local LLM unavailable." }]);
    } finally { setLoading(false); }
  };

  const examples = ["Which columns are PII?", "What links orders to customers?", "Summarise the CUSTOMERS table"];

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
        <MessageSquareText size={16} className="text-loom-500" />
        <span className="font-semibold">Catalog Copilot</span>
        <span className="text-xs text-slate-400">— grounded in your catalog</span>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
        {msgs.length === 0 && (
          <div className="grid h-full place-items-center text-center text-sm text-slate-400">
            <div>
              <MessageSquareText className="mx-auto mb-2 opacity-40" />
              Ask anything about your data — answers cite real columns.
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {examples.map((e) => (
                  <button key={e} onClick={() => setInput(e)} className="chip bg-slate-500/10 text-slate-500 hover:bg-slate-500/20">{e}</button>
                ))}
              </div>
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
              m.role === "user" ? "bg-loom-600 text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>
              <div className="whitespace-pre-wrap">{m.content}</div>
              {m.cited && m.cited.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1 border-t border-slate-300/30 pt-1.5">
                  {m.cited.map((c, k) => (
                    <button key={k} onClick={() => onGoto(c.dataset_id, c.column)}
                      className="chip bg-loom-500/15 font-mono text-loom-600 hover:bg-loom-500/25 dark:text-loom-300">
                      {shortDs(c.dataset_id).split(".").pop()}.{c.column}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && <div className="flex justify-start"><div className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800"><Loader2 size={15} className="animate-spin text-slate-400" /></div></div>}
      </div>
      <div className="flex items-center gap-2 border-t border-slate-200 p-2.5 dark:border-slate-800">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
          disabled={!llmUp} placeholder={llmUp ? "Ask the catalog…" : "Local LLM offline"}
          className="input !py-2 text-sm" />
        <button onClick={send} disabled={!llmUp || loading} className="btn-primary !px-3"><Send size={16} /></button>
      </div>
    </div>
  );
}
