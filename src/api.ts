import type {
  AgentRun, AlertSettings, CatalogState, ColumnLineageEdge, Connection, ConnectorSettings, DatamartInfo, DiscoveredTable,
  Domain, Health, LlmConfig, LlmTest, McpConfig, McpCoverageGap, McpMappingTable, McpQueryDef, McpTool, Notification, Owner,
  QualityRun, QualityThresholds, QueryLogEntry, Role, SearchHit, User,
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
  updateConnection: (
    id: string,
    patch: { name?: string; config?: Record<string, unknown>; llm_model?: string | null },
    baseVersion: number
  ) => req<{ connection: Connection; version: number }>(`/connections/${id}`, {
    method: "PATCH", body: JSON.stringify(patch), baseVersion,
  }),
  pingConnection: (id: string) => req<{ ok: boolean }>(`/connections/${id}/ping`, { method: "POST" }),

  // -- MCP source: discover tools + LLM-assisted table/column mapping --
  mcpDiscoverMapping: (cid: string) =>
    req<{ ok: boolean; tool_count: number; tools: McpTool[]; mapping: { tables: McpMappingTable[] } }>(
      `/connections/${cid}/mcp/discover-mapping`, { method: "POST" }),
  mcpApplyMapping: (cid: string, tables: McpMappingTable[], baseVersion: number) =>
    req<{ ok: boolean; connection: Connection; version: number }>(
      `/connections/${cid}/mcp/mapping`, { method: "POST", body: JSON.stringify({ tables }), baseVersion }),

  // -- MCP Library: full tool inventory + pasted code/SQL extraction --
  mcpRefreshTools: (cid: string, baseVersion: number) =>
    req<{ ok: boolean; tools: McpTool[]; version: number }>(
      `/connections/${cid}/mcp/tools`, { method: "POST", baseVersion }),
  mcpCoverage: (cid: string) =>
    req<{ ok: boolean; gaps: McpCoverageGap[] }>(`/connections/${cid}/mcp/coverage`),
  mcpAddQuery: (cid: string, body: { tool: string; title?: string; language: "sql" | "code"; code: string }, baseVersion: number) =>
    req<{ ok: boolean; query: McpQueryDef; version: number }>(
      `/connections/${cid}/mcp/queries`, { method: "POST", body: JSON.stringify(body), baseVersion }),
  mcpReextractQuery: (cid: string, qid: string, baseVersion: number) =>
    req<{ ok: boolean; query: McpQueryDef; version: number }>(
      `/connections/${cid}/mcp/queries/${qid}/reextract`, { method: "POST", baseVersion }),
  mcpDeleteQuery: (cid: string, qid: string, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(
      `/connections/${cid}/mcp/queries/${qid}`, { method: "DELETE", baseVersion }),

  // -- discovery & scope (big-volume sources) --
  discover: (cid: string, baseVersion: number) =>
    req<{ ok: boolean; count: number; tables: DiscoveredTable[]; version: number }>(
      `/connections/${cid}/discover`, { method: "POST", baseVersion }),
  setScope: (cid: string, tables: string[], baseVersion: number, rowLimits?: Record<string, number>) =>
    req<{ ok: boolean; count: number; version: number }>(
      `/connections/${cid}/scope`, {
        method: "POST", body: JSON.stringify({ tables, row_limits: rowLimits ?? null }), baseVersion,
      }),
  countTableRows: (cid: string, schema_name: string, name: string) =>
    req<{ ok: boolean; count?: number; cancelled?: boolean; error?: string }>(
      `/connections/${cid}/tables/count`, { method: "POST", body: JSON.stringify({ schema_name, name }) }),

  // -- pipeline --
  launchRun: (connection_id: string, agents: string[] | null, baseVersion: number, tables?: string[] | null) =>
    req<{ run: AgentRun; version: number }>("/runs", {
      method: "POST", body: JSON.stringify({ connection_id, agents, tables }), baseVersion,
    }),
  getRun: (id: string) => req<AgentRun>(`/runs/${id}`),
  cancelRun: (id: string) => req<{ ok: boolean }>(`/runs/${id}/cancel`, { method: "POST" }),

  // -- data quality checks --
  launchQualityRun: (
    body: { connection_id: string; scope: Record<string, string[] | null>;
           thresholds?: Partial<QualityThresholds>; focus_notes?: string },
    baseVersion: number
  ) => req<{ run: QualityRun; version: number }>("/quality-checks/runs", {
    method: "POST", body: JSON.stringify(body), baseVersion,
  }),
  listQualityRuns: () => req<{ runs: Omit<QualityRun, "tables" | "logs">[] }>("/quality-checks/runs"),
  getQualityRun: (id: string) => req<QualityRun>(`/quality-checks/runs/${id}`),
  cancelQualityRun: (id: string) => req<{ ok: boolean }>(`/quality-checks/runs/${id}/cancel`, { method: "POST" }),
  answerQualityRun: (id: string, answer: string) =>
    req<{ ok: boolean }>(`/quality-checks/runs/${id}/answer`, { method: "POST", body: JSON.stringify({ answer }) }),
  deleteQualityRun: (id: string) => req<{ ok: boolean }>(`/quality-checks/runs/${id}`, { method: "DELETE" }),

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

  // -- search (universal — datasets, columns, glossary, tags, domains) --
  search: (q: string) =>
    req<{ query: string; hits: SearchHit[]; facets: Record<string, number>; answer: string | null; llm: boolean }>(
      "/search", { method: "POST", body: JSON.stringify({ q }) }),

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

  explainQaIssue: (body: { dataset_id: string; message: string; severity: string }) =>
    req<{ ok: boolean; explanation: { explanation: string; suggested_fix: string; risk: string } }>(
      "/llm/explain-quality-issue", { method: "POST", body: JSON.stringify(body) }),

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

  // -- datamarts --
  setDatasetDatamart: (dsId: string, sql: string, language: "sql" | "code", baseVersion: number) =>
    req<{ ok: boolean; datamart: DatamartInfo; version: number }>(
      `/datasets/${encodeURIComponent(dsId)}/datamart`,
      { method: "POST", body: JSON.stringify({ sql, language }), baseVersion }),
  clearDatasetDatamart: (dsId: string, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/datasets/${encodeURIComponent(dsId)}/datamart`, { method: "DELETE", baseVersion }),
  detectDatamartRegistry: (dataset_id: string) =>
    req<{ ok: boolean; roles: Record<string, string | null>; confidence: number; reason: string;
          columns: string[]; sample: Record<string, unknown>[] }>("/datamarts/detect-registry", {
      method: "POST", body: JSON.stringify({ dataset_id }),
    }),
  importDatamartRegistry: (dataset_id: string, roles: Record<string, string | null>, limit: number, baseVersion: number) =>
    req<{ ok: boolean; processed: number; created: number; matched_existing: number; edges_added: number; failed: number; version: number }>(
      "/datamarts/import-registry", { method: "POST", body: JSON.stringify({ dataset_id, roles, limit }), baseVersion }),

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
  createUser: (body: { username: string; password: string; role: Role }) =>
    req<{ user: User }>("/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id: string, patch: { role?: Role; active?: boolean; password?: string }) =>
    req<{ user: User }>(`/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteUser: (id: string) =>
    req<{ ok: boolean }>(`/users/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // -- notifications --
  listNotifications: () => req<{ notifications: Notification[]; unread_count: number }>("/notifications"),
  markNotificationRead: (id: string) =>
    req<{ ok: boolean }>(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }),
  markAllNotificationsRead: () =>
    req<{ ok: boolean }>("/notifications/read-all", { method: "POST" }),

  // -- query log --
  listQueries: () => req<{ active: QueryLogEntry[]; recent: QueryLogEntry[] }>("/queries"),
  cancelQuery: (id: string) => req<{ ok: boolean }>(`/queries/${encodeURIComponent(id)}/cancel`, { method: "POST" }),

  // -- connector settings (admin) --
  updateConnectorSettings: (body: ConnectorSettings, baseVersion: number) =>
    req<{ ok: boolean; config: ConnectorSettings; version: number }>("/settings/connectors", {
      method: "POST", body: JSON.stringify(body), baseVersion,
    }),

  updateAlertSettings: (body: Partial<AlertSettings>, baseVersion: number) =>
    req<{ ok: boolean; config: AlertSettings; version: number }>("/settings/alerts", {
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

  // -- tags --
  addDatasetTag: (dsId: string, tag: string, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/datasets/${encodeURIComponent(dsId)}/tags`, {
      method: "POST", body: JSON.stringify({ tag }), baseVersion,
    }),
  removeDatasetTag: (dsId: string, tag: string, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/datasets/${encodeURIComponent(dsId)}/tags/${encodeURIComponent(tag)}`, {
      method: "DELETE", baseVersion,
    }),
  addColumnTag: (dsId: string, col: string, tag: string, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/columns/${encodeURIComponent(dsId)}/${encodeURIComponent(col)}/tags`, {
      method: "POST", body: JSON.stringify({ tag }), baseVersion,
    }),
  removeColumnTag: (dsId: string, col: string, tag: string, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(
      `/columns/${encodeURIComponent(dsId)}/${encodeURIComponent(col)}/tags/${encodeURIComponent(tag)}`,
      { method: "DELETE", baseVersion }),

  // -- domains --
  addDomain: (body: { name: string; parent_id?: string | null; description?: string; color?: string }, baseVersion: number) =>
    req<{ domain: Domain; version: number }>("/domains", { method: "POST", body: JSON.stringify(body), baseVersion }),
  updateDomain: (id: string, patch: Partial<Pick<Domain, "name" | "parent_id" | "description" | "color">>, baseVersion: number) =>
    req<{ domain: Domain; version: number }>(`/domains/${encodeURIComponent(id)}`, {
      method: "PATCH", body: JSON.stringify(patch), baseVersion,
    }),
  deleteDomain: (id: string, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/domains/${encodeURIComponent(id)}`, { method: "DELETE", baseVersion }),
  setDatasetDomain: (dsId: string, domainId: string | null, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/datasets/${encodeURIComponent(dsId)}/domain`, {
      method: "POST", body: JSON.stringify({ domain_id: domainId }), baseVersion,
    }),

  // -- ownership --
  addDatasetOwner: (dsId: string, body: { name: string; type: Owner["type"]; user_id?: string | null }, baseVersion: number) =>
    req<{ owner: Owner; version: number }>(`/datasets/${encodeURIComponent(dsId)}/owners`, {
      method: "POST", body: JSON.stringify(body), baseVersion,
    }),
  removeDatasetOwner: (dsId: string, ownerId: string, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/datasets/${encodeURIComponent(dsId)}/owners/${encodeURIComponent(ownerId)}`, {
      method: "DELETE", baseVersion,
    }),

  // -- deprecation --
  deprecateDataset: (dsId: string, reason: string, replacementDatasetId: string | null, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/datasets/${encodeURIComponent(dsId)}/deprecate`, {
      method: "POST", body: JSON.stringify({ reason, replacement_dataset_id: replacementDatasetId }), baseVersion,
    }),
  undeprecateDataset: (dsId: string, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/datasets/${encodeURIComponent(dsId)}/undeprecate`, {
      method: "POST", baseVersion,
    }),

  // -- usage / popularity --
  recordDatasetView: (dsId: string) =>
    req<{ ok: boolean }>(`/datasets/${encodeURIComponent(dsId)}/view`, { method: "POST" }),

  // -- custom properties --
  setCustomProperty: (dsId: string, key: string, value: string, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/datasets/${encodeURIComponent(dsId)}/properties`, {
      method: "POST", body: JSON.stringify({ key, value }), baseVersion,
    }),
  deleteCustomProperty: (dsId: string, key: string, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/datasets/${encodeURIComponent(dsId)}/properties/${encodeURIComponent(key)}`, {
      method: "DELETE", baseVersion,
    }),

  // -- column-level lineage / impact analysis --
  addColumnLineage: (body: {
    from_dataset_id: string; from_column: string; to_dataset_id: string; to_column: string;
    via?: string; kind?: string; confidence?: number;
  }, baseVersion: number) =>
    req<{ edge: ColumnLineageEdge; version: number }>("/lineage/columns", {
      method: "POST", body: JSON.stringify(body), baseVersion,
    }),
  deleteColumnLineage: (idx: number, baseVersion: number) =>
    req<{ ok: boolean; version: number }>(`/lineage/columns/${idx}`, { method: "DELETE", baseVersion }),
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
