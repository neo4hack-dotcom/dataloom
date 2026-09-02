import { useEffect, useMemo, useState } from "react";
import {
  Bot, Check, Copy, Database, EyeOff, KeyRound, Loader2, Plug, RotateCcw,
  Search, ShieldAlert, Table2, Trash2, X,
} from "lucide-react";
import { api } from "../../api";
import { useCatalog, useScopedDatasets } from "../../store";
import type { McpConfig } from "../../types";

const TOOL_META: { id: string; label: string; desc: string; liveData?: boolean }[] = [
  { id: "list_datasets", label: "list_datasets", desc: "List every exposed dataset (schema, domain, definition, row estimate)." },
  { id: "get_dataset_schema", label: "get_dataset_schema", desc: "Column list, types, semantic types and definitions for one dataset." },
  { id: "search_catalog", label: "search_catalog", desc: "Full-text search across dataset and column names / definitions." },
  { id: "get_column_definition", label: "get_column_definition", desc: "Business definition, calculation method and sensitivity of one column." },
  { id: "get_lineage", label: "get_lineage", desc: "Inbound/outbound lineage edges for a dataset." },
  { id: "get_glossary_term", label: "get_glossary_term", desc: "Look up a business glossary term." },
  { id: "sample_dataset_rows", label: "sample_dataset_rows", desc: "Fetch a small, row-limited sample of real rows from the source.", liveData: true },
  { id: "list_mcp_sources", label: "list_mcp_sources", desc: "List every other MCP server referenced in this catalog's MCP Library, with coverage counts." },
  { id: "get_mcp_source_tools", label: "get_mcp_source_tools", desc: "Full tool inventory of one referenced MCP source, flagging what's mapped/documented." },
  { id: "get_mcp_query_definition", label: "get_mcp_query_definition", desc: "The actual SQL/code + LLM-extracted logic behind one referenced MCP tool." },
];

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-loom-500" : "bg-slate-300 dark:bg-slate-700"}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
        checked ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}

export function McpSettings() {
  const { state, toast } = useCatalog();
  const datasets = useScopedDatasets();
  const [cfg, setCfg] = useState<McpConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const baseVersion = state?.version ?? 0;

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.getMcpConfig();
      setCfg(r.config);
    } catch (e) { toast("err", (e as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  const patch = async (body: Parameters<typeof api.updateMcpConfig>[0]) => {
    try {
      const r = await api.updateMcpConfig(body, baseVersion);
      setCfg(r.config);
    } catch (e) { toast("err", (e as Error).message); }
  };

  const rotateToken = async () => {
    setBusy(true);
    try {
      const r = await api.rotateMcpToken(baseVersion);
      setNewToken(r.token);
      await load();
      toast("ok", "New MCP token generated");
    } catch (e) { toast("err", (e as Error).message); }
    finally { setBusy(false); }
  };

  const revokeToken = async () => {
    setBusy(true);
    try {
      await api.revokeMcpToken(baseVersion);
      await load();
      toast("ok", "Token revoked");
    } catch (e) { toast("err", (e as Error).message); }
    finally { setBusy(false); }
  };

  const deniedDatasets = new Set(cfg?.exposure.denied_datasets ?? []);
  const deniedColumns = cfg?.exposure.denied_columns ?? [];
  const isColDenied = (dsId: string, col: string) =>
    deniedColumns.some((d) => d.dataset_id === dsId && d.column === col);

  const toggleDataset = (dsId: string) => {
    if (!cfg) return;
    const next = deniedDatasets.has(dsId)
      ? [...deniedDatasets].filter((x) => x !== dsId)
      : [...deniedDatasets, dsId];
    patch({ exposure: { denied_datasets: next } });
  };

  const toggleColumn = (dsId: string, col: string) => {
    if (!cfg) return;
    const next = isColDenied(dsId, col)
      ? deniedColumns.filter((d) => !(d.dataset_id === dsId && d.column === col))
      : [...deniedColumns, { dataset_id: dsId, column: col }];
    patch({ exposure: { denied_columns: next } });
  };

  const filteredDatasets = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return datasets;
    return datasets.filter((d) => `${d.schema}.${d.name}`.toLowerCase().includes(term));
  }, [datasets, q]);

  const endpointUrl = `${window.location.protocol}//${window.location.hostname}:3001/mcp/`;

  if (loading || !cfg) return <div className="card p-6 text-sm text-slate-400">Loading…</div>;

  return (
    <div className="space-y-6">
      {/* master toggle + endpoint */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Plug size={18} className={cfg.enabled ? "text-emerald-500" : "text-slate-400"} />
            <div>
              <div className="text-sm font-semibold">MCP server</div>
              <div className="text-xs text-slate-400">Expose the catalog to AI agents over Streamable HTTP.</div>
            </div>
          </div>
          <Toggle checked={cfg.enabled} onChange={(v) => patch({ enabled: v })} />
        </div>
        {cfg.enabled && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs dark:bg-slate-800/60">
            <span className="min-w-0 flex-1 truncate">{endpointUrl}</span>
            <button className="btn-ghost !p-1" onClick={() => { navigator.clipboard.writeText(endpointUrl); toast("ok", "Copied"); }}>
              <Copy size={13} />
            </button>
          </div>
        )}
      </div>

      {/* token */}
      <div className="card p-4">
        <div className="mb-3 flex items-center gap-2.5">
          <KeyRound size={17} className="text-loom-500" />
          <div className="text-sm font-semibold">API token</div>
        </div>
        {newToken ? (
          <div className="space-y-2">
            <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
              Copy this token now — it won't be shown again.
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs dark:bg-slate-800/60">
              <span className="min-w-0 flex-1 truncate">{newToken}</span>
              <button className="btn-ghost !p-1" onClick={() => { navigator.clipboard.writeText(newToken); toast("ok", "Copied"); }}>
                <Copy size={13} />
              </button>
              <button className="btn-ghost !p-1" onClick={() => setNewToken(null)}><X size={13} /></button>
            </div>
          </div>
        ) : cfg.api_token_set ? (
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-slate-500">{cfg.api_token_prefix}••••••••••••••••••••••••</span>
            <div className="flex gap-2">
              <button className="btn-outline text-xs" disabled={busy} onClick={rotateToken}>
                <RotateCcw size={13} /> Rotate
              </button>
              <button className="btn-outline text-xs text-rose-500" disabled={busy} onClick={revokeToken}>
                <Trash2 size={13} /> Revoke
              </button>
            </div>
          </div>
        ) : (
          <button className="btn-primary text-xs" disabled={busy} onClick={rotateToken}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />} Generate token
          </button>
        )}
      </div>

      {/* tools */}
      <div className="card p-4">
        <div className="mb-3 flex items-center gap-2.5">
          <Bot size={17} className="text-loom-500" />
          <div className="text-sm font-semibold">Tools</div>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
          {TOOL_META.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2.5">
              <Toggle checked={!!cfg.tools[t.id]} onChange={(v) => patch({ tools: { [t.id]: v } })} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold">{t.label}</span>
                  {t.liveData && (
                    <span className="chip bg-amber-500/10 text-amber-500">
                      <Database size={10} /> live data
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-400">{t.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* exposure / data points */}
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShieldAlert size={17} className="text-loom-500" />
            <div className="text-sm font-semibold">Data exposure</div>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <Toggle checked={cfg.exposure.hide_pii} onChange={(v) => patch({ exposure: { hide_pii: v } })} />
            Hide PII columns automatically
          </label>
        </div>

        <div className="relative mb-2">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" />
          <input className="input pl-8" placeholder="Filter datasets…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          {filteredDatasets.map((d) => {
            const denied = deniedDatasets.has(d.id);
            const isOpen = expanded === d.id;
            return (
              <div key={d.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                <div className="flex items-center gap-2.5 px-3 py-2 text-sm">
                  <button onClick={() => toggleDataset(d.id)}
                    className={`chip cursor-pointer ${denied ? "bg-rose-500/10 text-rose-500" : "bg-emerald-500/10 text-emerald-500"}`}>
                    {denied ? <EyeOff size={11} /> : <Check size={11} />} {denied ? "Hidden" : "Exposed"}
                  </button>
                  <Table2 size={13} className="shrink-0 text-slate-400" />
                  <button className="min-w-0 flex-1 truncate text-left font-mono text-xs"
                    onClick={() => setExpanded(isOpen ? null : d.id)}>
                    {d.schema}.{d.name}
                  </button>
                  <span className="text-[11px] text-slate-400">{d.columns.length} cols</span>
                </div>
                {isOpen && !denied && (
                  <div className="space-y-1 bg-slate-50 px-3 py-2 dark:bg-slate-900/40">
                    {d.columns.map((c) => {
                      const colDenied = isColDenied(d.id, c.name) ||
                        (cfg.exposure.hide_pii && c.profile.sensitivity === "PII");
                      const forced = cfg.exposure.hide_pii && c.profile.sensitivity === "PII" && !isColDenied(d.id, c.name);
                      return (
                        <label key={c.name} className="flex items-center gap-2 text-xs">
                          <input type="checkbox" checked={!colDenied} disabled={forced}
                            onChange={() => toggleColumn(d.id, c.name)} />
                          <span className="font-mono">{c.name}</span>
                          {c.profile.sensitivity === "PII" && <span className="chip bg-rose-500/10 text-rose-500">PII</span>}
                          {forced && <span className="text-slate-400">(hidden by PII rule)</span>}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {filteredDatasets.length === 0 && (
            <div className="p-4 text-center text-xs text-slate-400">No dataset matches.</div>
          )}
        </div>
      </div>
    </div>
  );
}
