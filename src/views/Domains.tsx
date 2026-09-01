import { useMemo, useState } from "react";
import { Globe2, Plus, ChevronRight, Table2, Trash2, Check, X } from "lucide-react";
import { useCatalog, useScopedDatasets } from "../store";
import { api } from "../api";
import { EmptyState, nameColor } from "../lib/ui";
import type { Domain } from "../types";
import type { Tab } from "../App";

interface Node extends Domain { children: Node[] }

function buildTree(domains: Domain[]): Node[] {
  const nodes = new Map<string, Node>(domains.map((d) => [d.id, { ...d, children: [] }]));
  const roots: Node[] = [];
  for (const n of nodes.values()) {
    if (n.parent_id && nodes.has(n.parent_id)) nodes.get(n.parent_id)!.children.push(n);
    else roots.push(n);
  }
  return roots;
}

function descendantIds(node: Node): string[] {
  return [node.id, ...node.children.flatMap(descendantIds)];
}

export function Domains({ goto }: { goto: (t: Tab) => void }) {
  const { state, mutate, setFocusDataset, toast } = useCatalog();
  const datasets = useScopedDatasets();
  const [selected, setSelected] = useState<string | null>(null);
  const [addingUnder, setAddingUnder] = useState<string | null | undefined>(undefined);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const domains = state?.domains ?? [];
  const tree = useMemo(() => buildTree(domains), [domains]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of datasets) {
      const id = state?.docs[d.id]?.domain_id;
      if (id) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [datasets, state?.docs]);

  const countIncludingChildren = (node: Node): number =>
    descendantIds(node).reduce((s, id) => s + (counts.get(id) ?? 0), 0);

  const addDomain = async () => {
    if (!newName.trim()) return;
    await mutate((v) => api.addDomain({ name: newName.trim(), parent_id: addingUnder ?? null, description: newDesc }, v));
    toast("ok", `Domain "${newName}" created`);
    setNewName(""); setNewDesc(""); setAddingUnder(undefined);
  };

  const deleteDomain = async (id: string) => {
    if (!confirm("Delete this domain? (must have no sub-domains)")) return;
    try { await mutate((v) => api.deleteDomain(id, v)); toast("ok", "Domain deleted"); }
    catch (e) { toast("err", (e as Error).message); }
  };

  const selectedNode = useMemo(() => {
    const find = (nodes: Node[]): Node | null => {
      for (const n of nodes) { if (n.id === selected) return n; const r = find(n.children); if (r) return r; }
      return null;
    };
    return find(tree);
  }, [tree, selected]);

  const assignedDatasets = useMemo(() => {
    if (!selectedNode) return [];
    const ids = new Set(descendantIds(selectedNode));
    return datasets.filter((d) => ids.has(state?.docs[d.id]?.domain_id ?? ""));
  }, [selectedNode, datasets, state?.docs]);

  const renderNode = (node: Node, depth: number) => (
    <div key={node.id}>
      <div className={`group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm ${
        selected === node.id ? "bg-loom-500/10 text-loom-600 dark:text-loom-300" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
        style={{ paddingLeft: 8 + depth * 16 }}>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: nameColor(node.name).solid }} />
        <button onClick={() => setSelected(node.id)} className="min-w-0 flex-1 truncate text-left">{node.name}</button>
        <span className="chip bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300">{countIncludingChildren(node)}</span>
        <button onClick={() => setAddingUnder(node.id)} title="Add sub-domain"
          className="shrink-0 text-slate-400 opacity-0 hover:text-loom-500 group-hover:opacity-100"><Plus size={13} /></button>
        <button onClick={() => deleteDomain(node.id)} title="Delete"
          className="shrink-0 text-slate-400 opacity-0 hover:text-rose-500 group-hover:opacity-100"><Trash2 size={12} /></button>
      </div>
      {node.children.map((c) => renderNode(c, depth + 1))}
    </div>
  );

  return (
    <div className="grid h-[calc(100vh-9rem)] gap-4 lg:grid-cols-[300px_1fr]">
      <div className="card flex flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Domains</span>
          <button onClick={() => setAddingUnder(null)} className="btn-ghost !p-1 text-loom-500"><Plus size={14} /></button>
        </div>
        <div className="flex-1 overflow-auto p-1.5">
          {tree.length === 0 && addingUnder === undefined ? (
            <EmptyState icon={<Globe2 size={36} />} title="No domains yet"
              hint="Group your tables into a business hierarchy — e.g. Sales > EMEA." />
          ) : tree.map((n) => renderNode(n, 0))}
        </div>
        {addingUnder !== undefined && (
          <div className="space-y-1.5 border-t border-slate-200 p-2.5 dark:border-slate-800">
            <div className="text-[10px] uppercase text-slate-400">
              {addingUnder ? `Sub-domain of ${domains.find((d) => d.id === addingUnder)?.name}` : "New top-level domain"}
            </div>
            <input className="input !py-1 text-xs" placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
            <input className="input !py-1 text-xs" placeholder="Description (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            <div className="flex gap-1.5">
              <button onClick={addDomain} className="btn-primary !py-1 flex-1 justify-center text-xs"><Check size={12} /> Create</button>
              <button onClick={() => setAddingUnder(undefined)} className="btn-outline !py-1 text-xs"><X size={12} /></button>
            </div>
          </div>
        )}
      </div>

      <div className="card flex flex-col overflow-hidden">
        {!selectedNode ? (
          <EmptyState icon={<ChevronRight size={36} />} title="Pick a domain" hint="Select a domain on the left to see its assigned tables." />
        ) : (
          <>
            <div className="border-b border-slate-200 p-4 dark:border-slate-800">
              <h3 className="text-lg font-bold">{selectedNode.name}</h3>
              {selectedNode.description && <p className="mt-0.5 text-sm text-slate-500">{selectedNode.description}</p>}
              <div className="mt-1 text-xs text-slate-400">{assignedDatasets.length} table(s) (including sub-domains)</div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {assignedDatasets.length === 0 ? (
                <EmptyState icon={<Table2 size={32} />} title="No tables assigned"
                  hint="Assign tables to this domain from the Catalog view's Overview tab." />
              ) : (
                <div className="space-y-1">
                  {assignedDatasets.map((d) => (
                    <button key={d.id} onClick={() => { setFocusDataset({ dsId: d.id }); goto("catalog"); }}
                      className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-loom-500/40 hover:bg-loom-500/5 dark:border-slate-800">
                      <Table2 size={14} className="text-slate-400" />
                      <span className="font-mono">{d.schema}.{d.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
