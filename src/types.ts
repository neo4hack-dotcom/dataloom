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
  type: "demo" | "oracle" | "clickhouse" | "okf";
  config: Record<string, unknown>;
  llm_model?: string | null;
  created_at: number;
  discovered_tables?: DiscoveredTable[];
  discovered_at?: number;
  scope?: string[];
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
  status: "queued" | "running" | "done" | "error";
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
  settings: { theme: string; llm: LlmConfig };
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
