import { useState } from "react";
import { Tags, Pencil, Check } from "lucide-react";
import { useCatalog } from "../store";
import { api } from "../api";
import { EmptyState, shortDs } from "../lib/ui";

export function Glossary() {
  const { state, mutate, toast } = useCatalog();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const terms = state?.glossary ?? [];
  if (terms.length === 0) {
    return <EmptyState icon={<Tags size={48} />} title="Glossary is empty"
      hint="The Glossary agent extracts recurring business terms from column names." />;
  }

  const save = async (term: string) => {
    await mutate((v) => api.editGlossary(term, draft, v));
    setEditing(null);
    toast("ok", "Term updated ✓");
  };

  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {terms.map((t) => (
        <div key={t.term} className="card p-4">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-500/10 text-teal-500"><Tags size={16} /></span>
            <span className="text-base font-bold capitalize">{t.term}</span>
            <span className="ml-auto chip bg-slate-500/10 text-slate-400">{t.occurrences}×</span>
          </div>

          {editing === t.term ? (
            <div className="mt-2 space-y-2">
              <textarea className="input min-h-[60px] text-sm" value={draft}
                onChange={(e) => setDraft(e.target.value)} placeholder="Business definition…" />
              <button onClick={() => save(t.term)} className="btn-primary w-full justify-center text-xs"><Check size={13} /> Save</button>
            </div>
          ) : (
            <div className="mt-2">
              <p className="min-h-[2.5rem] text-sm text-slate-500">
                {t.definition || <span className="italic text-slate-400">Not defined yet.</span>}
              </p>
              <button onClick={() => { setEditing(t.term); setDraft(t.definition); }}
                className="btn-outline mt-1 text-xs"><Pencil size={12} /> Define</button>
            </div>
          )}

          <div className="mt-3 border-t border-slate-100 pt-2 dark:border-slate-800">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">Linked columns</div>
            <div className="flex flex-wrap gap-1">
              {t.columns.slice(0, 8).map((c, i) => (
                <span key={i} className="chip bg-loom-500/10 font-mono text-loom-500">
                  {shortDs(c.dataset_id).split(".").pop()}.{c.column}
                </span>
              ))}
              {t.columns.length > 8 && <span className="chip text-slate-400">+{t.columns.length - 8}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
