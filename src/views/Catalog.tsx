import { useEffect, useMemo, useState } from "react";
import {
  Table2, Search, KeyRound, Lock, X, Check, Pencil,
  Sparkles, Hash, Calculator, ShieldCheck, Plus, Trash2,
  IdCard, Wand2, Loader2, FileInput, Workflow, Layers, Split,
} from "lucide-react";
import { useCatalog, useScopedDatasets } from "../store";
import { api } from "../api";
import {
  EmptyState, QualityBar, semanticColor, confidenceColor, shortDs, Sparkbars,
} from "../lib/ui";
import type { Column, Dataset } from "../types";

export function Catalog() {
  const datasets = useScopedDatasets();
  const [q, setQ] = useState("");
  const [selDs, setSelDs] = useState<string | null>(null);
  const [selCol, setSelCol] = useState<Column | null>(null);

  const filtered = useMemo(() => {
    if (!q.trim()) return datasets;
    const ql = q.toLowerCase();
    return datasets.filter((d) =>
      `${d.schema}.${d.name}`.toLowerCase().includes(ql) ||
      d.columns.some((c) => c.name.toLowerCase().includes(ql)));
  }, [datasets, q]);

  const active = datasets.find((d) => d.id === selDs) ?? filtered[0] ?? null;

  if (datasets.length === 0) {
    return (
      <EmptyState icon={<Table2 size={48} />} title="Catalog is empty"
        hint={<AddTableHint />} />
    );
  }

  return (
    <div className="grid h-[calc(100vh-9rem)] gap-4 lg:grid-cols-[260px_1fr]">
      {/* table list */}
      <div className="card flex flex-col overflow-hidden">
        <div className="border-b border-slate-200 p-2.5 dark:border-slate-800">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…"
              className="input !py-1.5 !pl-8 text-xs" />
          </div>
        </div>
        <div className="flex-1 overflow-auto p-1.5">
          {filtered.map((d) => {
            const isActive = (active?.id === d.id);
            const pii = d.columns.filter((c) => c.profile.sensitivity === "PII").length;
            return (
              <TableRow key={d.id} d={d} isActive={isActive} pii={pii}
                onSelect={() => { setSelDs(d.id); setSelCol(null); }} />
            );
          })}
        </div>
        <AddTableRow />
      </div>

      {/* table detail */}
      {active ? (
        <div className="grid min-h-0 gap-4 xl:grid-cols-[1fr_360px]">
          <TableDetail ds={active} onSelectCol={setSelCol} selCol={selCol} />
          <ColumnPanel ds={active} col={selCol} onClose={() => setSelCol(null)} />
        </div>
      ) : null}
    </div>
  );
}

// ---- Table row with inline delete ----------------------------------------- //
function TableRow({ d, isActive, pii, onSelect }: {
  d: Dataset; isActive: boolean; pii: number; onSelect: () => void;
}) {
  const { mutate, toast } = useCatalog();
  const del = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete table "${d.name}" from the catalog? This cannot be undone.`)) return;
    await mutate((v) => api.deleteDataset(d.id, v));
    toast("ok", `Table "${d.name}" removed`);
  };
  return (
    <div
      className={`group mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm ${
        isActive ? "bg-loom-500/10 text-loom-600 dark:text-loom-300" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
      <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <Table2 size={15} className="shrink-0 opacity-70" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{d.name}</div>
          <div className="truncate text-[10px] text-slate-400">{d.schema} · {d.columns.length} col</div>
        </div>
      </button>
      {pii > 0 && <Lock size={12} className="shrink-0 text-rose-400" />}
      <button onClick={del}
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 text-slate-400 hover:text-rose-500">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ---- Add table form -------------------------------------------------------- //
function AddTableRow() {
  const { state, mutate, toast } = useCatalog();
  const [open, setOpen] = useState(false);
  const [schema, setSchema] = useState("");
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");

  const conns = state?.connections ?? [];
  const [connId, setConnId] = useState(conns[0]?.id ?? "");

  const add = async () => {
    if (!name.trim()) return;
    const cid = connId || conns[0]?.id;
    if (!cid) { toast("err", "Add a connection first."); return; }
    await mutate((v) => api.addDataset({
      schema_name: schema || "PUBLIC", name: name.toUpperCase(), connection_id: cid, comment,
    }, v));
    toast("ok", `Table "${name}" added`);
    setOpen(false); setSchema(""); setName(""); setComment("");
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 border-t border-slate-200 px-3 py-2 text-xs text-slate-400 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800">
        <Plus size={13} /> Add table manually
      </button>
    );
  }
  return (
    <div className="border-t border-slate-200 p-2 dark:border-slate-800 space-y-1.5">
      <input className="input !py-1 text-xs" placeholder="Schema" value={schema} onChange={(e) => setSchema(e.target.value)} />
      <input className="input !py-1 text-xs" placeholder="Table name *" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input !py-1 text-xs" placeholder="Description (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
      {conns.length > 1 && (
        <select className="input !py-1 text-xs" value={connId} onChange={(e) => setConnId(e.target.value)}>
          {conns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      <div className="flex gap-1.5">
        <button onClick={add} className="btn-primary flex-1 justify-center !py-1 text-xs"><Check size={12} /> Add</button>
        <button onClick={() => setOpen(false)} className="btn-outline !py-1 text-xs">Cancel</button>
      </div>
    </div>
  );
}

function AddTableHint() {
  return (
    <span>Run the Profiler agent to populate the catalog, or
      <button onClick={() => {}} className="text-loom-500 underline ml-1">add a table manually</button>
      {" "}from the sidebar.
    </span>
  );
}

// ---- Table detail --------------------------------------------------------- //
function TableDetail({ ds, onSelectCol, selCol }: {
  ds: Dataset; onSelectCol: (c: Column) => void; selCol: Column | null;
}) {
  const { state, mutate, toast } = useCatalog();
  const doc = state?.docs[ds.id];
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaDef, setMetaDef] = useState(doc?.definition ?? "");
  const [metaDomain, setMetaDomain] = useState(doc?.domain ?? "");
  const [addingCol, setAddingCol] = useState(false);
  const [newCol, setNewCol] = useState({ name: "", data_type: "VARCHAR", nullable: true });

  const saveMeta = async () => {
    await mutate((v) => api.updateDatasetMeta(ds.id, { definition: metaDef, domain: metaDomain }, v));
    setEditingMeta(false); toast("ok", "Table info updated ✓");
  };

  const addCol = async () => {
    if (!newCol.name.trim()) return;
    await mutate((v) => api.addColumn(ds.id, newCol, v));
    toast("ok", `Column "${newCol.name}" added`); setAddingCol(false);
    setNewCol({ name: "", data_type: "VARCHAR", nullable: true });
  };

  const delCol = async (colName: string) => {
    if (!confirm(`Delete column "${colName}"?`)) return;
    await mutate((v) => api.deleteColumn(ds.id, colName, v));
    toast("ok", `Column "${colName}" removed`);
  };

  return (
    <div className="card flex min-h-0 flex-col overflow-hidden">
      <div className="border-b border-slate-200 p-4 dark:border-slate-800">
        {editingMeta ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-medium text-slate-400">Definition</label>
                <textarea className="input mt-0.5 min-h-[48px] text-xs" value={metaDef}
                  onChange={(e) => setMetaDef(e.target.value)} placeholder="Business definition…" />
              </div>
              <div>
                <label className="text-[10px] font-medium text-slate-400">Domain</label>
                <input className="input mt-0.5 text-xs" value={metaDomain}
                  onChange={(e) => setMetaDomain(e.target.value)} placeholder="e.g. Sales, Finance" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={saveMeta} className="btn-primary text-xs"><Check size={13} /> Save</button>
              <button onClick={() => setEditingMeta(false)} className="btn-outline text-xs">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold">{ds.schema}.{ds.name}</h3>
                {doc?.domain && <span className="chip bg-loom-500/10 text-loom-500">{doc.domain}</span>}
                <span className="ml-auto text-xs text-slate-400">~{ds.row_estimate.toLocaleString()} rows</span>
              </div>
              <p className="mt-0.5 text-sm text-slate-500">
                {doc?.definition || ds.comment || <span className="italic text-slate-400">No definition — run the Documenter agent or edit manually.</span>}
              </p>
            </div>
            <button onClick={() => { setMetaDef(doc?.definition ?? ""); setMetaDomain(doc?.domain ?? ""); setEditingMeta(true); }}
              className="btn-ghost !p-1.5 text-slate-400"><Pencil size={14} /></button>
          </div>
        )}
      </div>
      <TableIdentity ds={ds} />
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400 dark:bg-slate-900">
            <tr>
              <th className="px-4 py-2 font-medium">Column</th>
              <th className="px-2 py-2 font-medium">Type</th>
              <th className="px-2 py-2 font-medium">Semantic</th>
              <th className="px-2 py-2 font-medium">Quality</th>
              <th className="px-2 py-2 font-medium">Null</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {ds.columns.map((c) => {
              const p = c.profile;
              const cdoc = doc?.columns?.[c.name];
              const isSel = selCol?.name === c.name && selCol?.dataset_id === c.dataset_id;
              return (
                <tr key={c.name} onClick={() => onSelectCol(c)}
                  className={`cursor-pointer border-t border-slate-100 dark:border-slate-800/60 ${
                    isSel ? "bg-loom-500/10" : "hover:bg-slate-50 dark:hover:bg-slate-800/40"}`}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      {p.is_key_candidate && <KeyRound size={12} className="text-amber-500" />}
                      <span className="font-medium">{c.name}</span>
                      {p.sensitivity === "PII" && <Lock size={11} className="text-rose-400" />}
                      {cdoc?.status === "validated" && <ShieldCheck size={12} className="text-emerald-500" />}
                    </div>
                    {cdoc?.definition && <div className="truncate text-[11px] text-slate-400">{cdoc.definition}</div>}
                  </td>
                  <td className="px-2 py-2 font-mono text-[11px] text-slate-400">{c.data_type}</td>
                  <td className="px-2 py-2">
                    <span className={`chip ${semanticColor(p.semantic_type)}`}>{p.semantic_type}</span>
                  </td>
                  <td className="px-2 py-2"><QualityBar value={p.quality_score} /></td>
                  <td className="px-2 py-2 font-mono text-[11px] text-slate-400">{(p.null_ratio * 100).toFixed(0)}%</td>
                  <td className="px-2 py-2">
                    <button onClick={(e) => { e.stopPropagation(); delCol(c.name); }}
                      className="opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100 text-slate-400 hover:text-rose-500">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Add column */}
        {addingCol ? (
          <div className="flex items-end gap-2 border-t border-slate-200 p-3 dark:border-slate-800">
            <div className="flex-1">
              <input className="input !py-1 text-xs" placeholder="Column name *" value={newCol.name}
                onChange={(e) => setNewCol((c) => ({ ...c, name: e.target.value }))} />
            </div>
            <select className="input !py-1 text-xs w-36" value={newCol.data_type}
              onChange={(e) => setNewCol((c) => ({ ...c, data_type: e.target.value }))}>
              {["VARCHAR", "INTEGER", "NUMBER", "DATE", "TIMESTAMP", "BOOLEAN", "JSON"].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <button onClick={addCol} className="btn-primary !py-1 text-xs"><Check size={13} /> Add</button>
            <button onClick={() => setAddingCol(false)} className="btn-outline !py-1 text-xs">✕</button>
          </div>
        ) : (
          <button onClick={() => setAddingCol(true)}
            className="flex w-full items-center gap-1.5 border-t border-slate-200 px-4 py-2 text-xs text-slate-400 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800">
            <Plus size={13} /> Add column manually
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Column panel --------------------------------------------------------- //
function ColumnPanel({ ds, col, onClose }: { ds: Dataset; col: Column | null; onClose: () => void }) {
  const { state, mutate, toast } = useCatalog();
  const [editing, setEditing] = useState(false);
  const [def, setDef] = useState("");
  const [calc, setCalc] = useState("");

  if (!col) {
    return (
      <div className="card hidden items-center justify-center p-6 text-center text-sm text-slate-400 xl:flex">
        <div><Hash className="mx-auto mb-2 opacity-40" /> Select a column<br />to view its fingerprint.</div>
      </div>
    );
  }

  const doc = state?.docs[ds.id]?.columns?.[col.name];
  const p = col.profile;

  const [srcFile, setSrcFile] = useState("");
  const [srcField, setSrcField] = useState("");
  const startEdit = () => {
    setDef(doc?.definition ?? ""); setCalc(doc?.calculation ?? "");
    setSrcFile(doc?.source_file ?? ""); setSrcField(doc?.source_field ?? "");
    setEditing(true);
  };
  const save = async () => {
    await mutate((v) => api.editColumnDoc(ds.id, col.name, {
      definition: def, calculation: calc || null,
      source_file: srcFile || undefined, source_field: srcField || undefined,
    }, v));
    setEditing(false); toast("ok", "Definition saved ✓");
  };
  const setStatus = async (status: string) => {
    await mutate((v) => api.editColumnDoc(ds.id, col.name, { status }, v));
    toast("ok", status === "validated" ? "Validated ✓" : "Rejected");
  };

  return (
    <div className="card flex min-h-0 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
        <span className="font-mono text-sm font-semibold">{col.name}</span>
        <span className={`chip ${semanticColor(p.semantic_type)}`}>{p.semantic_type}</span>
        <button onClick={onClose} className="btn-ghost ml-auto !p-1"><X size={15} /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4 text-sm">
        <section>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <Sparkles size={12} /> Functional definition
            {doc?.source && <span className="ml-auto chip bg-slate-500/10 text-slate-400">{doc.source}</span>}
          </div>
          {editing ? (
            <div className="space-y-2">
              <textarea className="input min-h-[60px]" value={def} onChange={(e) => setDef(e.target.value)}
                placeholder="Business definition…" />
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                <Calculator size={12} /> Calculation method
              </div>
              <textarea className="input min-h-[44px]" value={calc} onChange={(e) => setCalc(e.target.value)}
                placeholder="e.g. SUM(line_amount) GROUP BY order_id" />
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                <FileInput size={12} /> Source origin (optional)
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input className="input !py-1.5 text-xs" value={srcFile} onChange={(e) => setSrcFile(e.target.value)}
                  placeholder="Source file / topic (e.g. orders.csv, kafka:sales)" />
                <input className="input !py-1.5 text-xs" value={srcField} onChange={(e) => setSrcField(e.target.value)}
                  placeholder="Source field (e.g. ORD_AMT)" />
              </div>
              <div className="flex gap-2">
                <button onClick={save} className="btn-primary flex-1 justify-center"><Check size={14} /> Save</button>
                <button onClick={() => setEditing(false)} className="btn-outline">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-slate-600 dark:text-slate-300">{doc?.definition || <span className="text-slate-400">No definition yet.</span>}</p>
              {doc?.calculation && (
                <div className="rounded-lg bg-slate-100 p-2 font-mono text-xs dark:bg-slate-800">
                  <Calculator size={11} className="mb-1 inline text-loom-500" /> {doc.calculation}
                </div>
              )}
              {(doc?.source_file || doc?.source_field) && (
                <div className="flex flex-wrap gap-1.5">
                  {doc?.source_file && <span className="chip bg-teal-500/10 text-teal-500"><FileInput size={10} /> {doc.source_file}</span>}
                  {doc?.source_field && <span className="chip bg-slate-500/10 font-mono text-slate-500">↤ {doc.source_field}</span>}
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={startEdit} className="btn-outline text-xs"><Pencil size={12} /> Edit</button>
                {doc?.status !== "validated" && (
                  <button onClick={() => setStatus("validated")} className="btn-ghost text-xs text-emerald-500">
                    <ShieldCheck size={13} /> Validate
                  </button>
                )}
                {doc?.status === "validated" && (
                  <button onClick={() => setStatus("suggested")} className="btn-ghost text-xs text-amber-500">
                    Revert to suggested
                  </button>
                )}
                {doc?.confidence !== undefined && (
                  <span className={`ml-auto chip ${confidenceColor(doc.confidence)} bg-current/10`}>
                    conf. {doc.confidence}%
                  </span>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="grid grid-cols-2 gap-2">
          <Mini label="Distinct" value={p.distinct.toLocaleString()} sub={`${(p.distinct_ratio * 100).toFixed(0)}%`} />
          <Mini label="Nulls" value={`${(p.null_ratio * 100).toFixed(1)}%`} />
          <Mini label="Sample" value={p.row_count.toLocaleString()} />
          <Mini label="Sensitivity" value={p.sensitivity} accent={p.sensitivity === "PII" ? "text-rose-500" : ""} />
          {p.numeric && <>
            <Mini label="Min" value={String(p.numeric.min)} />
            <Mini label="Max" value={String(p.numeric.max)} />
            <Mini label="Mean" value={String(p.numeric.mean)} />
          </>}
        </section>

        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Quality</div>
          {Object.entries(p.quality_breakdown).map(([k, v]) => (
            <div key={k} className="mb-1.5 flex items-center gap-2 text-xs">
              <span className="w-24 capitalize text-slate-500">{k}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div className="h-full rounded-full bg-loom-500" style={{ width: `${v * 100}%` }} />
              </div>
              <span className="w-9 text-right font-mono text-slate-400">{(v * 100).toFixed(0)}</span>
            </div>
          ))}
        </section>

        {p.format_masks.length > 0 && (
          <section>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Format fingerprint</div>
            <div className="flex flex-wrap gap-1.5">
              {p.format_masks.map((m, i) => (
                <span key={i} className="chip bg-slate-500/10 font-mono text-slate-500">
                  {m.mask || "∅"} <span className="opacity-60">×{m.count}</span>
                </span>
              ))}
            </div>
          </section>
        )}

        {p.top_values.length > 0 && (
          <section>
            <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
              <span>Top values</span>
              <Sparkbars values={p.top_values.map((t) => t.count)} height={24} />
            </div>
            <div className="space-y-1">
              {p.top_values.slice(0, 6).map((t, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 truncate font-mono text-slate-500">{t.value}</span>
                  <span className="font-mono text-slate-400">{t.count}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Mini({ label, value, sub, accent = "" }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800/60">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`font-mono text-sm font-semibold ${accent}`}>{value} {sub && <span className="text-[10px] text-slate-400">{sub}</span>}</div>
    </div>
  );
}

// ---- Identity card + content synthesis + partitioning + mapping import ----- //
function TableIdentity({ ds }: { ds: Dataset }) {
  const { state, health, mutate, toast } = useCatalog();
  const doc = state?.docs[ds.id];
  const [open, setOpen] = useState(false);
  const [synthLoading, setSynthLoading] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const llmUp = health?.llm.up ?? false;

  // partitioning editor
  const [pcol, setPcol] = useState(doc?.partitioning?.column ?? doc?.suggested_partition ?? "");
  const [pexp, setPexp] = useState(doc?.partitioning?.explanation ?? "");

  const synth = doc?.synthesis;
  const identity = doc?.identity;

  const generate = async () => {
    setSynthLoading(true);
    try {
      const r = await mutate((v) => api.synthesizeTable(ds.id, v));
      if (r) toast("ok", "Synthesis generated & stored ✓");
    } catch (e) {
      toast("err", (e as Error).message.includes("503") ? "Local LLM unavailable" : "Failed");
    } finally { setSynthLoading(false); }
  };

  const savePartition = async () => {
    const partitions = pcol
      ? (ds.columns.find((c) => c.name === pcol)?.profile.top_values ?? [])
          .slice(0, 12).map((t) => ({ value: String(t.value) }))
      : [];
    await mutate((v) => api.updateDatasetMeta(ds.id, {
      partitioning: { column: pcol || undefined, explanation: pexp || undefined, partitions },
    }, v));
    toast("ok", "Partitioning saved ✓");
  };

  const isMappingLike = /map|config|etl|ref_/i.test(ds.name);

  return (
    <div className="border-b border-slate-200 dark:border-slate-800">
      <button onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/40">
        <IdCard size={14} className="text-loom-500" /> Identity card & synthesis
        {synth && <span className="chip bg-emerald-500/10 text-emerald-500 normal-case">stored</span>}
        {isMappingLike && <span className="chip bg-violet-500/10 text-violet-400 normal-case">looks like a mapping table</span>}
        <span className="ml-auto">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="space-y-3 px-4 pb-4">
          {/* synthesis */}
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-slate-500">
              <Sparkles size={13} className="text-loom-500" /> Content synthesis
              {doc?.synthesis_source && <span className="chip bg-slate-500/10 text-slate-400">{doc.synthesis_source}</span>}
              <button onClick={generate} disabled={!llmUp || synthLoading} className="btn-outline ml-auto !py-1 text-xs">
                {synthLoading ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                {synth ? "Regenerate" : "Generate with AI"}
              </button>
            </div>
            {synth ? (
              <>
                <p className="text-sm text-slate-600 dark:text-slate-300">{synth}</p>
                {identity && (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                    {identity.data_kind && <IdField label="Data kind" value={String(identity.data_kind)} />}
                    {identity.content && <IdField label="Grain" value={String(identity.content)} />}
                    {Array.isArray(identity.products) && identity.products.length > 0 &&
                      <IdField label="Products" value={(identity.products as string[]).join(", ")} />}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm italic text-slate-400">No synthesis yet — generate one (stored & reused, never recomputed unless you regenerate).</p>
            )}
          </div>

          {/* logical partitioning → virtual sub-tables */}
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-slate-500">
              <Split size={13} className="text-loom-500" /> Logical partitioning (virtual sub-tables)
            </div>
            <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
              <select className="input !py-1.5 text-xs" value={pcol} onChange={(e) => setPcol(e.target.value)}>
                <option value="">No partition</option>
                {ds.columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
              <input className="input !py-1.5 text-xs" value={pexp} onChange={(e) => setPexp(e.target.value)}
                placeholder="Explain the split in plain English (e.g. platformID splits into sub-applications; field A differs per platform)" />
            </div>
            {pcol && (
              <div className="mt-2 flex flex-wrap gap-1">
                {(ds.columns.find((c) => c.name === pcol)?.profile.top_values ?? []).slice(0, 10).map((t, i) => (
                  <span key={i} className="chip bg-loom-500/10 font-mono text-loom-500"><Layers size={9} /> {pcol}={String(t.value)}</span>
                ))}
              </div>
            )}
            <button onClick={savePartition} className="btn-outline mt-2 !py-1 text-xs"><Check size={12} /> Save partitioning</button>
          </div>

          {/* ETL mapping import */}
          <div className="rounded-lg border border-violet-200 bg-violet-50/30 p-3 dark:border-violet-900/40 dark:bg-violet-950/10">
            <div className="flex items-center gap-2">
              <Workflow size={14} className="text-violet-500" />
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">ETL mapping import</span>
              <button onClick={() => setMapOpen(true)} disabled={!llmUp} className="btn-outline ml-auto !py-1 text-xs">
                <FileInput size={12} /> Analyse as mapping table
              </button>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              If this table holds ETL config (target table/field/definition…), let the LLM read it and build lineage + pre-documentation — merged, never erasing what exists.
            </p>
          </div>
        </div>
      )}

      {mapOpen && <MappingModal ds={ds} onClose={() => setMapOpen(false)} />}
    </div>
  );
}

function IdField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-slate-100 p-1.5 dark:bg-slate-800/60">
      <div className="text-[9px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-xs text-slate-600 dark:text-slate-300">{value}</div>
    </div>
  );
}

const MAP_ROLES = [
  ["target_table", "Target table"], ["target_column", "Target field"],
  ["target_definition", "Target definition"], ["source_table", "Source table"],
  ["source_column", "Source field"], ["transformation", "Transformation"],
] as const;

function MappingModal({ ds, onClose }: { ds: Dataset; onClose: () => void }) {
  const { mutate, toast } = useCatalog();
  const [loading, setLoading] = useState(true);
  const [cols, setCols] = useState<string[]>([]);
  const [roles, setRoles] = useState<Record<string, string | null>>({});
  const [confidence, setConfidence] = useState(0);
  const [applying, setApplying] = useState(false);

  // detect role columns on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.mappingDetect(ds.id);
        if (!alive) return;
        setCols(r.columns); setRoles(r.roles); setConfidence(r.confidence);
      } catch (e) {
        toast("err", (e as Error).message.includes("503") ? "Local LLM unavailable" : "Detection failed");
        onClose();
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [ds.id]); // eslint-disable-line

  const apply = async () => {
    setApplying(true);
    try {
      const r = await mutate((v) => api.mappingApply(ds.id, roles, v));
      if (r) toast("ok", `Mapping applied — +${r.edges_added} lineage edges, +${r.docs_added} definitions`);
      onClose();
    } finally { setApplying(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center gap-2">
          <Workflow size={18} className="text-violet-500" />
          <h3 className="font-semibold">ETL mapping — {ds.name}</h3>
          <button onClick={onClose} className="btn-ghost ml-auto !p-1"><X size={16} /></button>
        </div>
        {loading ? (
          <div className="grid place-items-center py-10 text-slate-400">
            <div className="flex items-center gap-2"><Loader2 className="animate-spin" /> Detecting role columns…</div>
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs text-slate-400">
              The LLM mapped each role to a column ({confidence}% confident). Adjust if needed, then apply.
              Existing docs and lineage are <b>never erased</b>.
            </p>
            <div className="space-y-2">
              {MAP_ROLES.map(([role, label]) => (
                <div key={role} className="flex items-center gap-2 text-sm">
                  <span className="w-36 shrink-0 text-xs text-slate-500">{label}</span>
                  <select className="input !py-1.5 text-xs" value={roles[role] ?? ""}
                    onChange={(e) => setRoles((r) => ({ ...r, [role]: e.target.value || null }))}>
                    <option value="">— none —</option>
                    {cols.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={apply} disabled={applying} className="btn-primary flex-1 justify-center">
                {applying ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Build lineage & docs
              </button>
              <button onClick={onClose} className="btn-outline">Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
