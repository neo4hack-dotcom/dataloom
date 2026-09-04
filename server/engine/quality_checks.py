"""
Data Quality Checks — an independent, adaptive deep-profiling module.

Distinct from the lightweight QA Reviewer agent (which audits already-profiled
metadata against fixed thresholds), this module runs its OWN statistical
analysis directly against the source — numeric outliers (IQR + z-score),
categorical rarity, format/pattern breaks, and duplicate rows — then uses the
local LLM in three passes to make the whole thing adaptive rather than a fixed
checklist:

  1. plan_analysis    — given discovery (columns, types, existing functional
                        definitions, row counts) + the user's focus notes and
                        thresholds, decide WHICH checks are worth running on
                        WHICH columns of WHICH tables. This is what lets a
                        run on a 500-table warehouse stay fast: cheap
                        metadata decides where the expensive live queries go.
  2. refine_plan       — after the first pass of results, decide whether
                        anything surprising warrants a small number of
                        targeted follow-up checks.
  3. interpret_findings — turn the raw statistical findings for one table
                        into a plain-English, risk-ranked narrative,
                        surfacing what a human skimming the data would be
                        unlikely to catch on their own.

Every step degrades gracefully to a heuristic when the LLM is offline, so a
run always completes.
"""
from __future__ import annotations

import math
import time
import traceback
from typing import Any, Callable

from . import llm
from .connectors import build_connector
from .profiling import _format_mask

LogFn = Callable[[str, str], None]


class LLMUnavailable(Exception):
    pass


# --------------------------------------------------------------------------- #
#  Statistical primitives — pure, no I/O                                      #
# --------------------------------------------------------------------------- #
def _percentile(sorted_vals: list[float], pct: float) -> float:
    if not sorted_vals:
        return 0.0
    k = (len(sorted_vals) - 1) * pct
    f, c = math.floor(k), math.ceil(k)
    if f == c:
        return sorted_vals[int(k)]
    return sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)


def numeric_deep_stats(values: list[float], z_thresh: float = 3.0, iqr_mult: float = 1.5) -> dict[str, Any]:
    vals = sorted(values)
    n = len(vals)
    if n < 5:
        return {"n": n, "insufficient": True}
    mean = sum(vals) / n
    variance = sum((v - mean) ** 2 for v in vals) / n
    std = math.sqrt(variance)
    q1, q3 = _percentile(vals, 0.25), _percentile(vals, 0.75)
    iqr = q3 - q1
    lo, hi = q1 - iqr_mult * iqr, q3 + iqr_mult * iqr
    iqr_outliers = [v for v in vals if v < lo or v > hi]
    z_outliers = [v for v in vals if std > 0 and abs((v - mean) / std) > z_thresh]
    return {
        "n": n, "mean": round(mean, 4), "stddev": round(std, 4), "min": vals[0], "max": vals[-1],
        "p1": round(_percentile(vals, 0.01), 4), "p5": round(_percentile(vals, 0.05), 4),
        "p25": round(q1, 4), "p50": round(_percentile(vals, 0.5), 4), "p75": round(q3, 4),
        "p95": round(_percentile(vals, 0.95), 4), "p99": round(_percentile(vals, 0.99), 4),
        "iqr": round(iqr, 4), "iqr_bounds": [round(lo, 4), round(hi, 4)],
        "iqr_outlier_count": len(iqr_outliers), "iqr_outlier_examples": iqr_outliers[:8],
        "zscore_outlier_count": len(z_outliers), "zscore_outlier_examples": z_outliers[:8],
    }


def categorical_deep_stats(values: list[str]) -> dict[str, Any]:
    n = len(values)
    counts: dict[str, int] = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    singleton = [v for v, c in counts.items() if c == 1]
    top = sorted(counts.items(), key=lambda kv: -kv[1])[:10]
    return {
        "n": n, "cardinality": len(counts),
        "cardinality_ratio": round(len(counts) / n, 4) if n else 0.0,
        "singleton_count": len(singleton), "singleton_examples": singleton[:8],
        "top_values": [{"value": v, "count": c} for v, c in top],
    }


def pattern_break_stats(values: list[str]) -> dict[str, Any]:
    """Reuses the profiler's format-mask detector to find a column's dominant
    shape and flag minority-pattern values — e.g. a handful of malformed
    entries hiding among thousands of well-formed ones."""
    masks: dict[str, list[str]] = {}
    for v in values:
        masks.setdefault(_format_mask(v), []).append(v)
    if not masks:
        return {"dominant_mask": None, "dominant_ratio": 0.0, "minority_count": 0, "minority_examples": []}
    dominant = max(masks, key=lambda m: len(masks[m]))
    minority = [v for m, vs in masks.items() if m != dominant for v in vs]
    return {
        "dominant_mask": dominant, "dominant_ratio": round(len(masks[dominant]) / len(values), 4),
        "minority_count": len(minority), "minority_examples": minority[:8],
    }


def duplicate_row_stats(rows: list[dict[str, Any]]) -> dict[str, Any]:
    seen: dict[tuple, int] = {}
    for r in rows:
        key = tuple(sorted((k, str(v)) for k, v in r.items()))
        seen[key] = seen.get(key, 0) + 1
    dupes = {k: c for k, c in seen.items() if c > 1}
    return {
        "total_rows": len(rows), "duplicate_groups": len(dupes),
        "duplicate_row_count": sum(c - 1 for c in dupes.values()),
    }


def _parse_dt(v: Any) -> float | None:
    """Best-effort parse to a comparable epoch-seconds float — dates travel as
    strings/datetimes/epoch numbers depending on the source driver."""
    if v is None:
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    s = str(v).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%Y/%m/%d",
                "%d/%m/%Y", "%m/%d/%Y", "%Y-%m-%dT%H:%M:%S.%f"):
        try:
            import datetime
            return datetime.datetime.strptime(s[:len(fmt) + 6], fmt).timestamp()
        except ValueError:
            continue
    return None


def date_order_stats(rows: list[dict[str, Any]], earlier_col: str, later_col: str) -> dict[str, Any]:
    """Cross-column consistency: flags rows where `later_col` is chronologically
    BEFORE `earlier_col` — e.g. a delivery date earlier than its order date."""
    violations = []
    checked = 0
    for r in rows:
        a, b = _parse_dt(r.get(earlier_col)), _parse_dt(r.get(later_col))
        if a is None or b is None:
            continue
        checked += 1
        if b < a:
            violations.append({earlier_col: r.get(earlier_col), later_col: r.get(later_col)})
    return {"checked": checked, "violation_count": len(violations), "examples": violations[:8]}


def null_correlation_stats(rows: list[dict[str, Any]], trigger_col: str, trigger_value: str,
                           target_col: str) -> dict[str, Any]:
    """Cross-column consistency: flags rows where `trigger_col` equals
    `trigger_value` (e.g. status='DELIVERED') but `target_col` is empty/null
    (e.g. no delivery_date) — a business-logic inconsistency, not a typo."""
    matched, violations = 0, []
    for r in rows:
        if str(r.get(trigger_col, "")).strip().lower() != trigger_value.strip().lower():
            continue
        matched += 1
        tv = r.get(target_col)
        if tv is None or str(tv).strip() == "":
            violations.append({k: r.get(k) for k in r if k in (trigger_col, target_col)})
    return {"matched": matched, "violation_count": len(violations), "examples": violations[:8]}


def temporal_drift_stats(rows: list[dict[str, Any]], time_col: str, bins: int = 12) -> dict[str, Any]:
    """Bins rows by time (into up to `bins` equal-width buckets across the
    observed range) and flags buckets whose row count is a statistical outlier
    versus the others — surfaces gaps (a period with unexpectedly few/no rows)
    and spikes (a burst) that a human skimming a sample would rarely notice."""
    times = sorted(t for t in (_parse_dt(r.get(time_col)) for r in rows) if t is not None)
    if len(times) < 10:
        return {"insufficient": True}
    lo, hi = times[0], times[-1]
    span = hi - lo
    if span <= 0:
        return {"insufficient": True}
    width = span / bins
    counts = [0] * bins
    for t in times:
        idx = min(bins - 1, int((t - lo) / width))
        counts[idx] += 1
    mean = sum(counts) / bins
    variance = sum((c - mean) ** 2 for c in counts) / bins
    std = math.sqrt(variance)
    anomalous = []
    if std > 0:
        import datetime
        for i, c in enumerate(counts):
            z = (c - mean) / std
            if abs(z) > 1.8:
                bucket_start = datetime.datetime.fromtimestamp(lo + i * width).strftime("%Y-%m-%d")
                anomalous.append({"period_start": bucket_start, "count": c, "expected": round(mean, 1),
                                  "kind": "gap" if c < mean else "spike"})
    return {"bins": bins, "counts": counts, "mean_per_bin": round(mean, 2),
           "stddev_per_bin": round(std, 2), "anomalous_bins": anomalous}


def bivariate_outlier_stats(pairs: list[tuple[float, float]], threshold: float = 9.0) -> dict[str, Any]:
    """A lightweight, dependency-free approximation of Mahalanobis-distance
    outlier detection for two numeric columns: two values can each look
    perfectly normal on their own while their COMBINATION is what's actually
    aberrant (e.g. a small quantity paired with a huge unit price). Computes
    the 2x2 covariance matrix and each point's squared Mahalanobis distance
    by hand (closed-form 2x2 inverse) — no numpy/scipy required."""
    n = len(pairs)
    if n < 10:
        return {"insufficient": True}
    mx = sum(p[0] for p in pairs) / n
    my = sum(p[1] for p in pairs) / n
    vxx = sum((p[0] - mx) ** 2 for p in pairs) / n
    vyy = sum((p[1] - my) ** 2 for p in pairs) / n
    vxy = sum((p[0] - mx) * (p[1] - my) for p in pairs) / n
    det = vxx * vyy - vxy * vxy
    if abs(det) < 1e-9:
        return {"insufficient": True}  # degenerate (perfectly correlated) — no useful joint signal
    # inverse of [[vxx, vxy], [vxy, vyy]]
    ixx, iyy, ixy = vyy / det, vxx / det, -vxy / det
    outliers = []
    for x, y in pairs:
        dx, dy = x - mx, y - my
        d2 = dx * dx * ixx + 2 * dx * dy * ixy + dy * dy * iyy
        if d2 > threshold:
            outliers.append({"x": x, "y": y, "distance2": round(d2, 2)})
    outliers.sort(key=lambda o: -o["distance2"])
    return {"n": n, "mean": [round(mx, 4), round(my, 4)], "outlier_count": len(outliers),
           "outlier_examples": outliers[:8]}


# --------------------------------------------------------------------------- #
#  Findings — turn raw stats into severity-ranked, human-readable anomalies   #
# --------------------------------------------------------------------------- #
def _findings_from_numeric(ds_id: str, col: str, s: dict[str, Any], thresholds: dict[str, Any]) -> list[dict[str, Any]]:
    if s.get("insufficient"):
        return []
    out = []
    if s["iqr_outlier_count"] > 0:
        pct = s["iqr_outlier_count"] / s["n"]
        out.append({
            "table": ds_id, "column": col, "kind": "outlier_iqr",
            "severity": "high" if pct > thresholds.get("outlier_pct_high", 0.05) else "medium",
            "message": f"{s['iqr_outlier_count']} value(s) ({pct*100:.1f}%) fall outside the normal IQR range "
                      f"[{s['iqr_bounds'][0]}, {s['iqr_bounds'][1]}].",
            "evidence": {"examples": s["iqr_outlier_examples"], "bounds": s["iqr_bounds"],
                        "mean": s["mean"], "stddev": s["stddev"]},
        })
    if s["zscore_outlier_count"] > 0:
        out.append({
            "table": ds_id, "column": col, "kind": "outlier_zscore", "severity": "medium",
            "message": f"{s['zscore_outlier_count']} value(s) sit more than "
                      f"{thresholds.get('zscore', 3.0)} standard deviations from the mean ({s['mean']}).",
            "evidence": {"examples": s["zscore_outlier_examples"], "mean": s["mean"], "stddev": s["stddev"]},
        })
    return out


def _findings_from_categorical(ds_id: str, col: str, s: dict[str, Any], thresholds: dict[str, Any]) -> list[dict[str, Any]]:
    if s["n"] < 10 or s["singleton_count"] == 0:
        return []
    # only flag when the column looks meant to be categorical, not free text
    if s["cardinality_ratio"] > thresholds.get("categorical_cardinality_max", 0.5):
        return []
    return [{
        "table": ds_id, "column": col, "kind": "rare_value", "severity": "low",
        "message": f"{s['singleton_count']} value(s) appear only once in an otherwise repeating column — "
                  f"possible typos or one-off entries.",
        "evidence": {"examples": s["singleton_examples"], "top_values": s["top_values"]},
    }]


def _findings_from_pattern(ds_id: str, col: str, s: dict[str, Any], thresholds: dict[str, Any]) -> list[dict[str, Any]]:
    if not s["dominant_mask"] or s["minority_count"] == 0:
        return []
    if s["dominant_ratio"] < thresholds.get("pattern_dominance_min", 0.9):
        return []  # no clear dominant shape to break from
    return [{
        "table": ds_id, "column": col, "kind": "pattern_break", "severity": "medium",
        "message": f"{s['minority_count']} value(s) break this column's dominant format "
                  f"('{s['dominant_mask']}', {s['dominant_ratio']*100:.0f}% of values).",
        "evidence": {"examples": s["minority_examples"], "dominant_mask": s["dominant_mask"]},
    }]


def _findings_from_duplicates(ds_id: str, s: dict[str, Any], thresholds: dict[str, Any]) -> list[dict[str, Any]]:
    if s["duplicate_row_count"] == 0:
        return []
    pct = s["duplicate_row_count"] / s["total_rows"] if s["total_rows"] else 0
    return [{
        "table": ds_id, "column": None, "kind": "duplicate_rows",
        "severity": "high" if pct > thresholds.get("duplicate_pct_high", 0.05) else "medium",
        "message": f"{s['duplicate_row_count']} duplicate row(s) in a sample of {s['total_rows']} "
                  f"({pct*100:.1f}%) across {s['duplicate_groups']} group(s).",
        "evidence": s,
    }]


def _findings_from_date_order(ds_id: str, earlier_col: str, later_col: str, s: dict[str, Any]) -> list[dict[str, Any]]:
    if s["violation_count"] == 0:
        return []
    return [{
        "table": ds_id, "column": f"{earlier_col} / {later_col}", "kind": "cross_column_date_order",
        "severity": "high",
        "message": f"{s['violation_count']} of {s['checked']} row(s) have '{later_col}' before '{earlier_col}' "
                  f"— chronologically impossible, a strong signal of a data or process bug.",
        "evidence": {"examples": s["examples"]},
    }]


def _findings_from_null_correlation(ds_id: str, trigger_col: str, trigger_value: str,
                                    target_col: str, s: dict[str, Any]) -> list[dict[str, Any]]:
    if s["violation_count"] == 0:
        return []
    pct = s["violation_count"] / s["matched"] if s["matched"] else 0
    return [{
        "table": ds_id, "column": f"{trigger_col} / {target_col}", "kind": "cross_column_null_correlation",
        "severity": "high" if pct > 0.05 else "medium",
        "message": f"{s['violation_count']} of {s['matched']} row(s) where {trigger_col}='{trigger_value}' "
                  f"have an empty '{target_col}' — a business-logic inconsistency, not just a missing value.",
        "evidence": {"examples": s["examples"]},
    }]


def _findings_from_temporal_drift(ds_id: str, col: str, s: dict[str, Any]) -> list[dict[str, Any]]:
    if s.get("insufficient") or not s.get("anomalous_bins"):
        return []
    out = []
    for b in s["anomalous_bins"][:5]:
        out.append({
            "table": ds_id, "column": col, "kind": "temporal_drift", "severity": "medium",
            "message": f"Unusual {b['kind']} in '{col}' around {b['period_start']}: {b['count']} row(s) "
                      f"vs. an expected ~{b['expected']} per period.",
            "evidence": {"period_start": b["period_start"], "count": b["count"], "expected": b["expected"]},
        })
    return out


def _findings_from_bivariate(ds_id: str, col_a: str, col_b: str, s: dict[str, Any]) -> list[dict[str, Any]]:
    if s.get("insufficient") or s["outlier_count"] == 0:
        return []
    return [{
        "table": ds_id, "column": f"{col_a} × {col_b}", "kind": "multivariate_outlier", "severity": "medium",
        "message": f"{s['outlier_count']} row(s) have a combination of '{col_a}' and '{col_b}' that's jointly "
                  f"unusual, even though each value looks normal on its own (e.g. a small quantity paired "
                  f"with a huge amount).",
        "evidence": {"examples": s["outlier_examples"], "mean": s["mean"]},
    }]


# --------------------------------------------------------------------------- #
#  Step execution — runs the checks one plan step asks for                    #
# --------------------------------------------------------------------------- #
def _sample_values_with_retry(connector, schema: str, name: str, col: str, limit: int, log: LogFn) -> list[Any]:
    """Auto-correction: on failure, retry once with a much smaller sample
    before giving up — a common recovery for a timeout on a huge/slow column."""
    try:
        return connector.sample_values(schema, name, col, limit=limit)
    except Exception as e:
        if limit <= 200:
            raise
        log("warn", f"  {name}.{col}: sampling failed ({e}) — retrying with a smaller sample…")
        return connector.sample_values(schema, name, col, limit=200)


def execute_step(connector, dataset: dict[str, Any], step: dict[str, Any],
                 thresholds: dict[str, Any], log: LogFn, model: str | None = None) -> list[dict[str, Any]]:
    ds_id = dataset["id"]
    checks = step.get("checks") or []
    columns = step.get("columns") or []
    col_by_name = {c["name"]: c for c in dataset["columns"]}
    findings: list[dict[str, Any]] = []
    schema, name = dataset["schema"], dataset["name"]

    needs_rows = ("duplicate_rows" in checks or "cross_column_date_order" in checks
                 or "cross_column_null_correlation" in checks)
    rows: list[dict[str, Any]] = []
    if needs_rows:
        try:
            rows = connector.sample_rows(schema, name, limit=thresholds.get("row_sample_size", 2000))
        except Exception as e:
            log("warn", f"  row sampling failed on {name}: {e}")

    if "duplicate_rows" in checks and rows:
        findings.extend(_findings_from_duplicates(ds_id, duplicate_row_stats(rows), thresholds))

    if "cross_column_date_order" in checks and rows:
        for pair in step.get("date_pairs") or []:
            if len(pair) != 2:
                continue
            earlier, later = pair
            s = date_order_stats(rows, earlier, later)
            findings.extend(_findings_from_date_order(ds_id, earlier, later, s))
            log("ok", f"  ✓ {name}: date order {earlier}→{later} — {s['violation_count']} violation(s).")

    if "cross_column_null_correlation" in checks and rows:
        for rule in step.get("null_rules") or []:
            trig, val, target = rule.get("trigger_col"), rule.get("trigger_value"), rule.get("target_col")
            if not (trig and val and target):
                continue
            s = null_correlation_stats(rows, trig, val, target)
            findings.extend(_findings_from_null_correlation(ds_id, trig, val, target, s))

    if "temporal_drift" in checks and step.get("temporal_col"):
        tcol = step["temporal_col"]
        try:
            trows = connector.sample_rows(schema, name, limit=thresholds.get("row_sample_size", 2000))
            s = temporal_drift_stats(trows, tcol)
            findings.extend(_findings_from_temporal_drift(ds_id, tcol, s))
        except Exception as e:
            log("warn", f"  temporal drift check failed on {name}.{tcol}: {e}")

    if "multivariate_outlier" in checks:
        for pair in step.get("bivariate_pairs") or []:
            if len(pair) != 2:
                continue
            ca, cb = pair
            try:
                va = _sample_values_with_retry(connector, schema, name, ca, thresholds.get("value_sample_size", 3000), log)
                vb = _sample_values_with_retry(connector, schema, name, cb, thresholds.get("value_sample_size", 3000), log)
            except Exception as e:
                log("warn", f"  bivariate check {ca}×{cb} failed on {name}: {e}")
                continue
            n = min(len(va), len(vb))
            pts = [(float(va[i]), float(vb[i])) for i in range(n)
                  if isinstance(va[i], (int, float)) and isinstance(vb[i], (int, float))
                  and not isinstance(va[i], bool) and not isinstance(vb[i], bool)]
            s = bivariate_outlier_stats(pts)
            findings.extend(_findings_from_bivariate(ds_id, ca, cb, s))

    if "semantic_scan" in checks and llm.is_up():
        for col_name in step.get("semantic_columns") or columns[:3]:
            if col_name not in col_by_name:
                continue
            try:
                values = _sample_values_with_retry(connector, schema, name, col_name,
                                                    min(200, thresholds.get("value_sample_size", 3000)), log)
            except Exception as e:
                log("warn", f"  semantic scan {name}.{col_name} failed: {e}")
                continue
            if not values:
                continue
            try:
                findings.extend(semantic_anomaly_scan(
                    ds_id, col_name, [str(v) for v in values if v is not None][:60],
                    col_by_name[col_name].get("profile", {}).get("semantic_type", "unknown"), model=model))
            except LLMUnavailable:
                pass

    for col_name in columns:
        if col_name not in col_by_name:
            continue
        try:
            values = _sample_values_with_retry(connector, schema, name, col_name,
                                                thresholds.get("value_sample_size", 3000), log)
        except Exception as e:
            log("warn", f"  {name}.{col_name}: sampling failed: {e}")
            continue
        if not values:
            continue
        nums = [float(v) for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
        is_numeric = len(nums) >= max(5, 0.6 * len(values))
        str_vals = [str(v) for v in values]

        if "numeric_outliers" in checks and is_numeric:
            stats = numeric_deep_stats(nums, z_thresh=thresholds.get("zscore", 3.0),
                                       iqr_mult=thresholds.get("iqr_multiplier", 1.5))
            findings.extend(_findings_from_numeric(ds_id, col_name, stats, thresholds))
        if "categorical_rarity" in checks and not is_numeric:
            findings.extend(_findings_from_categorical(ds_id, col_name, categorical_deep_stats(str_vals), thresholds))
        if "pattern_consistency" in checks:
            findings.extend(_findings_from_pattern(ds_id, col_name, pattern_break_stats(str_vals), thresholds))
    return findings


# --------------------------------------------------------------------------- #
#  LLM semantic scan — reads real sampled values, flags what statistics can't #
# --------------------------------------------------------------------------- #
_SEMANTIC_SYSTEM = (
    "You are a senior data quality analyst. You are given real sampled values from one "
    "column, its name and detected semantic type. Flag ONLY values that are semantically "
    "implausible or inconsistent given the column's apparent purpose — e.g. a country name "
    "in a currency column, inconsistent spelling/casing of what should be the same category, "
    "placeholder/junk values ('test', 'n/a', 'xxx', '???'), or an obviously malformed entry a "
    "statistical check would miss because it isn't a numeric or format outlier. Do NOT flag "
    "normal variety in free text, and do NOT invent a problem if you don't see one — an empty "
    "list is a perfectly good answer.\n"
    "Reply STRICTLY in JSON: {\"flagged\": [{\"value\": string, \"reason\": string}]} — at most 8 items."
)


def semantic_anomaly_scan(ds_id: str, col: str, sample_values: list[str], semantic_type: str,
                          model: str | None = None) -> list[dict[str, Any]]:
    if not llm.is_up():
        raise LLMUnavailable()
    distinct = sorted(set(sample_values))[:60]
    if len(distinct) < 3:
        return []
    prompt = f"Column: {col}\nDetected semantic type: {semantic_type}\nSample values:\n" + "\n".join(distinct)
    out = llm.generate(system=_SEMANTIC_SYSTEM, prompt=prompt, model=model, timeout=90.0)
    if not isinstance(out, dict) or "_raw" in out:
        raise LLMUnavailable()
    flagged = out.get("flagged") or []
    if not flagged:
        return []
    return [{
        "table": ds_id, "column": col, "kind": "semantic_anomaly", "severity": "low",
        "message": f"'{f.get('value')}' looks semantically off for this column: {f.get('reason', '')}",
        "evidence": {"value": f.get("value"), "reason": f.get("reason")},
    } for f in flagged[:8] if f.get("value")]


# --------------------------------------------------------------------------- #
#  LLM planning — the "reasons at the start, adapts as it goes" layer         #
# --------------------------------------------------------------------------- #
_PLAN_SYSTEM = (
    "You are a senior data quality analyst planning a deep audit of a data "
    "warehouse. You are given, for each table in scope, its columns (name, "
    "semantic type, existing quality score, sensitivity, whether it already "
    "has a human/LLM functional definition), its row count, and the table's "
    "own definition if one exists. Decide, per table, which columns are worth "
    "deep-checking and which checks to run on each — don't waste checks on "
    "columns unlikely to reveal anything (e.g. skip numeric-outlier checks on "
    "a free-text column). Prioritise columns that are PII, already low "
    "quality, undocumented, or mentioned in the user's focus notes. Use each "
    "table's definition, when present, to judge what 'normal' should look "
    "like for it.\n\n"
    "Available checks and how to use each:\n"
    "- numeric_outliers, categorical_rarity, pattern_consistency: per-column, list the column names.\n"
    "- duplicate_rows: table-level, empty columns list.\n"
    "- cross_column_date_order: table-level. If you see two datetime-like columns where one should "
    "logically never precede the other (e.g. order_date vs delivery_date, created_at vs closed_at), "
    "set date_pairs: [[earlier_column, later_column], ...].\n"
    "- cross_column_null_correlation: table-level. If a categorical/status column implies another "
    "column should be filled in (e.g. status='DELIVERED' implies delivery_date is set), set "
    "null_rules: [{\"trigger_col\": string, \"trigger_value\": string, \"target_col\": string}, ...].\n"
    "- temporal_drift: table-level, only if a clear event-timestamp column exists. Set "
    "temporal_col: string.\n"
    "- multivariate_outlier: table-level. For two numeric columns whose COMBINATION matters more than "
    "either alone (e.g. quantity and unit_price, or amount and duration), set "
    "bivariate_pairs: [[col_a, col_b], ...].\n"
    "- semantic_scan: per column, only for a handful of the most business-critical text/categorical "
    "columns (this one is a real LLM call per column — use it sparingly, at most 2-3 columns total "
    "across the whole plan). Set semantic_columns: [string].\n\n"
    "Only include the extra fields (date_pairs, null_rules, temporal_col, bivariate_pairs, "
    "semantic_columns) on a step that actually uses that check; omit them otherwise.\n"
    "Reply STRICTLY in JSON: {\"steps\": [{\"table\": string (the dataset id, "
    "copied exactly), \"columns\": [string], \"checks\": [string], \"reason\": string, "
    "\"date_pairs\": [[string,string]], \"null_rules\": [{\"trigger_col\":string,\"trigger_value\":string,"
    "\"target_col\":string}], \"temporal_col\": string, \"bivariate_pairs\": [[string,string]], "
    "\"semantic_columns\": [string]}], \"narrative\": string (2-3 sentences on your overall strategy)}."
)


def plan_analysis(tables_info: list[dict[str, Any]], focus_notes: str,
                  thresholds: dict[str, Any], model: str | None = None) -> dict[str, Any]:
    if not llm.is_up():
        raise LLMUnavailable()
    prompt = "Tables in scope:\n"
    for t in tables_info:
        prompt += (f"\n- {t['dataset_id']} ({t['name']}, ~{t['row_estimate']} rows)"
                  f"{' — definition: ' + t['definition'] if t.get('definition') else ' — no definition'}\n")
        for c in t["columns"]:
            prompt += (f"    {c['name']}: {c['semantic_type']}, quality={c['quality_score']}, "
                      f"sensitivity={c['sensitivity']}, has_definition={c['has_definition']}\n")
    if focus_notes.strip():
        prompt += f"\nUser focus notes (pay special attention to these areas): {focus_notes.strip()}\n"
    out = llm.generate(system=_PLAN_SYSTEM, prompt=prompt, model=model, timeout=180.0)
    if not isinstance(out, dict) or "_raw" in out:
        raise LLMUnavailable()
    out.setdefault("steps", [])
    out.setdefault("narrative", "")
    return out


_REFINE_SYSTEM = (
    "You are a senior data quality analyst reviewing the first pass of "
    "results from a deep audit. You are given a summary of the findings so "
    "far. Decide if any result is surprising enough to warrant one focused "
    "follow-up check — e.g. an outlier cluster worth a closer look, or a "
    "rare-value pattern worth checking against a related column. Propose at "
    "most 3 follow-up steps using the same check kinds and step fields as "
    "before (numeric_outliers, categorical_rarity, pattern_consistency, "
    "duplicate_rows, cross_column_date_order, cross_column_null_correlation, "
    "temporal_drift, multivariate_outlier, semantic_scan). If nothing "
    "warrants it, return an empty list — do not invent work for its own sake.\n\n"
    "Separately: if — and ONLY if — a finding is genuinely ambiguous in a way "
    "that only a human with business context could resolve (e.g. an unusual "
    "spike could be a legitimate seasonal event OR a real bug, and knowing "
    "which one changes what you'd investigate next), set clarifying_question "
    "to ONE short, specific question you would ask a data steward. This "
    "should be rare — leave it null for anything a statistical follow-up "
    "check could resolve on its own.\n"
    "Reply STRICTLY in JSON: {\"steps\": [{\"table\": string, \"columns\": "
    "[string], \"checks\": [string], \"reason\": string, \"date_pairs\": "
    "[[string,string]], \"null_rules\": [{\"trigger_col\":string,\"trigger_value\":string,"
    "\"target_col\":string}], \"temporal_col\": string, \"bivariate_pairs\": [[string,string]], "
    "\"semantic_columns\": [string]}], \"reasoning\": string, "
    "\"clarifying_question\": string|null}."
)


def refine_plan(findings: list[dict[str, Any]], model: str | None = None) -> dict[str, Any]:
    if not llm.is_up():
        raise LLMUnavailable()
    if not findings:
        return {"steps": [], "reasoning": "No findings from the first pass — nothing to follow up on.",
               "clarifying_question": None}
    prompt = "Findings so far:\n" + "\n".join(
        f"- [{f['severity']}] {f['table']}" + (f".{f['column']}" if f.get("column") else "") + f": {f['message']}"
        for f in findings[:60])
    out = llm.generate(system=_REFINE_SYSTEM, prompt=prompt, model=model, timeout=120.0)
    if not isinstance(out, dict) or "_raw" in out:
        raise LLMUnavailable()
    out.setdefault("steps", [])
    out.setdefault("reasoning", "")
    out.setdefault("clarifying_question", None)
    return out


_INTERPRET_SYSTEM = (
    "You are a senior data quality analyst writing the findings section of an "
    "executive data quality report for one table. You are given every "
    "statistical finding for that table, each with an index. Write a short "
    "executive summary (2-4 sentences, plain business language) and rank the "
    "findings by how much they'd surprise a human who knows this dataset well "
    "— put anything a quick manual look wouldn't easily catch (e.g. a handful "
    "of outliers buried in thousands of rows, a subtle pattern break, an "
    "unexpected duplicate cluster) ahead of anything obvious. For each "
    "finding you keep, add a one-sentence plain-English explanation of what "
    "it likely means and a concrete suggested next step. You may omit "
    "findings that are truly not worth a reader's attention. Never invent a "
    "finding that isn't in the evidence.\n"
    "If a user clarification is given below, use it to judge which findings are "
    "actually noteworthy — e.g. a spike the user confirms is a known seasonal event "
    "should be downgraded or dropped rather than flagged as risky.\n"
    "Reply STRICTLY in JSON: {\"summary\": string, \"risk_level\": \"low\"|"
    "\"medium\"|\"high\", \"highlights\": [{\"finding_index\": int, "
    "\"explanation\": string, \"suggested_action\": string}]}."
)


def interpret_findings(table_name: str, findings: list[dict[str, Any]], table_definition: str | None,
                       model: str | None = None, clarification: str | None = None) -> dict[str, Any]:
    if not llm.is_up():
        raise LLMUnavailable()
    if not findings:
        return {"summary": f"No anomalies found in {table_name} for the checks run.",
               "risk_level": "low", "highlights": []}
    prompt = f"Table: {table_name}\nDefinition: {table_definition or '(none)'}\n"
    if clarification:
        prompt += f"User clarification: {clarification}\n"
    prompt += "Findings:\n"
    for i, f in enumerate(findings):
        prompt += f"[{i}] [{f['severity']}] {f['kind']}" + (f" on {f['column']}" if f.get("column") else "") + f": {f['message']}\n"
    out = llm.generate(system=_INTERPRET_SYSTEM, prompt=prompt, model=model, timeout=120.0)
    if not isinstance(out, dict) or "_raw" in out:
        raise LLMUnavailable()
    out.setdefault("summary", "")
    out.setdefault("risk_level", "medium")
    out.setdefault("highlights", [])
    return out


def _heuristic_plan(tables_info: list[dict[str, Any]]) -> dict[str, Any]:
    """LLM-offline fallback: check every column with every applicable check."""
    steps = []
    for t in tables_info:
        cols = [c["name"] for c in t["columns"]]
        if cols:
            steps.append({"table": t["dataset_id"], "columns": cols,
                          "checks": ["numeric_outliers", "categorical_rarity", "pattern_consistency"],
                          "reason": "Local LLM offline — heuristic default: every column, every applicable check."})
        steps.append({"table": t["dataset_id"], "columns": [], "checks": ["duplicate_rows"],
                      "reason": "Local LLM offline — heuristic default duplicate-row check."})
    return {"steps": steps, "narrative": "Local LLM was offline — ran every check on every column with default thresholds."}


def _heuristic_interpretation(findings: list[dict[str, Any]]) -> dict[str, Any]:
    high = sum(1 for f in findings if f["severity"] == "high")
    risk = "high" if high > 0 else ("medium" if findings else "low")
    return {
        "summary": f"{len(findings)} finding(s) detected ({high} high severity). Local LLM was offline for interpretation.",
        "risk_level": risk,
        "highlights": [{"finding_index": i, "explanation": "", "suggested_action": ""}
                       for i, _ in enumerate(sorted(findings, key=lambda f: {"high": 0, "medium": 1, "low": 2}[f["severity"]]))],
    }


# --------------------------------------------------------------------------- #
#  Orchestrator — plan → check → refine → check → interpret, in a bg thread   #
# --------------------------------------------------------------------------- #
def run_quality_check(store, run_id: str) -> None:
    def log(level: str, msg: str):
        store.append_quality_run_log(run_id, {"ts": time.time(), "level": level, "message": msg})

    run = store.get_quality_run(run_id)
    if not run:
        return
    conn = store.get_connection(run["connection_id"])
    if not conn:
        store.update_quality_run(run_id, {"status": "error", "error": "connection not found", "finished_at": time.time()})
        return

    scope: dict[str, Any] = run["scope"]
    thresholds: dict[str, Any] = run["thresholds"]
    focus_notes: str = run.get("focus_notes") or ""
    model = conn.get("llm_model")

    store.update_quality_run(run_id, {"status": "running", "phase": "planning", "started_at": time.time()})
    log("agent", "▶ Planning the analysis…")

    try:
        snap = store.snapshot(trim=False)
        ds_by_id = {d["id"]: d for d in snap["datasets"]}
        tables_info = []
        for ds_id, col_scope in scope.items():
            d = ds_by_id.get(ds_id)
            if not d:
                continue
            doc = snap["docs"].get(ds_id, {})
            doc_cols = doc.get("columns") or {}
            cols = [c for c in d["columns"] if not col_scope or c["name"] in col_scope]
            tables_info.append({
                "dataset_id": ds_id, "name": f"{d['schema']}.{d['name']}",
                "row_estimate": d["row_estimate"], "definition": doc.get("definition"),
                "columns": [{"name": c["name"], "semantic_type": c["profile"]["semantic_type"],
                            "quality_score": c["profile"]["quality_score"],
                            "sensitivity": c["profile"]["sensitivity"],
                            "has_definition": bool(doc_cols.get(c["name"], {}).get("definition"))}
                           for c in cols],
            })

        try:
            plan = plan_analysis(tables_info, focus_notes, thresholds, model=model)
        except LLMUnavailable:
            plan = _heuristic_plan(tables_info)
            log("warn", "Local LLM unavailable — using a heuristic plan.")
        store.update_quality_run(run_id, {"plan": plan, "progress": 0.1})
        log("ok", f"Plan ready — {len(plan['steps'])} step(s). {plan.get('narrative', '')}")

        if store.is_quality_run_cancel_requested(run_id):
            log("warn", "⏹ Cancelled by user.")
            store.update_quality_run(run_id, {"status": "cancelled", "finished_at": time.time()})
            return

        store.update_quality_run(run_id, {"phase": "checking"})
        findings_by_table: dict[str, list[dict[str, Any]]] = {}
        total = max(len(plan["steps"]), 1)
        for i, step in enumerate(plan["steps"]):
            if store.is_quality_run_cancel_requested(run_id):
                log("warn", "⏹ Cancelled by user.")
                store.update_quality_run(run_id, {"status": "cancelled", "finished_at": time.time()})
                return
            d = ds_by_id.get(step.get("table"))
            if not d:
                continue
            store.update_quality_run(run_id, {"progress": round(0.1 + 0.5 * i / total, 3)})
            try:
                connector = build_connector({**conn}, store=store, source="quality-check")
                step_findings = execute_step(connector, d, step, thresholds, log, model=model)
                findings_by_table.setdefault(d["id"], []).extend(step_findings)
                log("ok", f"  ✓ {d['name']} — {', '.join(step.get('checks') or [])}: "
                          f"{len(step_findings)} finding(s).")
            except Exception as e:
                log("warn", f"  ✗ {d['name']}: {e}")

        if store.is_quality_run_cancel_requested(run_id):
            log("warn", "⏹ Cancelled by user.")
            store.update_quality_run(run_id, {"status": "cancelled", "finished_at": time.time()})
            return

        store.update_quality_run(run_id, {"phase": "refining", "progress": 0.6})
        all_findings = [f for fs in findings_by_table.values() for f in fs]
        try:
            refine = refine_plan(all_findings, model=model)
        except LLMUnavailable:
            refine = {"steps": [], "reasoning": "", "clarifying_question": None}

        # -- human-in-the-loop: pause once for a genuinely ambiguous finding -- #
        clarification: str | None = None
        question = refine.get("clarifying_question")
        if question:
            log("agent", f"❓ {question}")
            store.update_quality_run(run_id, {
                "status": "waiting_input", "pending_question": question, "question_answer": None})
            waited = 0.0
            while waited < 480:  # up to 8 minutes for a human to respond
                if store.is_quality_run_cancel_requested(run_id):
                    log("warn", "⏹ Cancelled by user.")
                    store.update_quality_run(run_id, {"status": "cancelled", "finished_at": time.time()})
                    return
                answer = store.get_quality_run_answer(run_id)
                if answer:
                    clarification = answer
                    log("ok", f"  ↳ Answer received: {answer}")
                    break
                time.sleep(2)
                waited += 2
            if not clarification:
                log("warn", "  ↳ No response in time — proceeding without a clarification.")
            store.update_quality_run(run_id, {"status": "running", "pending_question": None})

        if refine.get("steps"):
            log("agent", f"▶ Follow-up analysis: {refine.get('reasoning', '')}")
            for step in refine["steps"][:3]:
                d = ds_by_id.get(step.get("table"))
                if not d:
                    continue
                try:
                    connector = build_connector({**conn}, store=store, source="quality-check")
                    step_findings = execute_step(connector, d, step, thresholds, log, model=model)
                    findings_by_table.setdefault(d["id"], []).extend(step_findings)
                    log("ok", f"  ✓ follow-up on {d['name']}: {len(step_findings)} finding(s).")
                except Exception as e:
                    log("warn", f"  ✗ follow-up on {d['name']}: {e}")

        if store.is_quality_run_cancel_requested(run_id):
            log("warn", "⏹ Cancelled by user.")
            store.update_quality_run(run_id, {"status": "cancelled", "finished_at": time.time()})
            return

        store.update_quality_run(run_id, {"phase": "interpreting", "progress": 0.85})
        tables_out = []
        for ds_id, findings in findings_by_table.items():
            d = ds_by_id[ds_id]
            doc = snap["docs"].get(ds_id, {})
            try:
                interp = interpret_findings(f"{d['schema']}.{d['name']}", findings, doc.get("definition"),
                                            model=model, clarification=clarification)
            except LLMUnavailable:
                interp = _heuristic_interpretation(findings)
            tables_out.append({
                "dataset_id": ds_id, "name": f"{d['schema']}.{d['name']}",
                "row_estimate": d["row_estimate"], "findings": findings, "interpretation": interp,
            })
            log("ok", f"  ✓ {d['name']}: report written ({interp.get('risk_level', '?')} risk, {len(findings)} finding(s)).")

        store.update_quality_run(run_id, {
            "status": "done", "finished_at": time.time(), "progress": 1.0,
            "phase": "done", "tables": tables_out,
        })
        log("done", "Analysis complete ✅")
        high_risk = sum(1 for t in tables_out if t["interpretation"].get("risk_level") == "high")
        store.add_notification(
            audience="all", category="quality", kind="warning" if high_risk else "success",
            title="Data quality analysis finished",
            message=f"{conn['name']}: {len(tables_out)} table(s) analysed" +
                    (f", {high_risk} at high risk" if high_risk else ""),
            link={"tab": "quality-checks"})
    except Exception as e:  # pragma: no cover
        log("error", f"Failed: {e}")
        log("error", traceback.format_exc().splitlines()[-1])
        store.update_quality_run(run_id, {"status": "error", "finished_at": time.time(), "error": str(e)})
        store.add_notification(audience="all", category="quality", kind="error",
                               title="Data quality analysis failed",
                               message=f"{conn['name']}: {e}", link={"tab": "quality-checks"})
