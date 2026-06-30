import { useEffect, useMemo, useRef, useState } from "react";
import {
  Library as LibraryIcon, Search, BookOpen, MessageSquareText, Send, Loader2,
  Lock, ArrowLeft, Sparkles, Hash, Type, Calendar, Mail, Link2, ToggleLeft,
  Banknote, MapPin, Phone, Fingerprint, Tag, FileText, Package,
  ChevronRight, Layers,
} from "lucide-react";
import { useCatalog, useScopedDatasets } from "../store";
import { api } from "../api";
import { EmptyState } from "../lib/ui";
import type { Column, Dataset } from "../types";
import type { Tab } from "../App";

type Mode = "browse" | "ask";

export function Library({ goto }: { goto: (t: Tab) => void }) {
  const { state, health } = useCatalog();
  const [mode, setMode] = useState<Mode>("browse");
  const [q, setQ] = useState("");
  const [openDs, setOpenDs] = useState<string | null>(null);

  const datasets = useScopedDatasets();
  const llmUp = health?.llm.up ?? false;

  if (datasets.length === 0) {
    return <EmptyState icon={<LibraryIcon size={48} />} title="The library is empty"
      hint="Once your data is catalogued, browse it here in plain language — no technical knowledge needed." />;
  }

  const active = datasets.find((d) => d.id === openDs) ?? null;

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="card relative overflow-hidden p-5">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gradient-to-br from-loom-500/20 to-violet-500/10 blur-2xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-loom-500">
              <LibraryIcon size={14} /> Data Library
            </div>
            <h2 className="mt-1 text-xl font-bold">Find your data in plain language</h2>
            <p className="mt-0.5 max-w-xl text-sm text-slate-500">
              Browse by topic or just ask the Librarian — no SQL, no jargon.
            </p>
          </div>
          <ExportMenu />
        </div>
        {/* mode switch */}
        <div className="relative mt-4 flex gap-1.5">
          {([["browse", "Browse", BookOpen], ["ask", "Ask the Librarian", MessageSquareText]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setMode(id)}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium ${
                mode === id ? "bg-loom-600 text-white shadow" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </div>

      {mode === "ask" ? (
        <Librarian llmUp={llmUp} onOpenTable={(dsId) => { setOpenDs(dsId); setMode("browse"); }} />
      ) : active ? (
        <Reader ds={active} onBack={() => setOpenDs(null)} />
      ) : (
        <Shelves datasets={datasets} q={q} setQ={setQ} onOpen={setOpenDs} onAsk={() => setMode("ask")} />
      )}
    </div>
  );
}

// ---- friendly type vocabulary --------------------------------------------- //
function friendlyType(c: Column): { label: string; icon: typeof Type; color: string } {
  const p = c.profile;
  const st = p.semantic_type;
  const name = c.name.toLowerCase();
  const isMoney = /amount|price|total|revenue|cost|ltv|salary|balance|montant/.test(name);
  if (p.is_key_candidate || st === "integer_id") return { label: "Identifier", icon: Fingerprint, color: "text-amber-500 bg-amber-500/10" };
  if (st === "email") return { label: "Email", icon: Mail, color: "text-pink-500 bg-pink-500/10" };
  if (st === "phone") return { label: "Phone", icon: Phone, color: "text-fuchsia-500 bg-fuchsia-500/10" };
  if (st === "iso_date" || st === "iso_datetime") return { label: "Date", icon: Calendar, color: "text-emerald-500 bg-emerald-500/10" };
  if (st === "url") return { label: "Link", icon: Link2, color: "text-blue-500 bg-blue-500/10" };
  if (st === "country_code") return { label: "Country", icon: MapPin, color: "text-cyan-500 bg-cyan-500/10" };
  if (st === "currency_code") return { label: "Currency", icon: Banknote, color: "text-violet-500 bg-violet-500/10" };
  if (st === "iban" || st === "siret" || st === "siren") return { label: "Reference code", icon: Tag, color: "text-amber-500 bg-amber-500/10" };
  if (st === "boolean") return { label: "Yes / No", icon: ToggleLeft, color: "text-slate-500 bg-slate-500/10" };
  if (st === "code") return { label: "Category", icon: Tag, color: "text-teal-500 bg-teal-500/10" };
  if (isMoney || p.numeric) return { label: isMoney ? "Amount" : "Number", icon: Hash, color: "text-loom-500 bg-loom-500/10" };
  return { label: "Text", icon: Type, color: "text-slate-500 bg-slate-500/10" };
}

function humanize(name: string): string {
  return name.replace(/[_-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

// ---- shelves (browse by domain) ------------------------------------------- //
function Shelves({ datasets, q, setQ, onOpen, onAsk }: {
  datasets: Dataset[]; q: string; setQ: (s: string) => void;
  onOpen: (id: string) => void; onAsk: () => void;
}) {
  const { state } = useCatalog();
  const docs = state?.docs ?? {};

  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const match = (d: Dataset) => !ql ||
      `${d.schema}.${d.name}`.toLowerCase().includes(ql) ||
      (docs[d.id]?.definition ?? "").toLowerCase().includes(ql) ||
      d.columns.some((c) => c.name.toLowerCase().includes(ql));
    const by: Record<string, Dataset[]> = {};
    for (const d of datasets) {
      if (!match(d)) continue;
      const domain = docs[d.id]?.domain || "General";
      (by[domain] ??= []).push(d);
    }
    return Object.entries(by).sort((a, b) => b[1].length - a[1].length);
  }, [datasets, q, docs]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-3 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search the library — a topic, a table, a field…"
            className="input !py-2.5 !pl-10" />
        </div>
        <button onClick={onAsk} className="btn-outline shrink-0">
          <MessageSquareText size={15} /> Ask instead
        </button>
      </div>

      {groups.length === 0 && (
        <div className="py-10 text-center text-sm text-slate-400">Nothing matches “{q}”.</div>
      )}

      {groups.map(([domain, tables]) => (
        <section key={domain}>
          <div className="mb-2 flex items-center gap-2">
            <Layers size={15} className="text-loom-500" />
            <h3 className="text-sm font-semibold">{domain}</h3>
            <span className="chip bg-slate-500/10 text-slate-400">{tables.length}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {tables.map((d) => {
              const doc = docs[d.id];
              const pii = d.columns.filter((c) => c.profile.sensitivity === "PII").length;
              const keys = d.columns.filter((c) => c.profile.is_key_candidate).slice(0, 3);
              return (
                <button key={d.id} onClick={() => onOpen(d.id)}
                  className="card group p-4 text-left transition-colors hover:border-loom-500/40 hover:bg-loom-500/[0.03]">
                  <div className="flex items-start gap-2.5">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-loom-500/10 text-loom-500">
                      <BookOpen size={17} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{humanize(d.name)}</div>
                      <div className="text-[11px] text-slate-400">{d.columns.length} fields · ~{d.row_estimate.toLocaleString()} rows</div>
                    </div>
                    {pii > 0 && <Lock size={13} className="shrink-0 text-rose-400" />}
                    <ChevronRight size={15} className="shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 dark:text-slate-600" />
                  </div>
                  <p className="mt-2 line-clamp-2 min-h-[2.4rem] text-sm text-slate-500">
                    {doc?.definition || <span className="italic text-slate-400">No description yet.</span>}
                  </p>
                  {keys.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {keys.map((k) => (
                        <span key={k.name} className="chip bg-amber-500/10 text-amber-600 dark:text-amber-400">
                          <Fingerprint size={10} /> {humanize(k.name)}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---- reader (non-technical table page) ------------------------------------ //
function Reader({ ds, onBack }: { ds: Dataset; onBack: () => void }) {
  const { state } = useCatalog();
  const doc = state?.docs[ds.id];
  const rels = state?.relationships ?? [];
  const glossary = state?.glossary ?? [];

  // relationships in plain language
  const links = useMemo(() => {
    const out: string[] = [];
    for (const r of rels) {
      if (r.status === "rejected") continue;
      const childName = r.child.dataset_id.split("::").pop()?.split(".").pop();
      const parentName = r.parent.dataset_id.split("::").pop()?.split(".").pop();
      if (r.child.dataset_id === ds.id)
        out.push(`Each row connects to one ${humanize(parentName ?? "")} (via ${humanize(r.child.column)}).`);
      else if (r.parent.dataset_id === ds.id)
        out.push(`Many ${humanize(childName ?? "")} entries point back here.`);
    }
    return out;
  }, [rels, ds.id]);

  const terms = useMemo(() => {
    const colNames = new Set(ds.columns.map((c) => c.name.toLowerCase()));
    return glossary.filter((g) => g.columns.some((c) => c.dataset_id === ds.id) ||
      g.term && [...colNames].some((n) => n.includes(g.term.toLowerCase()))).slice(0, 10);
  }, [glossary, ds]);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="btn-ghost text-sm"><ArrowLeft size={15} /> Back to the library</button>

      <div className="card p-5">
        <div className="flex items-center gap-2">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-loom-500/10 text-loom-500"><BookOpen size={20} /></div>
          <div>
            <h2 className="text-xl font-bold">{humanize(ds.name)}</h2>
            <div className="text-xs text-slate-400">
              {doc?.domain && <span className="text-loom-500">{doc.domain}</span>}
              {doc?.domain && " · "}{ds.columns.length} fields · ~{ds.row_estimate.toLocaleString()} rows
            </div>
          </div>
        </div>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          {doc?.definition || <span className="italic text-slate-400">No description has been written for this table yet.</span>}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        {/* fields */}
        <div className="card p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Layers size={16} className="text-loom-500" /> What's inside
          </div>
          <div className="space-y-1.5">
            {ds.columns.map((c) => {
              const ft = friendlyType(c);
              const Icon = ft.icon;
              const cdoc = doc?.columns?.[c.name];
              return (
                <div key={c.name} className="flex items-start gap-3 rounded-lg border border-slate-100 p-2.5 dark:border-slate-800/60">
                  <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${ft.color}`}>
                    <Icon size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{humanize(c.name)}</span>
                      <span className="chip bg-slate-500/10 text-[10px] text-slate-400">{ft.label}</span>
                      {c.profile.sensitivity === "PII" && (
                        <span className="chip bg-rose-500/10 text-rose-500"><Lock size={9} /> personal</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {cdoc?.definition || <span className="italic text-slate-400">No description yet.</span>}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* side: links + glossary */}
        <div className="space-y-4">
          {links.length > 0 && (
            <div className="card p-4">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <Link2 size={15} className="text-loom-500" /> How it connects
              </div>
              <ul className="space-y-1.5">
                {links.map((l, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-slate-500">
                    <ChevronRight size={12} className="mt-0.5 shrink-0 text-loom-500" /> {l}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {terms.length > 0 && (
            <div className="card p-4">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <Tag size={15} className="text-teal-500" /> Business terms
              </div>
              <div className="space-y-2">
                {terms.map((t) => (
                  <div key={t.term}>
                    <div className="text-xs font-semibold capitalize">{t.term}</div>
                    {t.definition && <div className="text-[11px] text-slate-400">{t.definition}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- librarian (RAG chatbot) ---------------------------------------------- //
function Librarian({ llmUp, onOpenTable }: { llmUp: boolean; onOpenTable: (dsId: string) => void }) {
  const { state } = useCatalog();
  const [msgs, setMsgs] = useState<{ role: string; content: string; cited?: { dataset_id: string; column: string }[] }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs.length, loading]);

  const send = async (text?: string) => {
    const question = (text ?? input).trim();
    if (!question || loading) return;
    const history = msgs.map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: "user", content: question }]);
    setInput(""); setLoading(true);
    try {
      const r = await api.copilot(question, history, true);
      setMsgs((m) => [...m, { role: "assistant", content: r.answer, cited: r.cited }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "⚠️ The Librarian is offline right now (local LLM unavailable)." }]);
    } finally { setLoading(false); }
  };

  const examples = [
    "Where can I find customer email addresses?",
    "Which data is personal or sensitive?",
    "How are orders connected to customers?",
    "What does the revenue field mean?",
  ];

  return (
    <div className="card flex h-[calc(100vh-17rem)] flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-loom-500 to-violet-600 text-white">
          <MessageSquareText size={16} />
        </div>
        <div>
          <div className="text-sm font-semibold">The Librarian</div>
          <div className="text-[11px] text-slate-400">Ask anything — answers come straight from your catalogue.</div>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
        {msgs.length === 0 && (
          <div className="grid h-full place-items-center text-center">
            <div>
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-loom-500/10 text-loom-500">
                <Sparkles size={22} />
              </div>
              <div className="text-sm font-medium text-slate-600 dark:text-slate-300">How can I help you find something?</div>
              <div className="mt-3 flex max-w-md flex-wrap justify-center gap-1.5">
                {examples.map((e) => (
                  <button key={e} onClick={() => send(e)}
                    className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:border-loom-400 hover:text-loom-600 dark:border-slate-700">
                    {e}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
              m.role === "user" ? "bg-loom-600 text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>
              <div className="whitespace-pre-wrap">{m.content}</div>
              {m.cited && m.cited.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1 border-t border-slate-300/30 pt-2">
                  {dedupeTables(m.cited).map((dsId, k) => {
                    const d = state?.datasets.find((x) => x.id === dsId);
                    if (!d) return null;
                    return (
                      <button key={k} onClick={() => onOpenTable(dsId)}
                        className="chip bg-loom-500/15 text-loom-600 hover:bg-loom-500/25 dark:text-loom-300">
                        <BookOpen size={11} /> {humanize(d.name)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-slate-100 px-3.5 py-2 dark:bg-slate-800">
              <Loader2 size={15} className="animate-spin text-slate-400" />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-slate-200 p-2.5 dark:border-slate-800">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
          disabled={!llmUp} placeholder={llmUp ? "Ask the Librarian…" : "The Librarian is offline"}
          className="input !py-2.5" />
        <button onClick={() => send()} disabled={!llmUp || loading} className="btn-primary !px-3.5"><Send size={16} /></button>
      </div>
    </div>
  );
}

function dedupeTables(cited: { dataset_id: string; column: string }[]): string[] {
  return [...new Set(cited.map((c) => c.dataset_id))];
}

// ---- export menu (non-technical sharing) ---------------------------------- //
function ExportMenu() {
  const { toast } = useCatalog();
  const [busy, setBusy] = useState(false);

  const exp = async (fmt: "markdown" | "okf") => {
    setBusy(true);
    try {
      const { content, filename } = await api.exportCatalog(fmt);
      const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      toast("ok", `${filename} downloaded`);
    } catch (e) {
      toast("err", (e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="flex gap-2">
      <button onClick={() => exp("markdown")} disabled={busy} className="btn-outline" title="A readable handbook of your data">
        <FileText size={15} /> Handbook
      </button>
      <button onClick={() => exp("okf")} disabled={busy} className="btn-outline" title="Open Knowledge Format (datapackage.json)">
        <Package size={15} /> Export OKF
      </button>
    </div>
  );
}
