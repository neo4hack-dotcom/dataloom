export interface QualityBreakdown {
  completeness: number;
  uniqueness: number;
  validity: number;
}

export interface ColumnProfile {
  row_count: number;
  null_ratio: number;
  distinct: number;
  distinct_ratio: number;
  numeric: { min: number; max: number; mean: number } | null;
  semantic_type: string;
  semantic_confidence: number;
  format_masks: { mask: string; count: number }[];
  top_values: { value: string; count: number }[];
  is_key_candidate: boolean;
  quality_score: number;
  quality_breakdown: QualityBreakdown;
  sensitivity: "PII" | "INTERNAL" | "PUBLIC";
}

export interface Column {
  name: string;
  data_type: string;
  nullable: boolean;
  position: number;
  profile: ColumnProfile;
  dataset_id: string;
}

export interface Dataset {
  id: string;
  connection_id: string;
  schema: string;
  name: string;
  kind: string;
  row_estimate: number;
  comment: string | null;
  columns: Column[];
  profiled_at?: number;
}

export interface CachedColumnSuggestion {
  definition: string;
  calculation: string | null;
  semantic_type: string;
  sensitivity: string;
  confidence: number;
  evidence: string[];
  cached_at: number;
}

export interface ColumnDoc {
  definition?: string;
  calculation?: string | null;
  confidence?: number;
  source?: string;
  status?: "suggested" | "validated" | "rejected";
  sensitivity?: string;
  source_file?: string;   // optional origin file/topic (csv/txt/bulk/API/kafka…)
  source_field?: string;  // optional origin field name in that source
  // last AI suggestion generated for this column — persisted so re-opening the
  // panel doesn't call the LLM again; only "Regenerate" forces a fresh call.
  llm_suggestion?: CachedColumnSuggestion;
  tags?: string[];
}

export interface Owner {
  id: string;
  name: string;
  type: "technical" | "business" | "steward";
  is_user: boolean;
}

export interface Deprecation {
  reason: string;
  by: string;
  at: number;
  replacement_dataset_id?: string | null;
}

export interface Domain {
  id: string;
  name: string;
  parent_id: string | null;
  description: string;
  color: string;
}

export interface ColumnLineageEdge {
  from: { dataset_id: string; column: string };
  to: { dataset_id: string; column: string };
  via: string;
  kind: string;
  confidence: number;
  manual?: boolean;
}

export interface TablePartition {
  value: string;
  note?: string;
}

export interface DatasetDoc {
  definition?: string;
  domain?: string;
  doc_source?: string;
  doc_confidence?: number;
  columns?: Record<string, ColumnDoc>;
  // identity card + reusable content synthesis (manual or LLM, all persisted)
  identity?: { content?: string; data_kind?: string; products?: string[]; key_fields?: string[]; [k: string]: unknown };
  synthesis?: string;
  synthesis_source?: string;
  synthesis_at?: number;
  suggested_partition?: string | null;
  partitioning?: { column?: string; explanation?: string; partitions?: TablePartition[] };
  // cached LLM previews — persisted so reopening a modal doesn't recall the LLM
  llm_table_suggestion?: {
    table_definition: string; domain: string;
    columns: { name: string; definition: string; calculation: string | null; sensitivity: string; confidence: number }[];
    cached_at: number;
  };
  llm_mapping_detection?: {
    roles: Record<string, string | null>; confidence: number; reason: string;
    columns: string[]; sample: Record<string, unknown>[]; cached_at: number;
  };
  tags?: string[];
  domain_id?: string | null;
  owners?: Owner[];
  deprecated?: Deprecation | null;
  view_count?: number;
  last_viewed_at?: number;
  custom_properties?: Record<string, string>;
  profile_history?: { row_estimate: number; ts: number }[];
}

export interface DiscoveredTable {
  schema: string;
  name: string;
  row_estimate: number;
  comment: string | null;
}

export interface Connection {
  id: string;
  name: string;
  type: "demo" | "oracle" | "clickhouse" | "okf" | "mcp";
  config: Record<string, unknown>;
  llm_model?: string | null;
  created_at: number;
  discovered_tables?: DiscoveredTable[];
  discovered_at?: number;
  scope?: string[];
  scope_row_limits?: Record<string, number>;
  scope_row_counts?: Record<string, number>;
  scope_row_counts_at?: Record<string, number>;
  // MCP Library — full raw tool inventory + pasted code/SQL query definitions
  mcp_tools?: McpTool[];
  mcp_tools_at?: number;
  mcp_queries?: McpQueryDef[];
}

export interface McpTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface McpMappingColumn {
  name: string;
  data_type: string;
  nullable: boolean;
  comment?: string;
}

export interface McpMappingTable {
  tool: string;
  table_name: string;
  schema?: string;
  comment?: string;
  row_path?: string;
  row_estimate?: number;
  columns: McpMappingColumn[];
}

// -- MCP Library: code/SQL-grounded query documentation -- //
export interface McpQueryTableRef {
  name: string;
  role: "source" | "target";
}

export interface McpQueryColumnInfo {
  name: string;
  description: string;
  source_expression?: string;
}

export interface McpQueryReconciliation {
  column: string;
  status: string; // "matches" | "only_in_code" | "only_in_mapping"
  note: string;
}

export interface McpLinkCandidate {
  dataset_id: string;
  label: string;
  matched_table: string;
  score: number;
}

export interface McpQueryExtraction {
  functional_description: string;
  tables_referenced: McpQueryTableRef[];
  columns: McpQueryColumnInfo[];
  column_reconciliation: McpQueryReconciliation[];
  link_candidates: McpLinkCandidate[];
}

export interface McpQueryDef {
  id: string;
  tool: string;
  title: string;
  language: "sql" | "code";
  code: string;
  extraction: McpQueryExtraction | null;
  created_at: number;
  extracted_at?: number;
}

export interface McpCoverageGap {
  tool: string;
  description: string;
  has_mapping: boolean;
  has_query: boolean;
  priority: number;
  reason: string;
}

export interface MatchPair {
  a: { dataset_id: string; column: string };
  b: { dataset_id: string; column: string };
  name_sim: number;
  type_match: number;
  value_jaccard: number;
  containment_ab: number;
  containment_ba: number;
  confidence: number;
  reasons: string[];
}

export interface Relationship {
  parent: { dataset_id: string; column: string };
  child: { dataset_id: string; column: string };
  kind: string;
  containment: number;
  confidence: number;
  reason: string;
  status?: "suggested" | "validated" | "rejected";
  // cached AI explanation — persisted so reopening doesn't recall the LLM
  explanation?: { meaning: string; cardinality: string; confidence: number; caveats: string[]; cached_at: number };
}

export interface LineageEdge {
  from: string;
  to: string;
  via: string;
  kind: "key" | "mapping" | "manual";
  confidence: number;
}

export interface QaIssue {
  severity: "high" | "medium" | "low";
  dataset_id: string;
  message: string;
}

// -- Data Quality Checks (independent deep-profiling module) -- //
export interface QualityThresholds {
  zscore: number;
  iqr_multiplier: number;
  outlier_pct_high: number;
  duplicate_pct_high: number;
  categorical_cardinality_max: number;
  pattern_dominance_min: number;
  value_sample_size: number;
  row_sample_size: number;
}

export interface QualityPlanStep {
  table: string;
  columns: string[];
  checks: string[];
  reason: string;
}

export interface QualityPlan {
  steps: QualityPlanStep[];
  narrative: string;
}

export interface QualityFinding {
  table: string;
  column: string | null;
  kind: string;
  severity: "high" | "medium" | "low";
  message: string;
  evidence: Record<string, unknown>;
}

export interface QualityHighlight {
  finding_index: number;
  explanation: string;
  suggested_action: string;
}

export interface QualityTableResult {
  dataset_id: string;
  name: string;
  row_estimate: number;
  findings: QualityFinding[];
  interpretation: {
    summary: string;
    risk_level: "low" | "medium" | "high";
    highlights: QualityHighlight[];
  };
}

export interface QualityRunLog {
  ts: number;
  level: string;
  message: string;
}

export interface QualityRun {
  id: string;
  connection_id: string;
  scope: Record<string, string[] | null>;
  thresholds: QualityThresholds;
  focus_notes: string;
  status: "queued" | "running" | "waiting_input" | "done" | "error" | "cancelled";
  progress: number;
  phase: "planning" | "checking" | "refining" | "interpreting" | "done" | null;
  logs: QualityRunLog[];
  created_at: number;
  started_at?: number;
  finished_at?: number;
  plan: QualityPlan | null;
  tables: QualityTableResult[];
  cancel_requested: boolean;
  pending_question?: string | null;
  question_answer?: string | null;
  error?: string;
}

export interface GlossaryTerm {
  term: string;
  occurrences: number;
  columns: { dataset_id: string; column: string }[];
  definition: string;
}

export interface RunLog {
  ts: number;
  level: string;
  message: string;
}

export interface AgentRun {
  id: string;
  connection_id: string;
  agents: string[];
  status: "queued" | "running" | "done" | "error" | "cancelled";
  progress: number;
  current_agent: string | null;
  logs: RunLog[];
  created_at: number;
  summary: Record<string, Record<string, number>>;
  error?: string;
}

export interface ModelNote {
  id: string;
  text: string;
  ts: number;
}

export interface ConnectorSettings {
  row_fetch_limit: number;
}

export interface AlertSettings {
  quality_score_warn: number;
  quality_score_critical: number;
  null_ratio_warn: number;
  row_drift_warn_pct: number;
  require_pii_validation: boolean;
  stale_days_warn: number;
}

export interface McpConfig {
  enabled: boolean;
  api_token_prefix?: string | null;
  api_token_set?: boolean;
  tools: Record<string, boolean>;
  exposure: {
    hide_pii: boolean;
    denied_datasets: string[];
    denied_columns: { dataset_id: string; column: string }[];
  };
}

export interface CatalogState {
  version: number;
  connections: Connection[];
  datasets: Dataset[];
  docs: Record<string, DatasetDoc>;
  matches: MatchPair[];
  relationships: Relationship[];
  lineage: LineageEdge[];
  qa_issues: QaIssue[];
  glossary: GlossaryTerm[];
  model_notes: ModelNote[];
  runs: AgentRun[];
  audit: { version: number; ts: number; action: string; detail: string }[];
  settings: { theme: string; llm: LlmConfig; connectors: ConnectorSettings; alerts: AlertSettings; mcp: McpConfig };
  domains: Domain[];
  column_lineage: ColumnLineageEdge[];
}

export interface SearchHit {
  type: "dataset" | "column" | "glossary" | "tag" | "domain";
  label: string;
  sub: string;
  score: number;
  dataset_id?: string;
  column?: string;
  term?: string;
  tag?: string;
  domain_id?: string;
}

export type Role = "admin" | "member" | "viewer";

export interface User {
  id: string;
  username: string;
  role: Role;
  active: boolean;
  created_at: number;
}

export interface Notification {
  id: string;
  audience: "all" | "admins" | "user";
  title: string;
  message: string;
  kind: "info" | "success" | "warning" | "error";
  category: string;
  link: { tab?: string } | null;
  created_at: number;
  read: boolean;
}

export interface QueryLogEntry {
  id: string;
  connection_id: string;
  connection_name: string;
  operation: "list_tables" | "get_columns" | "sample_values" | "sample_rows" | "count_rows";
  target: string;
  row_limit: number | null;
  source: "profiler" | "discover" | "mapping" | "mcp" | "pipeline";
  status: "running" | "done" | "cancelled" | "error";
  started_at: number;
  finished_at: number | null;
  rows_returned: number | null;
  error: string | null;
}

export interface LlmConfig {
  base_url: string;
  model: string;
  temperature: number;
  max_tokens: number;
  api_key_set?: boolean;
  last_test?: LlmTest | null;
}

export interface LlmTest {
  ok: boolean;
  latency_ms: number;
  message: string;
  ts: number;
}

export interface LlmPreset {
  name: string;
  base_url: string;
}

export interface AgentMeta {
  id: string;
  name: string;
  icon: string;
  desc: string;
}

export interface Health {
  ok: boolean;
  version: number;
  llm: {
    up: boolean;
    models: string[];
    config: LlmConfig;
    presets: LlmPreset[];
    last_test?: LlmTest | null;
  };
  agents: AgentMeta[];
  pipeline: string[];
}
