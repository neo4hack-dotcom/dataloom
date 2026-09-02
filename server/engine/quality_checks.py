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


# --------------------------------------------------------------------------- #
#  Step execution — runs the checks one plan step asks for                    #
# --------------------------------------------------------------------------- #
def execute_step(connector, dataset: dict[str, Any], step: dict[str, Any],
                 thresholds: dict[str, Any], log: LogFn) -> list[dict[str, Any]]:
    ds_id = dataset["id"]
    checks = step.get("checks") or []
    columns = step.get("columns") or []
    col_by_name = {c["name"]: c for c in dataset["columns"]}
    findings: list[dict[str, Any]] = []

    if "duplicate_rows" in checks:
        try:
            rows = connector.sample_rows(dataset["schema"], dataset["name"],
                                         limit=thresholds.get("row_sample_size", 2000))
            findings.extend(_findings_from_duplicates(ds_id, duplicate_row_stats(rows), thresholds))
        except Exception as e:
            log("warn", f"  duplicate-row check failed on {dataset['name']}: {e}")

    for col_name in columns:
        if col_name not in col_by_name:
            continue
        try:
            values = connector.sample_values(dataset["schema"], dataset["name"], col_name,
                                              limit=thresholds.get("value_sample_size", 3000))
        except Exception as e:
            log("warn", f"  {dataset['name']}.{col_name}: sampling failed: {e}")
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
    "like for it. Available checks: numeric_outliers, categorical_rarity, "
    "pattern_consistency (per column), duplicate_rows (table-level — use an "
    "empty columns list for it).\n"
    "Reply STRICTLY in JSON: {\"steps\": [{\"table\": string (the dataset id, "
    "copied exactly), \"columns\": [string], \"checks\": [string], \"reason\": "
    "string}], \"narrative\": string (2-3 sentences on your overall strategy)}."
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
    "most 3 follow-up steps using the same check kinds as before "
    "(numeric_outliers, categorical_rarity, pattern_consistency, "
    "duplicate_rows). If nothing warrants it, return an empty list — do not "
    "invent work for its own sake.\n"
    "Reply STRICTLY in JSON: {\"steps\": [{\"table\": string, \"columns\": "
    "[string], \"checks\": [string], \"reason\": string}], \"reasoning\": string}."
)


def refine_plan(findings: list[dict[str, Any]], model: str | None = None) -> dict[str, Any]:
    if not llm.is_up():
        raise LLMUnavailable()
    if not findings:
        return {"steps": [], "reasoning": "No findings from the first pass — nothing to follow up on."}
    prompt = "Findings so far:\n" + "\n".join(
        f"- [{f['severity']}] {f['table']}" + (f".{f['column']}" if f.get("column") else "") + f": {f['message']}"
        for f in findings[:60])
    out = llm.generate(system=_REFINE_SYSTEM, prompt=prompt, model=model, timeout=120.0)
    if not isinstance(out, dict) or "_raw" in out:
        raise LLMUnavailable()
    out.setdefault("steps", [])
    out.setdefault("reasoning", "")
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
    "Reply STRICTLY in JSON: {\"summary\": string, \"risk_level\": \"low\"|"
    "\"medium\"|\"high\", \"highlights\": [{\"finding_index\": int, "
    "\"explanation\": string, \"suggested_action\": string}]}."
)


def interpret_findings(table_name: str, findings: list[dict[str, Any]], table_definition: str | None,
                       model: str | None = None) -> dict[str, Any]:
    if not llm.is_up():
        raise LLMUnavailable()
    if not findings:
        return {"summary": f"No anomalies found in {table_name} for the checks run.",
               "risk_level": "low", "highlights": []}
    prompt = f"Table: {table_name}\nDefinition: {table_definition or '(none)'}\nFindings:\n"
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
                step_findings = execute_step(connector, d, step, thresholds, log)
                findings_by_table.setdefault(d["id"], []).extend(step_findings)
                log("ok", f"  ✓ {d['name']} — {', '.join(step.get('checks') or [])}: "
                          f"{len(step_findings)} finding(s).")
            except Exception as e:
                log("warn", f"  ✗ {d['name']}: {e}")

        if store.is_quality_run_cancel_requested(run_id):
            log("warn", "⏹ Cancelled by user.")
            store.update_quality_run(run_id, {"status": "cancelled", "finished_at": time.time()})
            return

        store.update_quality_run(run_id, {"phase": "refining", "progress": 0.65})
        all_findings = [f for fs in findings_by_table.values() for f in fs]
        try:
            refine = refine_plan(all_findings, model=model)
        except LLMUnavailable:
            refine = {"steps": [], "reasoning": ""}
        if refine.get("steps"):
            log("agent", f"▶ Follow-up analysis: {refine.get('reasoning', '')}")
            for step in refine["steps"][:3]:
                d = ds_by_id.get(step.get("table"))
                if not d:
                    continue
                try:
                    connector = build_connector({**conn}, store=store, source="quality-check")
                    step_findings = execute_step(connector, d, step, thresholds, log)
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
                interp = interpret_findings(f"{d['schema']}.{d['name']}", findings, doc.get("definition"), model=model)
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
    except Exception as e:  # pragma: no cover
        log("error", f"Failed: {e}")
        log("error", traceback.format_exc().splitlines()[-1])
        store.update_quality_run(run_id, {"status": "error", "finished_at": time.time(), "error": str(e)})
