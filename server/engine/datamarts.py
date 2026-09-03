"""
Datamarts — identifying and mapping calculated/derived tables that feed
reports and dashboards, so a user tracing "what's behind this report" can
find the datamart, and behind it, the raw source tables that feed it.

A datamart is just a regular catalog dataset carrying the reserved
"datamart" tag, plus optional metadata (its generation SQL/code and an
LLM extraction of that SQL) stored on its doc. Two ways to identify one:

  - Manual: mark any existing table as a datamart, optionally pasting its
    generation SQL — see set_dataset_datamart's call site in main.py, which
    reuses engine.mcp_library.extract_query_info (the exact same "read this
    SQL, tell me what it does and which tables it touches" primitive already
    built for MCP Library, since it's the same problem).
  - Automatic: point at a REGISTRY table — a table that already lists every
    datamart with its metadata (a common pattern: a "data catalog" or
    "report inventory" table maintained by the BI team) — and this module
    detects which column holds the datamart's name and which holds its
    generation SQL, then extracts + tags + links every row in one pass.
"""
from __future__ import annotations

import json
import time
from typing import Any

from . import llm
from .mcp_library import extract_query_info, LLMUnavailable  # noqa: F401 (re-exported)


_REGISTRY_ROLES_SYSTEM = (
    "You analyse a REGISTRY table that lists datamarts — calculated/derived tables that feed "
    "reports and dashboards — one datamart per row. Given the table's column names and sample "
    "values, identify which column holds each role.\n"
    "- name_col: the datamart's table or report name (required).\n"
    "- sql_col: the SQL query or code that generates/defines it (required).\n"
    "- description_col: a functional description of the datamart, if a column holds one (optional).\n"
    "- schema_col: the datamart's schema/namespace, if a column holds one (optional).\n"
    "Reply STRICTLY in JSON: {\"roles\": {\"name_col\": string, \"sql_col\": string, "
    "\"description_col\": string|null, \"schema_col\": string|null}, \"confidence\": 0-100, "
    "\"reason\": \"one short sentence\"}. Use EXACT column names from the input."
)


def detect_registry_roles(dataset: dict[str, Any], sample_rows: list[dict[str, Any]],
                          model: str | None = None) -> dict[str, Any]:
    if not llm.is_up():
        raise LLMUnavailable()
    cols = [c["name"] for c in dataset["columns"]]
    prompt = (f"Registry table {dataset['schema']}.{dataset['name']}.\nColumns: {', '.join(cols)}\n\n"
             f"Sample rows (JSON):\n{json.dumps(sample_rows[:8], ensure_ascii=False, default=str)[:2500]}")
    out = llm.generate(system=_REGISTRY_ROLES_SYSTEM, prompt=prompt, model=model, timeout=120.0)
    if not isinstance(out, dict) or "_raw" in out:
        raise LLMUnavailable()
    out.setdefault("roles", {})
    out.setdefault("confidence", 60)
    out.setdefault("reason", "")
    return out


def match_source_tables(snap: dict[str, Any], tables_referenced: list[dict[str, Any]],
                        exclude_ds_id: str) -> list[dict[str, Any]]:
    """Deterministic name-match of a datamart's referenced tables against every
    OTHER dataset in the catalog — including ones in the SAME connection,
    unlike the MCP Library matcher, since a datamart's raw sources usually
    live right next to it in the same warehouse."""
    names = [t.get("name", "") for t in tables_referenced if t.get("name")]
    if not names:
        return []
    candidates = []
    for d in snap.get("datasets", []):
        if d["id"] == exclude_ds_id:
            continue
        best, matched = 0.0, None
        for name in names:
            n = name.strip().lower().split(".")[-1]
            if not n:
                continue
            dn = d["name"].lower()
            score = 1.0 if n == dn else (0.6 if (n in dn or dn in n) else 0.0)
            if score > best:
                best, matched = score, name
        if best > 0:
            candidates.append({"dataset_id": d["id"], "label": f"{d['schema']}.{d['name']}",
                               "matched_table": matched, "score": best})
    candidates.sort(key=lambda c: -c["score"])
    return candidates[:10]


def import_registry(store, registry_ds: dict[str, Any], roles: dict[str, str | None], conn: dict[str, Any],
                    limit: int = 50, model: str | None = None) -> dict[str, Any]:
    """Bulk-creates/tags datamarts from every row of a registry table.

    Each row that resolves a name + SQL becomes one datamart: matched against
    an existing dataset by name if one exists, else created as a lightweight
    manual placeholder so it's visible in the catalog even if its physical
    table was never connected/profiled. Only exact-name link matches are
    auto-linked as lineage edges — a bulk pass stays safe by only acting on
    its most confident signal; lower-confidence candidates are still saved on
    the datamart for a human to review and link from its Identity Card.
    """
    from .connectors import build_connector  # local import avoids a circular import at module load

    connector = build_connector(conn, store=store, source="datamart-registry")
    rows = connector.sample_rows(registry_ds["schema"], registry_ds["name"], limit=limit)
    name_col, sql_col = roles.get("name_col"), roles.get("sql_col")
    desc_col, schema_col = roles.get("description_col"), roles.get("schema_col")

    processed = created = matched_existing = edges_added = failed = 0
    for row in rows:
        name, sql = row.get(name_col) if name_col else None, row.get(sql_col) if sql_col else None
        if not name or not sql:
            continue
        processed += 1
        snap = store.snapshot()
        by_name = {d["name"].upper(): d for d in snap["datasets"]}
        target = by_name.get(str(name).strip().upper())
        if target:
            matched_existing += 1
        else:
            schema = str(row.get(schema_col) or "DATAMART").strip().upper() if schema_col else "DATAMART"
            desc = str(row.get(desc_col) or "") if desc_col else ""
            target = store.add_manual_dataset(schema, str(name).strip().upper(), registry_ds["connection_id"], comment=desc)
            created += 1
        ds_id = target["id"]
        try:
            extraction = extract_query_info(str(name), str(row.get(desc_col) or "") if desc_col else "",
                                            "sql", str(sql), model=model)
        except LLMUnavailable:
            failed += 1
            continue
        snap = store.snapshot()
        extraction["link_candidates"] = match_source_tables(snap, extraction.get("tables_referenced", []), ds_id)
        store.set_dataset_datamart(ds_id, {
            "sql": str(sql), "language": "sql", "extraction": extraction,
            "analyzed_at": time.time(), "registry_dataset_id": registry_ds["id"],
        })
        for cand in extraction["link_candidates"]:
            if cand["score"] >= 1.0:
                store.add_lineage_edge({"from": cand["dataset_id"], "to": ds_id,
                                        "via": cand["matched_table"], "kind": "datamart", "confidence": 90})
                edges_added += 1

    return {"processed": processed, "created": created, "matched_existing": matched_existing,
           "edges_added": edges_added, "failed": failed}
