import type {
  AgentRun, CatalogState, Connection, ConnectorSettings, DiscoveredTable, Health,
  LlmConfig, LlmTest, McpConfig, QueryLogEntry, User,
} from "./types";

export class VersionConflict extends Error {
  serverVersion: number;
  constructor(serverVersion: number) {
    super("version_conflict");
    this.serverVersion = serverVersion;
  }
}

export class Unauthorized extends Error {
  constructor() { super("unauthorized"); }
}

const TOKEN_KEY = "dl.authToken";

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
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
  const token = getAuthToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { ...rest, headers });
  if (res.status === 401) throw new Unauthorized();
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

  // -- discovery & scope (big-volume sources) --
  discover: (cid: string, baseVersion: number) =>
    req<{ ok: boolean; count: number; tables: DiscoveredTable[]; version: number }>(
      `/connections/${cid}/discover`, { method: "POST", baseVersion }),
  setScope: (cid: string, tables: string[], baseVersion: number) =>
    req<{ ok: boolean; count: number; version: number }>(
      `/connections/${cid}/scope`, { method: "POST", body: JSON.stringify({ tables }), baseVersion }),

  // -- pipeline --
  launchRun: (connection_id: string, agents: string[] | null, baseVersion: number, tables?: string[] | null) =>
    req<{ run: AgentRun; version: number }>("/runs", {
      method: "POST", body: JSON.stringify({ connection_id, agents, tables }), baseVersion,
    }),
  getRun: (id: string) => req<AgentRun>(`/runs/${id}`),

  // -- catalog: tables --
  addDataset: (body: { schema_name: string; name: string; connection_id: string; comment?: string }, baseVersion: number) =>
    req<{ dataset: unknown; version: number }>("/datasets", {
      method: "POST", body: JSON.stringify(body), baseVersion,
    }),
  deleteDataset: (dsId: string, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/datasets/${encodeURIComponent(dsId)}`, { method: "DELETE", baseVersion }),
  updateDatasetMeta: (dsId: string, patch: {
    definition?: string; domain?: string; comment?: string;
    identity?: Record<string, unknown>; synthesis?: string; partitioning?: Record<string, unknown>;
  }, baseVersion: number) =>
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
    patch: { definition?: string; calculation?: string | null; status?: string; sensitivity?: string;
             source_file?: string; source_field?: string },
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

  // -- LLM configuration (OpenAI-compatible) --
  saveLlmConfig: (
    body: { base_url?: string; api_key?: string; model?: string; temperature?: number; max_tokens?: number },
    baseVersion: number
  ) => req<{ ok: boolean; version: number; config: LlmConfig }>("/llm/config", {
    method: "POST", body: JSON.stringify(body), baseVersion,
  }),
  testLlm: (draft?: { base_url?: string; api_key?: string; model?: string }) =>
    req<{ ok: boolean; result: LlmTest }>("/llm/test", {
      method: "POST", body: JSON.stringify(draft ?? {}),
    }),
  listLlmModels: (draft?: { base_url?: string; api_key?: string }) =>
    req<{ ok: boolean; models: string[] }>("/llm/models", {
      method: "POST", body: JSON.stringify(draft ?? {}),
    }),

  // -- guided exploration (5 local-LLM features) --
  suggestColumn: (dataset_id: string, column: string) =>
    req<{ ok: boolean; suggestion: ColumnSuggestion }>("/llm/suggest-column", {
      method: "POST", body: JSON.stringify({ dataset_id, column }),
    }),
  applyColumn: (body: {
    dataset_id: string; column: string;
    definition?: string; calculation?: string | null; sensitivity?: string; status?: string;
  }, baseVersion: number) =>
    req<{ ok: boolean; version: number }>("/llm/apply-column", {
      method: "POST", body: JSON.stringify(body), baseVersion,
    }),
  documentTable: (dataset_id: string) =>
    req<{ ok: boolean; result: TableSuggestion }>("/llm/document-table", {
      method: "POST", body: JSON.stringify({ dataset_id }),
    }),
  applyTable: (body: {
    dataset_id: string; table_definition?: string; domain?: string;
    columns: { name: string; definition?: string; calculation?: string | null; sensitivity?: string }[];
  }, baseVersion: number) =>
    req<{ ok: boolean; version: number }>("/llm/apply-table", {
      method: "POST", body: JSON.stringify(body), baseVersion,
    }),
  copilot: (question: string, history: { role: string; content: string }[], librarian = false) =>
    req<{ ok: boolean; answer: string; cited: { dataset_id: string; column: string }[] }>("/llm/copilot", {
      method: "POST", body: JSON.stringify({ question, history, librarian }),
    }),
  completionQueue: () =>
    req<{ ok: boolean; items: CompletionItem[] }>("/llm/completion-queue"),
  explainRelationship: (body: {
    child_dataset_id: string; child_column: string;
    parent_dataset_id: string; parent_column: string;
  }) =>
    req<{ ok: boolean; explanation: RelExplanation }>("/llm/explain-relationship", {
      method: "POST", body: JSON.stringify(body),
    }),

  // -- table identity card + content synthesis (cached) --
  synthesizeTable: (dataset_id: string, baseVersion: number) =>
    req<{ ok: boolean; result: TableSynthesis; version: number }>("/llm/synthesize-table", {
      method: "POST", body: JSON.stringify({ dataset_id }), baseVersion,
    }),

  // -- ETL mapping import --
  mappingDetect: (dataset_id: string) =>
    req<{ ok: boolean; roles: Record<string, string | null>; confidence: number; reason: string;
          columns: string[]; sample: Record<string, unknown>[] }>("/mapping/detect", {
      method: "POST", body: JSON.stringify({ dataset_id }),
    }),
  mappingApply: (dataset_id: string, roles: Record<string, string | null>, baseVersion: number) =>
    req<{ ok: boolean; edges_added: number; docs_added: number; rows_scanned: number; version: number }>(
      "/mapping/apply", { method: "POST", body: JSON.stringify({ dataset_id, roles }), baseVersion }),

  // -- full backup restore --
  importBackup: (backup: unknown, mode: "replace" | "merge", baseVersion: number) =>
    req<{ ok: boolean; mode: string; summary: Record<string, number>; version: number }>(
      "/import/backup", { method: "POST", body: JSON.stringify({ backup, mode }), baseVersion }),

  // -- auth --
  authStatus: () => req<{ bootstrap_needed: boolean }>("/auth/status"),
  bootstrap: (username: string, password: string) =>
    req<{ token: string; user: User }>("/auth/bootstrap", {
      method: "POST", body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    req<{ token: string; user: User }>("/auth/login", {
      method: "POST", body: JSON.stringify({ username, password }),
    }),
  logout: () => req<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  requestAdminReset: () => req<{ ok: boolean; message: string }>("/auth/request-reset", { method: "POST" }),
  confirmAdminReset: (code: string, username: string, password: string) =>
    req<{ token: string; user: User }>("/auth/confirm-reset", {
      method: "POST", body: JSON.stringify({ code, username, password }),
    }),
  me: () => req<{ user: User }>("/auth/me"),

  // -- users (admin) --
  listUsers: () => req<{ users: User[] }>("/users"),
  createUser: (body: { username: string; password: string; role: "admin" | "member" }) =>
    req<{ user: User }>("/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id: string, patch: { role?: "admin" | "member"; active?: boolean; password?: string }) =>
    req<{ user: User }>(`/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteUser: (id: string) =>
    req<{ ok: boolean }>(`/users/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // -- query log --
  listQueries: () => req<{ active: QueryLogEntry[]; recent: QueryLogEntry[] }>("/queries"),
  cancelQuery: (id: string) => req<{ ok: boolean }>(`/queries/${encodeURIComponent(id)}/cancel`, { method: "POST" }),

  // -- connector settings (admin) --
  updateConnectorSettings: (body: ConnectorSettings, baseVersion: number) =>
    req<{ ok: boolean; config: ConnectorSettings; version: number }>("/settings/connectors", {
      method: "POST", body: JSON.stringify(body), baseVersion,
    }),

  // -- MCP admin --
  getMcpConfig: () => req<{ config: McpConfig }>("/mcp/config"),
  updateMcpConfig: (
    patch: { enabled?: boolean; tools?: Record<string, boolean>; exposure?: Partial<McpConfig["exposure"]> },
    baseVersion: number
  ) => req<{ ok: boolean; config: McpConfig; version: number }>("/mcp/config", {
    method: "POST", body: JSON.stringify(patch), baseVersion,
  }),
  rotateMcpToken: (baseVersion: number) =>
    req<{ token: string; prefix: string; version: number }>("/mcp/token", { method: "POST", baseVersion }),
  revokeMcpToken: (baseVersion: number) =>
    req<{ ok: boolean; version: number }>("/mcp/token", { method: "DELETE", baseVersion }),
};

export interface ColumnSuggestion {
  definition: string;
  calculation: string | null;
  semantic_type: string;
  sensitivity: string;
  confidence: number;
  evidence: string[];
}

export interface TableSuggestion {
  table_definition: string;
  domain: string;
  columns: { name: string; definition: string; calculation: string | null; sensitivity: string; confidence: number }[];
}

export interface TableSynthesis {
  synthesis: string;
  content: string;
  data_kind: string;
  products: string[];
  key_fields: string[];
  suggested_partition: string | null;
}

export interface CompletionItem {
  kind: string;
  dataset_id: string;
  column: string | null;
  label: string;
  reasons?: string[];
  action: string;
  impact: number;
  match_index?: number;
}

export interface RelExplanation {
  meaning: string;
  cardinality: string;
  confidence: number;
  caveats: string[];
}
