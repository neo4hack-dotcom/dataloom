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

  addConnection: (
    body: { name: string; type: string; config: Record<string, unknown>; llm_model?: string | null },
    baseVersion: number
  ) => req<{ connection: Connection; version: number }>("/connections", {
    method: "POST", body: JSON.stringify(body), baseVersion,
  }),

  deleteConnection: (id: string, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/connections/${id}`, { method: "DELETE", baseVersion }),

  launchRun: (connection_id: string, agents: string[] | null, baseVersion: number) =>
    req<{ run: AgentRun; version: number }>("/runs", {
      method: "POST", body: JSON.stringify({ connection_id, agents }), baseVersion,
    }),

  getRun: (id: string) => req<AgentRun>(`/runs/${id}`),

  editColumnDoc: (
    dsId: string, col: string,
    patch: { definition?: string; calculation?: string | null; status?: string; sensitivity?: string },
    baseVersion: number
  ) => req<{ ok: boolean; version: number }>(
    `/columns/${encodeURIComponent(dsId)}/${encodeURIComponent(col)}/doc`,
    { method: "POST", body: JSON.stringify(patch), baseVersion }
  ),

  setRelStatus: (idx: number, status: string, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/relationships/${idx}/status`, {
      method: "POST", body: JSON.stringify({ status }), baseVersion,
    }),

  editGlossary: (term: string, definition: string, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/glossary/${encodeURIComponent(term)}`, {
      method: "POST", body: JSON.stringify({ definition }), baseVersion,
    }),

  addNote: (text: string, baseVersion: number) =>
    req<{ note: unknown; version: number }>("/notes", {
      method: "POST", body: JSON.stringify({ text }), baseVersion,
    }),

  search: (q: string) =>
    req<{ query: string; hits: any[]; answer: string | null; llm: boolean }>("/search", {
      method: "POST", body: JSON.stringify({ q }),
    }),

  /** Export the data dictionary only (tables, columns, docs, relationships, lineage, glossary). */
  exportCatalog: (fmt: "markdown" | "json") =>
    req<{ content: unknown; filename: string }>(`/export/catalog/${fmt}`),

  /** Export app configuration only (connections, settings, runs, audit log). */
  exportApp: () =>
    req<{ content: unknown; filename: string }>(`/export/app/json`),

  /** Full export — catalog + app state. */
  exportFull: (fmt: "markdown" | "json") =>
    req<{ content: unknown; filename: string }>(`/export/${fmt}`),
};
