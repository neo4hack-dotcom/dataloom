import { useMemo, useState } from "react";
import {
  Sparkles, Wand2, IdCard, Workflow, GitCompare, Plug, Loader2, Play,
  CheckCircle2, Circle, ChevronDown, ChevronUp, ListChecks,
} from "lucide-react";
import { useCatalog } from "../store";
import { api } from "../api";
import { EmptyState, shortDs, timeAgo } from "../lib/ui";
import type { Connection, McpMappingTable } from "../types";

interface EnrichItem {
  id: string;
  label: string;
  sub: string;
  done: boolean;
  doneAt?: number;
  /** absent = this item has no further action available from here (e.g. an MCP source already mapped) */
  run?: (version: number) => Promise<{ version?: number }>;
}

interface EnrichCategory {
  id: string;
  title: string;
  menu: string;
  icon: typeof Sparkles;
  description: string;
  items: EnrichItem[];
}

const MAPPING_LIKE = /map|config|etl|ref_/i;

function mappingTables(conn: Connection): McpMappingTable[] {
  return (conn.config?.mcp_mapping as { tables?: McpMappingTable[] } | undefined)?.tables ?? [];
}

function useCategories(): EnrichCategory[] {
  const { state } = useCatalog();
  return useMemo(() => {
    if (!state) return [];
    const datasets = state.datasets;

    const autoDoc: EnrichCategory = {
      id: "auto-doc", title: "Auto-document tables", menu: "Catalog", icon: Wand2,
      description: "One LLM call per table drafts a definition for every column at once — reviewed and applied from each table's Identity Card.",
      items: datasets.map((d) => {
        const doc = state.docs[d.id];
        return {
          id: `doc:${d.id}`, label: `${d.schema}.${d.name}`, sub: `${d.columns.length} column(s)`,
          done: !!doc?.llm_table_suggestion,
          doneAt: doc?.llm_table_suggestion?.cached_at,
          run: async () => { await api.documentTable(d.id); return {}; },
        };
      }),
    };

    const synth: EnrichCategory = {
      id: "synthesis", title: "Identity card & synthesis", menu: "Catalog", icon: IdCard,
      description: "Generates each table's reusable identity card (data kind, grain, products, key fields) and a plain-English content synthesis.",
      items: datasets.map((d) => {
        const doc = state.docs[d.id];
        return {
          id: `synth:${d.id}`, label: `${d.schema}.${d.name}`,
          sub: doc?.synthesis ? "Synthesis stored" : "No synthesis yet",
          done: doc?.synthesis_source === "llm",
          doneAt: doc?.synthesis_at,
          run: async (version) => {
            const r = await api.synthesizeTable(d.id, version);
            return { version: r.version };
          },
        };
      }),
    };

    const mapDet: EnrichCategory = {
      id: "mapping-detect", title: "ETL mapping detection", menu: "Catalog", icon: Workflow,
      description: "For tables that look like ETL config/mapping sheets, the LLM identifies which column plays which role (target/source table & field).",
      items: datasets.filter((d) => MAPPING_LIKE.test(d.name)).map((d) => {
        const doc = state.docs[d.id];
        return {
          id: `mapdet:${d.id}`, label: `${d.schema}.${d.name}`, sub: "Looks like a mapping/config table",
          done: !!doc?.llm_mapping_detection,
          doneAt: doc?.llm_mapping_detection?.cached_at,
          run: async () => { await api.mappingDetect(d.id); return {}; },
        };
      }),
    };

    const rels: EnrichCategory = {
      id: "relationships", title: "Explain relationships", menu: "Relationships", icon: GitCompare,
      description: "Plain-business meaning and cardinality for every inferred or manual PK→FK link.",
      items: state.relationships.map((r, idx) => ({
        id: `rel:${idx}`,
        label: `${shortDs(r.child.dataset_id)}.${r.child.column} → ${shortDs(r.parent.dataset_id)}.${r.parent.column}`,
        sub: `${r.kind} · ${Math.round(r.confidence)}% confidence`,
        done: !!r.explanation,
        doneAt: r.explanation?.cached_at,
        run: async () => {
          await api.explainRelationship({
            child_dataset_id: r.child.dataset_id, child_column: r.child.column,
            parent_dataset_id: r.parent.dataset_id, parent_column: r.parent.column,
          });
          return {};
        },
      })),
    };

    const mcp: EnrichCategory = {
      id: "mcp", title: "Map MCP sources with AI", menu: "Connections", icon: Plug,
      description: "Discovers an MCP server's tools and proposes a table/column mapping, applying every proposed table in one pass.",
      items: state.connections.filter((c) => c.type === "mcp").map((c) => {
        const mapped = mappingTables(c).length;
        const done = mapped > 0;
        return {
          id: `mcpmap:${c.id}`, label: c.name,
          sub: done ? `${mapped} table(s) mapped` : "No tables mapped yet",
          done,
          run: done ? undefined : async (version) => {
            const disc = await api.mcpDiscoverMapping(c.id);
            const r = await api.mcpApplyMapping(c.id, disc.mapping.tables, version);
            return { version: r.version };
          },
        };
      }),
    };

    return [autoDoc, synth, mapDet, rels, mcp].filter((c) => c.items.length > 0);
  }, [state]);
}

export function Enrichment() {
  const { state, health, refresh, toast, canWrite } = useCatalog();
  const categories = useCategories();
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [log, setLog] = useState<{ text: string; ok: boolean; ts: number }[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [logOpen, setLogOpen] = useState(false);

  const llmUp = health?.llm.up ?? false;
  const canRun = llmUp && canWrite && !batchRunning;

  const pushLog = (text: string, ok: boolean) =>
    setLog((l) => [{ text, ok, ts: Date.now() }, ...l].slice(0, 300));

  const runOne = async (item: EnrichItem, versionRef: { v: number }) => {
    if (!item.run) return;
    setRunning((s) => new Set(s).add(item.id));
    try {
      const r = await item.run(versionRef.v);
      if (r.version !== undefined) versionRef.v = r.version;
      pushLog(`✓ ${item.label}`, true);
    } catch (e) {
      pushLog(`✗ ${item.label} — ${(e as Error).message}`, false);
    } finally {
      setRunning((s) => { const n = new Set(s); n.delete(item.id); return n; });
    }
  };

  const runQueue = async (items: EnrichItem[]) => {
    if (!state || items.length === 0 || batchRunning) return;
    setBatchRunning(true);
    setLogOpen(true);
    const versionRef = { v: state.version };
    setProgress({ done: 0, total: items.length });
    for (let i = 0; i < items.length; i++) {
      await runOne(items[i], versionRef);
      setProgress({ done: i + 1, total: items.length });
      await refresh();
    }
    setBatchRunning(false);
    setProgress(null);
    toast("ok", `Batch enrichment complete — ${items.length} item(s) processed`);
  };

  const runSingle = async (item: EnrichItem) => {
    if (!state || !item.run) return;
    const versionRef = { v: state.version };
    await runOne(item, versionRef);
    await refresh();
  };

  const toggleCollapse = (id: string) => setCollapsed((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const allPending = categories.flatMap((c) => c.items.filter((i) => !i.done && i.run));
  const totalItems = categories.reduce((s, c) => s + c.items.length, 0);
  const totalDone = categories.reduce((s, c) => s + c.items.filter((i) => i.done).length, 0);

  if (categories.length === 0) {
    return <EmptyState icon={<Sparkles size={48} />} title="Nothing to enrich yet"
      hint="Connect a source and run the pipeline first — tables, relationships and MCP sources will show up here." />;
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-loom-500/10 text-loom-500">
            <Sparkles size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">AI Enrichment Center</div>
            <div className="text-xs text-slate-400">
              Every local-LLM enrichment across the catalog, grouped by menu — launch them all sequentially without opening each item.
            </div>
          </div>
          <button onClick={() => runQueue(allPending)} disabled={!canRun || allPending.length === 0}
            className="btn-ai justify-center">
            {batchRunning ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            Run all pending ({allPending.length})
          </button>
        </div>
        {!llmUp && (
          <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            Local LLM is offline — enrichment actions are disabled until it's back.
          </div>
        )}
        {!canWrite && (
          <div className="mt-3 rounded-lg bg-slate-500/10 px-3 py-2 text-xs text-slate-500">
            Your account has read-only access — ask an admin for edit rights to run enrichment.
          </div>
        )}
        {progress && (
          <div className="mt-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div className="h-full bg-loom-500 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
            <div className="mt-1 text-[11px] text-slate-400">{progress.done} / {progress.total} processed…</div>
          </div>
        )}
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="h-2 w-2 rounded-full bg-loom-500" /> not yet enriched
          <span className="ml-3 h-2 w-2 rounded-full bg-flame-500" /> already enriched
          <span className="ml-auto">{totalDone} / {totalItems} enriched overall</span>
        </div>
      </div>

      {categories.map((cat) => {
        const Icon = cat.icon;
        const pending = cat.items.filter((i) => !i.done && i.run);
        const isCollapsed = collapsed.has(cat.id);
        return (
          <div key={cat.id} className="card overflow-hidden">
            <div className="flex items-center gap-3 p-4">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800">
                <Icon size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{cat.title}</span>
                  <span className="chip bg-slate-500/10 text-slate-400">{cat.menu}</span>
                  <span className="text-xs text-slate-400">{cat.items.length - pending.length} / {cat.items.length} done</span>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">{cat.description}</p>
              </div>
              <button onClick={() => runQueue(pending)} disabled={!canRun || pending.length === 0}
                className="btn-ai-outline shrink-0 !py-1 text-xs">
                <Play size={12} /> Run pending ({pending.length})
              </button>
              <button onClick={() => toggleCollapse(cat.id)} className="btn-ghost shrink-0 !p-1.5">
                {isCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
              </button>
            </div>
            {!isCollapsed && (
              <div className="max-h-64 overflow-y-auto border-t border-slate-100 dark:border-slate-800/60">
                {cat.items.map((item) => {
                  const isRunning = running.has(item.id);
                  return (
                    <div key={item.id} className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-2 text-xs last:border-0 dark:border-slate-800/60">
                      {item.done ? (
                        <CheckCircle2 size={13} className="shrink-0 text-flame-500" />
                      ) : (
                        <Circle size={13} className="shrink-0 text-loom-500" />
                      )}
                      <span className="min-w-0 flex-1 truncate font-mono">{item.label}</span>
                      <span className="hidden shrink-0 text-slate-400 sm:inline">{item.sub}</span>
                      {item.doneAt && <span className="hidden shrink-0 text-slate-400 md:inline">{timeAgo(item.doneAt)} ago</span>}
                      <span className={`chip shrink-0 ${item.done ? "bg-flame-500/10 text-flame-500" : "bg-loom-500/10 text-loom-500"}`}>
                        {item.done ? "enriched" : "pending"}
                      </span>
                      {item.run && (
                        <button onClick={() => runSingle(item)} disabled={!canRun || isRunning}
                          className="btn-ghost shrink-0 !p-1 text-loom-500" title={item.done ? "Re-run" : "Run"}>
                          {isRunning ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <div className="card overflow-hidden">
        <button onClick={() => setLogOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/40">
          <ListChecks size={13} /> Run log {log.length > 0 && <span className="chip bg-slate-500/10 text-slate-400 normal-case">{log.length}</span>}
          <span className="ml-auto">{logOpen ? "−" : "+"}</span>
        </button>
        {logOpen && (
          <div className="max-h-56 overflow-y-auto border-t border-slate-100 px-4 py-2 dark:border-slate-800/60">
            {log.length === 0 ? (
              <div className="py-3 text-center text-xs text-slate-400">Nothing run yet this session.</div>
            ) : log.map((l, i) => (
              <div key={i} className={`py-1 font-mono text-[11px] ${l.ok ? "text-slate-500" : "text-rose-500"}`}>{l.text}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
