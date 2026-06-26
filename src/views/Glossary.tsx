import { useState } from "react";
import { Tags, Pencil, Check, Plus, Trash2, X } from "lucide-react";
import { useCatalog } from "../store";
import { api } from "../api";
import { EmptyState, shortDs } from "../lib/ui";

export function Glossary() {
  const { state, mutate, toast } = useCatalog();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newTerm, setNewTerm] = useState("");
  const [newDef, setNewDef] = useState("");

  const terms = state?.glossary ?? [];

  const save = async (term: string) => {
    await mutate((v) => api.editGlossary(term, draft, v));
    setEditing(null); toast("ok", "Term updated ✓");
  };

  const del = async (term: string) => {
    if (!confirm(`Delete glossary term "${term}"?`)) return;
    await mutate((v) => api.deleteGlossaryTerm(term, v));
    toast("ok", `"${term}" removed`);
  };

  const add = async () => {
    if (!newTerm.trim()) return;
    const r = await mutate((v) => api.addGlossaryTerm(newTerm.trim().toLowerCase(), newDef, v));
    if (r) { toast("ok", "Term added ✓"); setAddOpen(false); setNewTerm(""); setNewDef(""); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Business terms extracted from column names or added manually. Define them to build a shared vocabulary.
        </p>
        <button onClick={() => setAddOpen((o) => !o)} className="btn-primary">
          <Plus size={15} /> Add term
        </button>
      </div>

      {addOpen && (
        <div className="card animate-fade-in space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-500">Term</span>
              <input className="input text-sm" value={newTerm} onChange={(e) => setNewTerm(e.target.value)}
                placeholder="e.g. customer, revenue, sku" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-500">Definition</span>
              <input className="input text-sm" value={newDef} onChange={(e) => setNewDef(e.target.value)}
                placeholder="Business definition (optional)" />
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={add} className="btn-primary flex-1 justify-center"><Check size={14} /> Add</button>
            <button onClick={() => setAddOpen(false)} className="btn-outline">Cancel</button>
          </div>
        </div>
      )}

      {terms.length === 0 ? (
        <EmptyState icon={<Tags size={48} />} title="Glossary is empty"
          hint="The Glossary agent extracts recurring business terms from column names, or add them manually." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {terms.map((t) => (
            <div key={t.term} className="card group p-4">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-500/10 text-teal-500"><Tags size={16} /></span>
                <span className="text-base font-bold capitalize">{t.term}</span>
                <span className="chip bg-slate-500/10 text-slate-400">{t.occurrences}×</span>
                {(t as any).manual && <span className="chip bg-violet-500/10 text-violet-400 text-[9px]">manual</span>}
                <button onClick={() => del(t.term)}
                  className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 text-slate-400 hover:text-rose-500">
                  <Trash2 size={14} />
                </button>
              </div>

              {editing === t.term ? (
                <div className="mt-2 space-y-2">
                  <textarea className="input min-h-[60px] text-sm" value={draft}
                    onChange={(e) => setDraft(e.target.value)} placeholder="Business definition…" />
                  <div className="flex gap-1.5">
                    <button onClick={() => save(t.term)} className="btn-primary flex-1 justify-center text-xs"><Check size={13} /> Save</button>
                    <button onClick={() => setEditing(null)} className="btn-outline text-xs"><X size={13} /></button>
                  </div>
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

              {t.columns.length > 0 && (
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
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
