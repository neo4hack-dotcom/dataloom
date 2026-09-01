import { useEffect, useMemo, useState } from "react";
import {
  Table2, Search, KeyRound, Lock, X, Check, Pencil,
  Sparkles, Hash, Calculator, ShieldCheck, Plus, Trash2,
  IdCard, Wand2, Loader2, FileInput, Workflow, Layers, Split, RefreshCw,
  LayoutDashboard, Columns3, GitCompare, ShieldAlert, Settings2, BookOpen,
  Tag as TagIcon, UserPlus, AlertTriangle, EyeOff, Eye, ArrowRight, Users,
} from "lucide-react";
import { useCatalog, useScopedDatasets } from "../store";
import { api, type ColumnSuggestion, type TableSuggestion } from "../api";
import {
  EmptyState, QualityBar, semanticColor, confidenceColor, shortDs, Sparkbars, timeAgo,
  TagChip, AvatarStack, HealthRing, healthTextClass, nameColor,
} from "../lib/ui";
import { computeDatasetHealth } from "../lib/health";
import { useConfirm } from "../components/ConfirmDialog";
import type { CachedColumnSuggestion, Column, Dataset } from "../types";
import type { Tab } from "../App";

/** A doc is "protected" once a human has validated it or written it by hand —
 * an LLM suggestion overwriting it needs the strongest confirmation. */
function isProtectedDoc(doc: any): boolean {
  return !!doc && (doc.status === "validated" || doc.source === "human");
}

export function Catalog({ goto }: { goto?: (t: Tab) => void }) {
  const datasets = useScopedDatasets();
  const { focusDataset, setFocusDataset } = useCatalog();
  const [q, setQ] = useState("");
  const [selDs, setSelDs] = useState<string | null>(null);
  const [selCol, setSelCol] = useState<Column | null>(null);

  // Search / Command Palette / Impact Analysis can drill straight into a table (+column)
  useEffect(() => {
    if (!focusDataset) return;
    setSelDs(focusDataset.dsId);
    const ds = datasets.find((d) => d.id === focusDataset.dsId);
    const col = focusDataset.col ? ds?.columns.find((c) => c.name === focusDataset.col) ?? null : null;
    setSelCol(col);
    setFocusDataset(null);
  }, [focusDataset]); // eslint-disable-line

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
          <TableDetail ds={active} onSelectCol={setSelCol} selCol={selCol} goto={goto} />
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
  const { state, mutate, toast } = useCatalog();
  const deprecated = !!state?.docs[d.id]?.deprecated;
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
          <div className={`truncate font-medium ${deprecated ? "line-through opacity-60" : ""}`}>{d.name}</div>
          <div className="truncate text-[10px] text-slate-400">{d.schema} · {d.columns.length} col</div>
        </div>
      </button>
      {deprecated && <AlertTriangle size={12} className="shrink-0 text-rose-500" />}
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
type EntityTab = "overview" | "schema" | "lineage" | "quality" | "properties" | "docs";
const ENTITY_TABS: { id: EntityTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "schema", label: "Schema", icon: Columns3 },
  { id: "lineage", label: "Lineage", icon: GitCompare },
  { id: "quality", label: "Quality", icon: ShieldAlert },
  { id: "properties", label: "Properties", icon: Settings2 },
  { id: "docs", label: "Documentation", icon: BookOpen },
];

function TableDetail({ ds, onSelectCol, selCol, goto }: {
  ds: Dataset; onSelectCol: (c: Column) => void; selCol: Column | null; goto?: (t: Tab) => void;
}) {
  const { state, health, mutate, setFocusDataset, toast } = useCatalog();
  const doc = state?.docs[ds.id];
  const llmUp = health?.llm.up ?? false;
  const [tab, setTab] = useState<EntityTab>("overview");
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaDef, setMetaDef] = useState(doc?.definition ?? "");
  const [metaDomain, setMetaDomain] = useState(doc?.domain ?? "");
  const [addingCol, setAddingCol] = useState(false);
  const [newCol, setNewCol] = useState({ name: "", data_type: "VARCHAR", nullable: true });
  const [autoDocOpen, setAutoDocOpen] = useState(false);
  const [deprecating, setDeprecating] = useState(false);
  const [depReason, setDepReason] = useState("");
  const [depReplacement, setDepReplacement] = useState("");

  useEffect(() => {
    setTab("overview"); setDeprecating(false);
    api.recordDatasetView(ds.id).catch(() => {});
  }, [ds.id]);

  const provenance = useMemo(() => {
    let validated = 0, suggested = 0, undocumented = 0;
    for (const c of ds.columns) {
      const cd = doc?.columns?.[c.name];
      if (cd?.status === "validated") validated++;
      else if (cd?.definition) suggested++;
      else undocumented++;
    }
    return { validated, suggested, undocumented };
  }, [ds.columns, doc?.columns]);

  const health_ = useMemo(() => computeDatasetHealth(ds, doc, state?.settings.alerts), [ds, doc, state?.settings.alerts]);

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

  const submitDeprecate = async () => {
    if (!depReason.trim()) { toast("err", "Give a reason"); return; }
    await mutate((v) => api.deprecateDataset(ds.id, depReason.trim(), depReplacement || null, v));
    toast("ok", "Marked as deprecated");
    setDeprecating(false); setDepReason(""); setDepReplacement("");
  };

  const undeprecate = async () => {
    await mutate((v) => api.undeprecateDataset(ds.id, v));
    toast("ok", "Deprecation cleared");
  };

  const otherDatasets = (state?.datasets ?? []).filter((d) => d.id !== ds.id);

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
                <label className="text-[10px] font-medium text-slate-400">Domain (free text)</label>
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
            <HealthRing score={health_.score} size={38} thickness={4} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-lg font-bold">{ds.schema}.{ds.name}</h3>
                {doc?.domain && <span className="chip bg-loom-500/10 text-loom-500">{doc.domain}</span>}
                {doc?.deprecated && <span className="chip bg-rose-500/10 text-rose-500"><AlertTriangle size={10} /> deprecated</span>}
                {(doc?.view_count ?? 0) > 0 && (
                  <span className="chip bg-slate-500/10 text-slate-400"><Eye size={10} /> {doc!.view_count}</span>
                )}
                <span className="ml-auto shrink-0 text-xs text-slate-400">~{ds.row_estimate.toLocaleString()} rows</span>
              </div>
              <p className="mt-0.5 truncate text-sm text-slate-500">
                {doc?.definition || ds.comment || <span className="italic text-slate-400">No definition — run the Documenter agent or edit manually.</span>}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {provenance.validated > 0 && (
                  <span className="chip bg-emerald-500/10 text-emerald-500"><ShieldCheck size={10} /> {provenance.validated} validated</span>
                )}
                {provenance.suggested > 0 && <span className="chip bg-slate-500/10 text-slate-400">{provenance.suggested} suggested</span>}
                {provenance.undocumented > 0 && <span className="chip bg-amber-500/10 text-amber-500">{provenance.undocumented} undocumented</span>}
              </div>
            </div>
            {doc?.deprecated ? (
              <button onClick={undeprecate} className="btn-outline !py-1 text-xs text-rose-500"><EyeOff size={13} /> Undeprecate</button>
            ) : (
              <button onClick={() => setDeprecating((v) => !v)} className="btn-ghost !py-1 text-xs text-slate-400">
                <AlertTriangle size={13} /> Deprecate
              </button>
            )}
            <button onClick={() => { setMetaDef(doc?.definition ?? ""); setMetaDomain(doc?.domain ?? ""); setEditingMeta(true); }}
              className="btn-ghost !p-1.5 text-slate-400"><Pencil size={14} /></button>
          </div>
        )}

        {doc?.deprecated && (
          <div className="mt-2 flex items-start gap-2 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span className="flex-1">
              <b>Deprecated</b> by {doc.deprecated.by} {timeAgo(doc.deprecated.at)} ago — {doc.deprecated.reason}
              {doc.deprecated.replacement_dataset_id && (
                <> · use{" "}
                  <button onClick={() => setFocusDataset({ dsId: doc.deprecated!.replacement_dataset_id! })}
                    className="underline hover:no-underline">
                    {shortDs(doc.deprecated.replacement_dataset_id)}
                  </button>{" "}instead
                </>
              )}
            </span>
          </div>
        )}

        {deprecating && (
          <div className="mt-2 space-y-1.5 rounded-lg border border-rose-200 p-2.5 dark:border-rose-900/40">
            <textarea className="input min-h-[40px] text-xs" value={depReason} onChange={(e) => setDepReason(e.target.value)}
              placeholder="Reason (e.g. superseded by a new pipeline)…" />
            <select className="input text-xs" value={depReplacement} onChange={(e) => setDepReplacement(e.target.value)}>
              <option value="">No replacement</option>
              {otherDatasets.map((d) => <option key={d.id} value={d.id}>{d.schema}.{d.name}</option>)}
            </select>
            <div className="flex gap-1.5">
              <button onClick={submitDeprecate} className="btn-primary !py-1 text-xs text-rose-50 !bg-rose-600 hover:!bg-rose-700">
                Confirm deprecation
              </button>
              <button onClick={() => setDeprecating(false)} className="btn-outline !py-1 text-xs">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* tab bar */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 px-2 dark:border-slate-800">
        {ENTITY_TABS.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                isActive ? "border-loom-500 text-loom-600 dark:text-loom-300" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}>
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "overview" && <OverviewTabContent ds={ds} doc={doc} health={health_} />}
        {tab === "schema" && (
          <SchemaTabContent ds={ds} doc={doc} selCol={selCol} onSelectCol={onSelectCol} delCol={delCol}
            addingCol={addingCol} setAddingCol={setAddingCol} newCol={newCol} setNewCol={setNewCol} addCol={addCol} />
        )}
        {tab === "lineage" && <LineageTabContent ds={ds} goto={goto} onSelectCol={onSelectCol} />}
        {tab === "quality" && <QualityTabContent health={health_} />}
        {tab === "properties" && <PropertiesTabContent ds={ds} doc={doc} />}
        {tab === "docs" && (
          <div>
            <div className="flex justify-end p-3 pb-0">
              <button onClick={() => setAutoDocOpen(true)} disabled={!llmUp}
                className="btn-ai-outline !py-1 text-xs" title="Auto-document every column at once">
                <Wand2 size={13} /> Auto-document table
              </button>
            </div>
            <TableIdentity ds={ds} />
          </div>
        )}
      </div>
      {autoDocOpen && <AutoDocModal ds={ds} doc={doc} onClose={() => setAutoDocOpen(false)} />}
    </div>
  );
}

// ---- Overview tab: tags, domain, owners, quick stats ------------------------ //
function OverviewTabContent({ ds, doc, health }: { ds: Dataset; doc: any; health: ReturnType<typeof computeDatasetHealth> }) {
  const { state, mutate, toast } = useCatalog();
  const [newTag, setNewTag] = useState("");
  const [addingOwner, setAddingOwner] = useState(false);
  const [ownerName, setOwnerName] = useState("");
  const [ownerType, setOwnerType] = useState<"technical" | "business" | "steward">("technical");

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const d of Object.values(state?.docs ?? {})) {
      for (const t of (d as any).tags ?? []) s.add(t);
      for (const c of Object.values((d as any).columns ?? {})) for (const t of (c as any).tags ?? []) s.add(t);
    }
    return [...s].sort();
  }, [state?.docs]);

  const addTag = async () => {
    const tag = newTag.trim().toLowerCase();
    if (!tag) return;
    await mutate((v) => api.addDatasetTag(ds.id, tag, v));
    setNewTag("");
  };
  const removeTag = async (tag: string) => { await mutate((v) => api.removeDatasetTag(ds.id, tag, v)); };

  const setDomain = async (domainId: string) => {
    await mutate((v) => api.setDatasetDomain(ds.id, domainId || null, v));
  };

  const addOwner = async () => {
    if (!ownerName.trim()) return;
    await mutate((v) => api.addDatasetOwner(ds.id, { name: ownerName.trim(), type: ownerType }, v));
    toast("ok", `${ownerName} added as owner`);
    setOwnerName(""); setAddingOwner(false);
  };
  const removeOwner = async (id: string) => { await mutate((v) => api.removeDatasetOwner(ds.id, id, v)); };

  const domains = state?.domains ?? [];
  const domainPath = (id: string | null | undefined): string => {
    if (!id) return "";
    const d = domains.find((x) => x.id === id);
    if (!d) return "";
    return d.parent_id ? `${domainPath(d.parent_id)} / ${d.name}` : d.name;
  };

  const pii = ds.columns.filter((c) => c.profile.sensitivity === "PII").length;
  const rels = (state?.relationships ?? []).filter((r) =>
    r.child.dataset_id === ds.id || r.parent.dataset_id === ds.id).length;

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatBox label="Columns" value={ds.columns.length} />
        <StatBox label="PII fields" value={pii} accent={pii > 0 ? "text-rose-500" : ""} />
        <StatBox label="Relationships" value={rels} />
        <StatBox label="Health" value={`${health.score}`} accent={healthTextClass(health.score)} />
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <TagIcon size={12} /> Tags
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(doc?.tags ?? []).map((t: string) => <TagChip key={t} tag={t} onRemove={() => removeTag(t)} />)}
          <input value={newTag} onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTag()}
            list="tag-suggestions" placeholder="+ add tag" className="input !w-28 !py-1 text-xs" />
          <datalist id="tag-suggestions">{allTags.map((t) => <option key={t} value={t} />)}</datalist>
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Domain</div>
        <select className="input !py-1.5 text-xs" value={doc?.domain_id ?? ""} onChange={(e) => setDomain(e.target.value)}>
          <option value="">No domain</option>
          {domains.map((d) => <option key={d.id} value={d.id}>{domainPath(d.id)}</option>)}
        </select>
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <Users size={12} /> Owners
        </div>
        {(doc?.owners ?? []).length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(doc.owners as any[]).map((o) => (
              <span key={o.id} className={`chip ${nameColor(o.name).bg} ${nameColor(o.name).text}`}>
                {o.name} <span className="opacity-60">· {o.type}</span>
                <button onClick={() => removeOwner(o.id)} className="ml-0.5 opacity-60 hover:opacity-100"><X size={10} /></button>
              </span>
            ))}
          </div>
        )}
        {addingOwner ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Name"
              className="input !w-32 !py-1 text-xs" />
            <select value={ownerType} onChange={(e) => setOwnerType(e.target.value as any)} className="input !py-1 text-xs">
              <option value="technical">technical</option>
              <option value="business">business</option>
              <option value="steward">steward</option>
            </select>
            <button onClick={addOwner} className="btn-primary !py-1 text-xs"><Check size={12} /> Add</button>
            <button onClick={() => setAddingOwner(false)} className="btn-outline !py-1 text-xs">✕</button>
          </div>
        ) : (
          <button onClick={() => setAddingOwner(true)} className="btn-outline !py-1 text-xs"><UserPlus size={12} /> Add owner</button>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, accent = "" }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-lg bg-slate-100 p-2.5 dark:bg-slate-800/60">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`font-mono text-lg font-bold ${accent}`}>{value}</div>
    </div>
  );
}

// ---- Schema tab: existing column table + tag chips + add-column form -------- //
function SchemaTabContent({ ds, doc, selCol, onSelectCol, delCol, addingCol, setAddingCol, newCol, setNewCol, addCol }: {
  ds: Dataset; doc: any; selCol: Column | null; onSelectCol: (c: Column) => void; delCol: (name: string) => void;
  addingCol: boolean; setAddingCol: (v: boolean) => void;
  newCol: { name: string; data_type: string; nullable: boolean }; setNewCol: (f: (c: any) => any) => void; addCol: () => void;
}) {
  const { mutate } = useCatalog();
  const addColTag = async (col: string, tag: string) => { if (tag.trim()) await mutate((v) => api.addColumnTag(ds.id, col, tag.trim(), v)); };
  const removeColTag = async (col: string, tag: string) => { await mutate((v) => api.removeColumnTag(ds.id, col, tag, v)); };

  return (
    <div>
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
              <tr key={c.name} onClick={() => onSelectCol(c)} className={`group cursor-pointer border-t border-slate-100 dark:border-slate-800/60 ${
                  isSel ? "bg-loom-500/10" : "hover:bg-slate-50 dark:hover:bg-slate-800/40"}`}>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-1.5">
                    {p.is_key_candidate && <KeyRound size={12} className="text-amber-500" />}
                    <span className="font-medium">{c.name}</span>
                    {p.sensitivity === "PII" && <Lock size={11} className="text-rose-400" />}
                    {cdoc?.status === "validated" && <ShieldCheck size={12} className="text-emerald-500" />}
                  </div>
                  {cdoc?.definition && <div className="truncate text-[11px] text-slate-400">{cdoc.definition}</div>}
                  <div className="mt-0.5 flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {(cdoc?.tags ?? []).map((t: string) => <TagChip key={t} tag={t} onRemove={() => removeColTag(c.name, t)} />)}
                    <button onClick={() => { const t = window.prompt("Tag name?"); if (t) addColTag(c.name, t); }}
                      className="text-[10px] text-slate-400 opacity-0 hover:text-loom-500 group-hover:opacity-100">
                      + tag
                    </button>
                  </div>
                </td>
                <td className="px-2 py-2 font-mono text-[11px] text-slate-400">{c.data_type}</td>
                <td className="px-2 py-2"><span className={`chip ${semanticColor(p.semantic_type)}`}>{p.semantic_type}</span></td>
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
  );
}

// ---- Lineage tab: relationships + column-lineage touching this table -------- //
function LineageTabContent({ ds, goto, onSelectCol }: { ds: Dataset; goto?: (t: Tab) => void; onSelectCol: (c: Column) => void }) {
  const { state, setFocusImpact } = useCatalog();
  const rels = (state?.relationships ?? []).filter((r) =>
    r.child.dataset_id === ds.id || r.parent.dataset_id === ds.id);
  const colLineage = (state?.column_lineage ?? []).filter((e) =>
    e.from.dataset_id === ds.id || e.to.dataset_id === ds.id);
  const edges = [...rels.map((r) => ({
    from: r.child, to: r.parent, label: `key: ${r.confidence.toFixed(0)}%`,
  })), ...colLineage.map((e) => ({ from: e.from, to: e.to, label: e.via || e.kind }))];

  return (
    <div className="space-y-3 p-4">
      {edges.length === 0 ? (
        <EmptyState icon={<GitCompare size={36} />} title="No column-level links yet"
          hint="Run the Linker agent, or add a manual derivation edge from Impact Analysis." />
      ) : (
        <div className="space-y-1.5">
          {edges.map((e, i) => {
            const isOutbound = e.from.dataset_id === ds.id;
            const other = isOutbound ? e.to : e.from;
            const mine = isOutbound ? e.from : e.to;
            return (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-800">
                <button onClick={() => { const col = ds.columns.find((c) => c.name === mine.column); if (col) onSelectCol(col); }}
                  className="font-mono text-slate-500 hover:text-loom-500">{mine.column}</button>
                {isOutbound ? <ArrowRight size={13} className="shrink-0 text-loom-500" /> : <ArrowRight size={13} className="shrink-0 rotate-180 text-slate-400" />}
                <span className="min-w-0 flex-1 truncate font-mono">{shortDs(other.dataset_id)}.{other.column}</span>
                <span className="shrink-0 text-slate-400">{e.label}</span>
              </div>
            );
          })}
        </div>
      )}
      <button onClick={() => { setFocusImpact({ dsId: ds.id, col: ds.columns[0]?.name ?? "" }); goto?.("impact"); }}
        className="btn-outline w-full justify-center text-xs">
        <GitCompare size={13} /> Open full Impact Analysis
      </button>
    </div>
  );
}

// ---- Quality tab -------------------------------------------------------------- //
function QualityTabContent({ health }: { health: ReturnType<typeof computeDatasetHealth> }) {
  const STATUS_ICON: Record<string, string> = { pass: "text-emerald-500", warn: "text-amber-500", fail: "text-rose-500" };
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-3 rounded-lg bg-slate-100 p-3 dark:bg-slate-800/60">
        <HealthRing score={health.score} size={48} thickness={6} />
        <div>
          <div className={`text-lg font-bold ${healthTextClass(health.score)}`}>{health.score}/100</div>
          <div className="text-xs text-slate-400">Data-quality health score — derived from profiling &amp; documentation</div>
        </div>
      </div>
      <div className="space-y-1.5">
        {health.checks.map((c) => (
          <div key={c.id} className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-2.5 text-xs dark:border-slate-800">
            <ShieldCheck size={15} className={`mt-0.5 shrink-0 ${STATUS_ICON[c.status]}`} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{c.label}</div>
              <div className="text-slate-400">{c.detail}</div>
            </div>
            <span className={`chip shrink-0 ${STATUS_ICON[c.status]} bg-current/10 uppercase`}>{c.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Properties tab: custom key/value metadata ------------------------------- //
function PropertiesTabContent({ ds, doc }: { ds: Dataset; doc: any }) {
  const { mutate } = useCatalog();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const props: Record<string, string> = doc?.custom_properties ?? {};

  const add = async () => {
    if (!key.trim()) return;
    await mutate((v) => api.setCustomProperty(ds.id, key.trim(), value, v));
    setKey(""); setValue("");
  };
  const del = async (k: string) => { await mutate((v) => api.deleteCustomProperty(ds.id, k, v)); };

  return (
    <div className="space-y-3 p-4">
      {Object.keys(props).length === 0 ? (
        <EmptyState icon={<Settings2 size={36} />} title="No custom properties yet"
          hint="Add arbitrary key/value metadata — e.g. SLA, retention policy, source system." />
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {Object.entries(props).map(([k, v]) => (
              <tr key={k} className="border-t border-slate-100 dark:border-slate-800/60">
                <td className="py-1.5 pr-2 font-mono font-semibold text-slate-500">{k}</td>
                <td className="py-1.5 pr-2">{v}</td>
                <td className="py-1.5 text-right">
                  <button onClick={() => del(k)} className="text-slate-400 hover:text-rose-500"><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex items-end gap-2">
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Key" className="input !py-1.5 text-xs" />
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Value" className="input !py-1.5 text-xs flex-1" />
        <button onClick={add} className="btn-primary !py-1.5 text-xs"><Plus size={13} /> Add</button>
      </div>
    </div>
  );
}

// ---- Auto-document table (preview + apply, protects human-validated cols) - //
function AutoDocModal({ ds, doc, onClose }: { ds: Dataset; doc: any; onClose: () => void }) {
  const { mutate, refresh, toast } = useCatalog();
  const { confirm, dialog } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [sugg, setSugg] = useState<TableSuggestion | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [includeProtected, setIncludeProtected] = useState(false);
  const [applying, setApplying] = useState(false);

  const load = async (force: boolean) => {
    const cached = doc?.llm_table_suggestion;
    if (!force && cached) {
      setSugg(cached); setCachedAt(cached.cached_at); setLoading(false);
      return;
    }
    force ? setRegenerating(true) : setLoading(true);
    try {
      const r = await api.documentTable(ds.id);
      setSugg(r.result); setCachedAt(null);
      await refresh(); // pulls the newly cached result into state.docs
    } catch (e) {
      toast("err", (e as Error).message.includes("503") ? "Local LLM unavailable" : "Documentation failed");
      if (!force) onClose();
    } finally { setLoading(false); setRegenerating(false); }
  };

  useEffect(() => { load(false); }, [ds.id]); // eslint-disable-line

  if (loading || !sugg) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
        <div className="card flex items-center gap-2 p-6 text-sm text-slate-400">
          <Loader2 className="animate-spin" /> {loading ? "Analysing every column…" : "No suggestion available."}
        </div>
      </div>
    );
  }

  const protectedCols = sugg.columns.filter((c) => isProtectedDoc(doc?.columns?.[c.name]));
  const openCols = sugg.columns.filter((c) => !isProtectedDoc(doc?.columns?.[c.name]));
  const toApply = includeProtected ? sugg.columns : openCols;

  const apply = async () => {
    if (includeProtected && protectedCols.length > 0) {
      const ok = await confirm({
        title: "Overwrite human-validated columns?",
        message: `${protectedCols.length} of the columns you're about to apply (${protectedCols.map((c) => c.name).join(", ")}) were already validated by a human. This will permanently replace those definitions.`,
        tone: "danger", steps: 3, confirmLabel: "Overwrite",
      });
      if (!ok) return;
    }
    setApplying(true);
    try {
      const r = await mutate((v) => api.applyTable({
        dataset_id: ds.id, table_definition: sugg.table_definition, domain: sugg.domain,
        columns: toApply,
      }, v));
      if (r) toast("ok", `${ds.name} documented — ${toApply.length} column(s) updated ✓`);
      onClose();
    } finally { setApplying(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center gap-2">
          <Wand2 size={18} className="text-loom-500" />
          <h3 className="font-semibold">Auto-document — {ds.name}</h3>
          <span className="chip bg-loom-500/10 text-loom-500">{sugg.domain}</span>
          {cachedAt && <span className="chip bg-slate-500/10 text-slate-400">cached {timeAgo(cachedAt)} ago</span>}
          <button onClick={() => load(true)} disabled={regenerating} className="btn-ghost ml-auto !p-1 text-loom-500" title="Regenerate">
            {regenerating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          <button onClick={onClose} className="btn-ghost !p-1"><X size={16} /></button>
        </div>
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{sugg.table_definition}</p>

        {protectedCols.length > 0 && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            <ShieldCheck size={13} className="shrink-0" />
            {protectedCols.length} column(s) are human-validated and will be <b>skipped</b> unless you opt in below.
          </div>
        )}

        <div className="max-h-64 space-y-1 overflow-auto rounded-lg border border-slate-200 p-2 dark:border-slate-800">
          {sugg.columns.map((c) => {
            const protectedCol = isProtectedDoc(doc?.columns?.[c.name]);
            const skipped = protectedCol && !includeProtected;
            return (
              <div key={c.name} className={`flex items-start gap-2 text-xs ${skipped ? "opacity-40" : ""}`}>
                <span className="font-mono font-semibold shrink-0">{c.name}</span>
                {protectedCol && <ShieldCheck size={11} className="mt-0.5 shrink-0 text-emerald-500" />}
                {c.sensitivity === "PII" && <Lock size={10} className="mt-0.5 shrink-0 text-rose-400" />}
                <span className="text-slate-500">{c.definition}</span>
                <span className={`ml-auto shrink-0 font-mono ${confidenceColor(c.confidence)}`}>{c.confidence}%</span>
              </div>
            );
          })}
        </div>

        {protectedCols.length > 0 && (
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={includeProtected} onChange={(e) => setIncludeProtected(e.target.checked)} />
            Also overwrite the {protectedCols.length} human-validated column(s)
          </label>
        )}

        <div className="mt-3 flex gap-2">
          <button onClick={apply} disabled={applying || toApply.length === 0}
            className={`flex-1 justify-center text-xs ${
              toApply.some((c) => !!doc?.columns?.[c.name]?.definition) ? "btn-danger" : "btn-ai"}`}>
            {applying ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Apply to {toApply.length} column{toApply.length === 1 ? "" : "s"}
          </button>
          <button onClick={onClose} className="btn-outline text-xs">Cancel</button>
        </div>
      </div>
      {dialog}
    </div>
  );
}

// ---- Column panel --------------------------------------------------------- //
function ColumnPanel({ ds, col, onClose }: { ds: Dataset; col: Column | null; onClose: () => void }) {
  const { state, health, mutate, refresh, toast } = useCatalog();
  const { confirm, dialog } = useConfirm();
  const llmUp = health?.llm.up ?? false;
  const [editing, setEditing] = useState(false);
  const [def, setDef] = useState("");
  const [calc, setCalc] = useState("");
  const [srcFile, setSrcFile] = useState("");
  const [srcField, setSrcField] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSugg, setAiSugg] = useState<ColumnSuggestion | null>(null);

  // switching columns: fall back to a previously cached suggestion, if any
  useEffect(() => {
    setAiSugg(state?.docs[ds.id]?.columns?.[col?.name ?? ""]?.llm_suggestion ?? null);
  }, [col?.name, ds.id]); // eslint-disable-line

  if (!col) {
    return (
      <div className="card hidden items-center justify-center p-6 text-center text-sm text-slate-400 xl:flex">
        <div><Hash className="mx-auto mb-2 opacity-40" /> Select a column<br />to view its fingerprint.</div>
      </div>
    );
  }

  const doc = state?.docs[ds.id]?.columns?.[col.name];
  const p = col.profile;
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

  const cachedSuggestion = doc?.llm_suggestion;

  const runSuggest = async (force = false) => {
    if (!force && cachedSuggestion) { setAiSugg(cachedSuggestion); return; }
    setAiLoading(true); setAiSugg(null);
    try {
      const r = await api.suggestColumn(ds.id, col.name);
      setAiSugg(r.suggestion);
      await refresh(); // pulls the newly cached suggestion into state.docs
    } catch (e) {
      toast("err", (e as Error).message.includes("503") ? "Local LLM unavailable" : "Suggestion failed");
    } finally { setAiLoading(false); }
  };

  const acceptSuggestion = async () => {
    if (!aiSugg) return;
    if (isProtectedDoc(doc)) {
      const ok = await confirm({
        title: "Overwrite a validated definition?",
        message: `"${col.name}" already has a human-validated definition: "${doc?.definition}". The AI suggestion would replace it with: "${aiSugg.definition}".`,
        tone: "danger", steps: 3, confirmLabel: "Overwrite",
      });
      if (!ok) return;
    } else if (doc?.definition) {
      const ok = await confirm({
        title: "Overwrite existing definition?",
        message: `"${col.name}" already has a definition. The AI suggestion will replace it.`,
        tone: "warning", steps: 1, confirmLabel: "Overwrite",
      });
      if (!ok) return;
    }
    await mutate((v) => api.applyColumn({
      dataset_id: ds.id, column: col.name,
      definition: aiSugg.definition, calculation: aiSugg.calculation,
      sensitivity: aiSugg.sensitivity, status: "validated",
    }, v));
    toast("ok", `${col.name} documented ✓`);
    setAiSugg(null);
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
          {aiSugg && (
            <div className="mb-2 rounded-xl border border-loom-500/30 bg-loom-500/5 p-3 animate-fade-in">
              <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-loom-600 dark:text-loom-300">
                <Sparkles size={15} /> AI suggestion
                {(aiSugg as CachedColumnSuggestion).cached_at && (
                  <span className="chip bg-slate-500/10 text-slate-400">
                    cached {timeAgo((aiSugg as CachedColumnSuggestion).cached_at)} ago
                  </span>
                )}
                <span className={`ml-auto chip ${confidenceColor(aiSugg.confidence)} bg-current/10`}>conf. {aiSugg.confidence}%</span>
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-200">{aiSugg.definition}</p>
              {aiSugg.calculation && (
                <div className="mt-1.5 rounded bg-white/60 p-1.5 font-mono text-xs text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">
                  {aiSugg.calculation}
                </div>
              )}
              {aiSugg.evidence.length > 0 && (
                <div className="mt-2 border-t border-loom-500/15 pt-2">
                  <div className="mb-1 text-[10px] font-semibold uppercase text-slate-400">Grounded in</div>
                  <ul className="space-y-0.5">
                    {aiSugg.evidence.map((e, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-500">
                        <Check size={11} className="mt-0.5 shrink-0 text-emerald-500" /> {e}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-2.5 flex gap-2">
                <button onClick={acceptSuggestion}
                  className={`flex-1 justify-center text-xs ${doc?.definition ? "btn-danger" : "btn-ai"}`}>
                  <Check size={13} /> Accept
                </button>
                <button onClick={() => runSuggest(true)} disabled={!llmUp || aiLoading} className="btn-ai-outline text-xs">
                  {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Regenerate
                </button>
                <button onClick={() => setAiSugg(null)} className="btn-outline text-xs">Discard</button>
              </div>
            </div>
          )}
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
                {!aiSugg && (
                  <button onClick={() => runSuggest()} disabled={!llmUp || aiLoading} className="btn-ai-outline text-xs">
                    {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    {cachedSuggestion ? "Show AI suggestion" : "AI suggest"}
                  </button>
                )}
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
      {dialog}
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
  const { confirm, dialog } = useConfirm();
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
    if (synth) {
      const ok = await confirm({
        title: "Overwrite the stored synthesis?",
        message: "This table already has a stored content synthesis. Regenerating will replace it.",
        tone: "warning", steps: 1, confirmLabel: "Regenerate",
      });
      if (!ok) return;
    }
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
        {isMappingLike && <span className="chip bg-flame-500/10 text-flame-400 normal-case">looks like a mapping table</span>}
        <span className="ml-auto">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="space-y-3 px-4 pb-4">
          {/* synthesis */}
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-slate-500">
              <Sparkles size={13} className="text-loom-500" /> Content synthesis
              {doc?.synthesis_source && <span className="chip bg-slate-500/10 text-slate-400">{doc.synthesis_source}</span>}
              <button onClick={generate} disabled={!llmUp || synthLoading}
                className={`ml-auto !py-1 text-xs ${synth ? "btn-danger" : "btn-ai"}`}>
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
          <div className="rounded-lg border border-flame-200 bg-flame-50/30 p-3 dark:border-flame-900/40 dark:bg-flame-950/10">
            <div className="flex items-center gap-2">
              <Workflow size={14} className="text-flame-500" />
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">ETL mapping import</span>
              <button onClick={() => setMapOpen(true)} disabled={!llmUp} className="btn-ai-outline ml-auto !py-1 text-xs">
                <FileInput size={12} /> Analyse as mapping table
              </button>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              If this table holds ETL config (target table/field/definition…), let the LLM read it and build lineage + pre-documentation — merged, never erasing what exists.
            </p>
          </div>
        </div>
      )}

      {mapOpen && <MappingModal ds={ds} doc={doc} onClose={() => setMapOpen(false)} />}
      {dialog}
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

function MappingModal({ ds, doc, onClose }: { ds: Dataset; doc: any; onClose: () => void }) {
  const { mutate, refresh, toast } = useCatalog();
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [cols, setCols] = useState<string[]>([]);
  const [roles, setRoles] = useState<Record<string, string | null>>({});
  const [confidence, setConfidence] = useState(0);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);

  const load = async (force: boolean) => {
    const cached = doc?.llm_mapping_detection;
    if (!force && cached) {
      setCols(cached.columns); setRoles(cached.roles); setConfidence(cached.confidence);
      setCachedAt(cached.cached_at); setLoading(false);
      return;
    }
    force ? setRegenerating(true) : setLoading(true);
    try {
      const r = await api.mappingDetect(ds.id);
      setCols(r.columns); setRoles(r.roles); setConfidence(r.confidence); setCachedAt(null);
      await refresh(); // pulls the newly cached detection into state.docs
    } catch (e) {
      toast("err", (e as Error).message.includes("503") ? "Local LLM unavailable" : "Detection failed");
      if (!force) onClose();
    } finally { setLoading(false); setRegenerating(false); }
  };

  // detect role columns on mount (or reuse the cached detection)
  useEffect(() => { load(false); }, [ds.id]); // eslint-disable-line

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
          <Workflow size={18} className="text-flame-500" />
          <h3 className="font-semibold">ETL mapping — {ds.name}</h3>
          {cachedAt && <span className="chip bg-slate-500/10 text-slate-400">cached {timeAgo(cachedAt)} ago</span>}
          <button onClick={() => load(true)} disabled={regenerating || loading} className="btn-ghost ml-auto !p-1 text-loom-500" title="Regenerate">
            {regenerating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          <button onClick={onClose} className="btn-ghost !p-1"><X size={16} /></button>
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
