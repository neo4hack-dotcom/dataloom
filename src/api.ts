import type { AgentRun, CatalogState, Connection, Health } from "./types";

export class VersionConflict extends Error {
  serverVersion: number;
  constructor(serverVersion: number) {
    super("version_conflict");
    this.serverVersion = serverVersion;
  }
}

async function req<T>(
  path: string,
  opts: RequestInit & { baseVersion?: number } = {}
): Promise<T> {
  const { baseVersion, ...rest } = opts;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(rest.headers as Record<string, string>),
  };
  if (baseVersion !== undefined) headers["X-Base-Version"] = String(baseVersion);
  const res = await fetch(`/api${path}`, { ...rest, headers });
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    throw new VersionConflict(body?.detail?.server_version ?? -1);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${txt}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => req<Health>("/health"),
  state: () => req<CatalogState>("/state"),

  // -- connections --
  addConnection: (
    body: { name: string; type: string; config: Record<string, unknown>; llm_model?: string | null },
    baseVersion: number
  ) => req<{ connection: Connection; version: number }>("/connections", {
    method: "POST", body: JSON.stringify(body), baseVersion,
  }),
  deleteConnection: (id: string, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/connections/${id}`, { method: "DELETE", baseVersion }),

  // -- pipeline --
  launchRun: (connection_id: string, agents: string[] | null, baseVersion: number) =>
    req<{ run: AgentRun; version: number }>("/runs", {
      method: "POST", body: JSON.stringify({ connection_id, agents }), baseVersion,
    }),
  getRun: (id: string) => req<AgentRun>(`/runs/${id}`),

  // -- catalog: tables --
  addDataset: (body: { schema_name: string; name: string; connection_id: string; comment?: string }, baseVersion: number) =>
    req<{ dataset: unknown; version: number }>("/datasets", {
      method: "POST", body: JSON.stringify(body), baseVersion,
    }),
  deleteDataset: (dsId: string, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/datasets/${encodeURIComponent(dsId)}`, { method: "DELETE", baseVersion }),
  updateDatasetMeta: (dsId: string, patch: { definition?: string; domain?: string; comment?: string }, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/datasets/${encodeURIComponent(dsId)}/meta`, {
      method: "PATCH", body: JSON.stringify(patch), baseVersion,
    }),

  // -- catalog: columns --
  addColumn: (dsId: string, col: { name: string; data_type?: string; nullable?: boolean; semantic_type?: string }, baseVersion: number) =>
    req<{ column: unknown; version: number }>(`/datasets/${encodeURIComponent(dsId)}/columns`, {
      method: "POST", body: JSON.stringify(col), baseVersion,
    }),
  deleteColumn: (dsId: string, col: string, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/datasets/${encodeURIComponent(dsId)}/columns/${encodeURIComponent(col)}`, {
      method: "DELETE", baseVersion,
    }),
  editColumnDoc: (
    dsId: string, col: string,
    patch: { definition?: string; calculation?: string | null; status?: string; sensitivity?: string },
    baseVersion: number
  ) => req<{ ok: boolean; version: number }>(
    `/columns/${encodeURIComponent(dsId)}/${encodeURIComponent(col)}/doc`,
    { method: "POST", body: JSON.stringify(patch), baseVersion }
  ),

  // -- relationships --
  setRelStatus: (idx: number, status: string, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/relationships/${idx}/status`, {
      method: "POST", body: JSON.stringify({ status }), baseVersion,
    }),
  addRelationship: (body: {
    child_dataset_id: string; child_column: string;
    parent_dataset_id: string; parent_column: string;
    kind?: string; confidence?: number; reason?: string;
  }, baseVersion: number) =>
    req<{ relationship: unknown; version: number }>("/relationships", {
      method: "POST", body: JSON.stringify(body), baseVersion,
    }),
  deleteRelationship: (idx: number, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/relationships/${idx}`, { method: "DELETE", baseVersion }),
  dismissMatch: (idx: number, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/matches/${idx}`, { method: "DELETE", baseVersion }),

  // -- lineage --
  addLineageEdge: (body: { from_id: string; to_id: string; via?: string; kind?: string; confidence?: number }, baseVersion: number) =>
    req<{ edge: unknown; version: number }>("/lineage", {
      method: "POST", body: JSON.stringify(body), baseVersion,
    }),
  deleteLineageEdge: (idx: number, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/lineage/${idx}`, { method: "DELETE", baseVersion }),

  // -- glossary --
  editGlossary: (term: string, definition: string, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/glossary/${encodeURIComponent(term)}`, {
      method: "POST", body: JSON.stringify({ definition }), baseVersion,
    }),
  addGlossaryTerm: (term: string, definition: string, baseVersion: number) =>
    req<{ term: unknown; version: number }>("/glossary", {
      method: "POST", body: JSON.stringify({ term, definition }), baseVersion,
    }),
  deleteGlossaryTerm: (term: string, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/glossary/${encodeURIComponent(term)}`, { method: "DELETE", baseVersion }),

  // -- notes --
  addNote: (text: string, baseVersion: number) =>
    req<{ note: unknown; version: number }>("/notes", {
      method: "POST", body: JSON.stringify({ text }), baseVersion,
    }),

  // -- QA --
  dismissQA: (idx: number, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/qa/${idx}`, { method: "DELETE", baseVersion }),

  // -- search --
  search: (q: string) =>
    req<{ query: string; hits: any[]; answer: string | null; llm: boolean }>("/search", {
      method: "POST", body: JSON.stringify({ q }),
    }),

  // -- OKF import --
  importOKF: (body: { content?: Record<string, unknown>; url?: string; connection_id?: string }, baseVersion: number) =>
    req<{ ok: boolean; imported: number; connection_id: string; version: number }>("/import/okf", {
      method: "POST", body: JSON.stringify(body), baseVersion,
    }),

  // -- export --
  exportCatalog: (fmt: "markdown" | "json" | "okf") =>
    req<{ content: unknown; filename: string }>(`/export/catalog/${fmt}`),
  exportApp: () =>
    req<{ content: unknown; filename: string }>(`/export/app/json`),
  exportFull: (fmt: "markdown" | "json") =>
    req<{ content: unknown; filename: string }>(`/export/${fmt}`),

  // -- reset --
  resetCatalog: (baseVersion: number) =>
    req<{ ok: boolean; version: number }>("/reset", { method: "POST", baseVersion }),
};
