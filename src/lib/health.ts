// Fully-derived data-quality health score — computed purely from data already
// present in CatalogState (profile + doc), no API call, no stored state beyond
// the profile_history the backend appends during profiling.
import type { Dataset, DatasetDoc } from "../types";

export interface HealthCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface DatasetHealth {
  score: number;
  checks: HealthCheck[];
}

const WEIGHT: Record<HealthCheck["status"], number> = { pass: 1, warn: 0.5, fail: 0 };

export function computeDatasetHealth(ds: Dataset, doc: DatasetDoc | undefined): DatasetHealth {
  const d = doc || {};
  const checks: HealthCheck[] = [];

  checks.push(d.definition
    ? { id: "definition", label: "Table has a definition", status: "pass", detail: d.definition }
    : { id: "definition", label: "Table has a definition", status: "fail", detail: "No table-level definition yet" });

  const owners = d.owners ?? [];
  checks.push(owners.length > 0
    ? { id: "owner", label: "Has an assigned owner", status: "pass", detail: owners.map((o) => o.name).join(", ") }
    : { id: "owner", label: "Has an assigned owner", status: "warn", detail: "No owner assigned" });

  const keyCol = ds.columns.find((c) => c.profile.is_key_candidate);
  checks.push(keyCol
    ? { id: "key", label: "Has a candidate primary key", status: "pass", detail: keyCol.name }
    : { id: "key", label: "Has a candidate primary key", status: "warn", detail: "No column looks like a unique key" });

  const badNulls = ds.columns.filter((c) => c.profile.null_ratio > 0.5);
  checks.push(badNulls.length === 0
    ? { id: "nulls", label: "No column is mostly empty", status: "pass", detail: `${ds.columns.length} column(s) checked` }
    : { id: "nulls", label: "No column is mostly empty", status: "fail",
      detail: `${badNulls.length} column(s) >50% null: ${badNulls.map((c) => c.name).join(", ")}` });

  const colDocs = d.columns ?? {};
  const unreviewedPii = ds.columns.filter((c) =>
    c.profile.sensitivity === "PII" && colDocs[c.name]?.status !== "validated");
  checks.push(unreviewedPii.length === 0
    ? { id: "pii", label: "PII columns reviewed", status: "pass", detail: "No unreviewed PII" }
    : { id: "pii", label: "PII columns reviewed", status: "fail",
      detail: `${unreviewedPii.length} unreviewed: ${unreviewedPii.map((c) => c.name).join(", ")}` });

  const hist = d.profile_history ?? [];
  if (hist.length > 0) {
    const prev = hist[hist.length - 1].row_estimate;
    const cur = ds.row_estimate;
    if (prev > 0) {
      const dropPct = (prev - cur) / prev;
      checks.push(dropPct > 0.2
        ? { id: "drift", label: "Row count is stable", status: "fail",
          detail: `Dropped ${(dropPct * 100).toFixed(0)}% since last profile (${prev.toLocaleString()} → ${cur.toLocaleString()})` }
        : { id: "drift", label: "Row count is stable", status: "pass",
          detail: `${prev.toLocaleString()} → ${cur.toLocaleString()}` });
    }
  }

  if (d.deprecated) {
    checks.push({ id: "deprecated", label: "Not deprecated", status: "fail", detail: d.deprecated.reason });
  }

  const score = checks.length
    ? Math.round(100 * checks.reduce((s, c) => s + WEIGHT[c.status], 0) / checks.length)
    : 100;
  return { score, checks };
}
