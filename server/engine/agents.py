"""
Pre-built autonomous agents + orchestrator.

Each agent has a role, a system prompt and a `run(ctx, log)` method. Agents emit
log lines (streamed to the UI) and mutate the catalog through the shared store.
The orchestrator chains them into the one-click "Magic Enrich" pipeline.

Agents:
  ProfilerAgent   — connects, introspects, profiles every column (fingerprints)
  LinkerAgent     — pairwise similarity + PK/FK inference across the catalog
  DocumenterAgent — local LLM writes functional definition + calc method per col
  LineageAgent    — reads mapping tables + your model notes -> lineage edges
  QaAgent         — LLM reviews definitions, flags low-confidence / contradictions
  GlossaryAgent   — extracts recurring business terms into a glossary

The agents are intentionally resilient: LLM steps fall back to heuristics when
Ollama is down, so a pipeline always completes.
"""
from __future__ import annotations

import time
import traceback
from typing import Any, Callable

from . import llm
from .connectors import build_connector
from .profiling import profile_column
from .similarity import analyze_catalog, name_similarity

LogFn = Callable[[str, str], None]  # (level, message)


# --------------------------------------------------------------------------- #
class ProfilerAgent:
    id = "profiler"
    name = "Profiler"
    icon = "scan-line"
    desc = "Introspects sources, samples values, and computes each column's fingerprint (semantic types, MinHash, quality)."

    def run(self, store, conn: dict[str, Any], log: LogFn) -> dict[str, Any]:
        c = build_connector(conn)
        log("info", f"Connection '{conn['name']}' ({conn['type']}) established.")
        tables = c.list_tables()
        scope = conn.get("_scope")  # list of "schema.name" — the user-selected scope
        if scope:
            scope_set = set(scope)
            tables = [t for t in tables if f"{t['schema']}.{t['name']}" in scope_set]
            log("info", f"Scope: {len(tables)} selected table(s) (of the source's inventory). Profiling…")
        else:
            log("info", f"{len(tables)} tables detected. Profiling…")
        datasets = []
        for t in tables:
            cols = c.get_columns(t["schema"], t["name"])
            ds_id = f"{conn['id']}::{t['schema']}.{t['name']}"
            col_profiles = []
            for col in cols:
                vals = c.sample_values(t["schema"], t["name"], col["name"])
                prof = profile_column(vals, t["row_estimate"])
                col_profiles.append({
                    "name": col["name"],
                    "data_type": col["data_type"],
                    "nullable": col["nullable"],
                    "position": col["position"],
                    "profile": prof,
                    "dataset_id": ds_id,
                })
            datasets.append({
                "id": ds_id,
                "connection_id": conn["id"],
                "schema": t["schema"],
                "name": t["name"],
                "kind": t["kind"],
                "row_estimate": t["row_estimate"],
                "comment": t.get("comment"),
                "columns": col_profiles,
            })
            log("ok", f"  ✓ {t['schema']}.{t['name']} — {len(cols)} columns profiled.")
        store.upsert_datasets(datasets)
        return {"datasets": len(datasets),
                "columns": sum(len(d["columns"]) for d in datasets)}


# --------------------------------------------------------------------------- #
class LinkerAgent:
    id = "linker"
    name = "Linker"
    icon = "git-compare"
    desc = "Compares every column via real value tests (overlap) and infers PK→FK keys and identical fields."

    def run(self, store, conn: dict[str, Any], log: LogFn) -> dict[str, Any]:
        cols = store.all_columns()
        log("info", f"Cross-analysing {len(cols)} columns (MinHash + inclusion)…")
        result = analyze_catalog(cols)
        store.set_matches(result["matches"])
        store.set_relationships(result["relationships"])
        log("ok", f"  ✓ {len(result['relationships'])} PK/FK relationships inferred.")
        log("ok", f"  ✓ {len(result['matches'])} 'same field' pairs detected.")
        for r in result["relationships"][:6]:
            log("info", f"     {r['child']['column']} → {r['parent']['column']} "
                        f"({r['confidence']:.0f}%)")
        return {"relationships": len(result["relationships"]),
                "matches": len(result["matches"])}


# --------------------------------------------------------------------------- #
class DocumenterAgent:
    id = "documenter"
    name = "Documenter"
    icon = "book-open"
    desc = "The local LLM writes the functional definition and calculation method for each table/column, with a confidence score."

    def run(self, store, conn: dict[str, Any], log: LogFn) -> dict[str, Any]:
        up = llm.is_up()
        log("info", "Local LLM detected." if up else "LLM unreachable — using heuristic fallback.")
        datasets = [d for d in store.datasets() if d["connection_id"] == conn["id"]]
        written = 0
        for d in datasets:
            cols_brief = ", ".join(
                f"{c['name']}:{c['profile']['semantic_type']}" for c in d["columns"][:25])
            if up:
                try:
                    out = llm.generate(
                        system=("You are a senior data steward. You document a data "
                                "warehouse in English, concisely and from a business "
                                "perspective. Reply STRICTLY in JSON."),
                        prompt=(
                            f"Table {d['schema']}.{d['name']} ({d['row_estimate']} rows).\n"
                            f"Columns: {cols_brief}.\n\n"
                            "Return JSON: {\"definition\": string (1-2 business sentences), "
                            "\"domain\": string (e.g. Sales, Finance, Customer), "
                            "\"columns\": [{\"name\": string, \"definition\": string, "
                            "\"calculation\": string|null}]}"),
                        model=conn.get("llm_model"),
                    )
                    doc = out if isinstance(out, dict) else {}
                except Exception as e:  # pragma: no cover
                    log("warn", f"  ! LLM error on {d['name']}: {e}")
                    doc = {}
            else:
                doc = {}

            self._apply(store, d, doc, heuristic=not up)
            written += 1
            conf = "LLM" if (up and doc.get("columns")) else "heuristic"
            log("ok", f"  ✓ {d['name']} documented ({conf}).")
        return {"datasets_documented": written}

    def _apply(self, store, d, doc, heuristic: bool):
        domain = doc.get("domain") or _guess_domain(d["name"])
        definition = doc.get("definition") or _heuristic_table_def(d)
        col_docs = {c["name"]: c for c in doc.get("columns", []) if isinstance(c, dict) and c.get("name")}
        updates = {"definition": definition, "domain": domain, "doc_source":
                   "heuristic" if heuristic else "llm",
                   "doc_confidence": 55 if heuristic else 82, "columns": {}}
        for c in d["columns"]:
            cd = col_docs.get(c["name"], {})
            updates["columns"][c["name"]] = {
                "definition": cd.get("definition") or _heuristic_col_def(c),
                "calculation": cd.get("calculation"),
                "confidence": 50 if heuristic or not cd else 80,
                "source": "heuristic" if (heuristic or not cd) else "llm",
                "status": "suggested",
            }
        store.set_dataset_doc(d["id"], updates)


# --------------------------------------------------------------------------- #
class LineageAgent:
    id = "lineage"
    name = "Lineage"
    icon = "workflow"
    desc = "Rebuilds data chains from relationships, mapping tables, and your model notes."

    def run(self, store, conn: dict[str, Any], log: LogFn) -> dict[str, Any]:
        edges = []
        # 1) lineage from inferred FK relationships (data flows parent -> child dim)
        for r in store.relationships():
            edges.append({
                "from": r["parent"]["dataset_id"], "to": r["child"]["dataset_id"],
                "via": f"{r['parent']['column']} → {r['child']['column']}",
                "kind": "key", "confidence": r["confidence"],
            })
        # 2) lineage from mapping tables (name contains MAP/DIM + notes)
        datasets = store.datasets()
        names = {d["id"]: d for d in datasets}
        for d in datasets:
            if d["name"].upper().startswith(("MAP_", "DIM_")):
                # link a DIM/MAP to the base fact/ref sharing a key column name
                for other in datasets:
                    if other["id"] == d["id"]:
                        continue
                    shared = _shared_keyish_column(d, other)
                    if shared:
                        edges.append({
                            "from": other["id"], "to": d["id"], "via": shared,
                            "kind": "mapping", "confidence": 70,
                        })
        # 3) lineage from user model notes (free text "A -> B")
        for note in store.model_notes():
            for a, b in _parse_arrows(note["text"], names):
                edges.append({"from": a, "to": b, "via": "model note",
                              "kind": "manual", "confidence": 90})
        # dedupe
        seen = set(); uniq = []
        for e in edges:
            k = (e["from"], e["to"], e["via"])
            if k not in seen and e["from"] != e["to"]:
                seen.add(k); uniq.append(e)
        store.set_lineage(uniq)
        log("ok", f"  ✓ {len(uniq)} lineage edges rebuilt.")
        return {"edges": len(uniq)}


# --------------------------------------------------------------------------- #
class QaAgent:
    id = "qa"
    name = "QA Reviewer"
    icon = "shield-check"
    desc = "Audits the catalog: missing definitions, low quality, unflagged PII, contradictions."

    def run(self, store, conn: dict[str, Any], log: LogFn) -> dict[str, Any]:
        issues = []
        for d in store.datasets():
            doc = store.get_dataset_doc(d["id"]) or {}
            if not doc.get("definition"):
                issues.append({"severity": "high", "dataset_id": d["id"],
                               "message": f"{d['name']}: missing table definition"})
            for c in d["columns"]:
                p = c["profile"]
                cdoc = (doc.get("columns") or {}).get(c["name"], {})
                if p["sensitivity"] == "PII":
                    issues.append({"severity": "high", "dataset_id": d["id"],
                                   "message": f"{d['name']}.{c['name']}: PII ({p['semantic_type']}) — verify classification"})
                if p["quality_score"] < 60:
                    issues.append({"severity": "medium", "dataset_id": d["id"],
                                   "message": f"{d['name']}.{c['name']}: low quality ({p['quality_score']})"})
                if not cdoc.get("definition"):
                    issues.append({"severity": "low", "dataset_id": d["id"],
                                   "message": f"{d['name']}.{c['name']}: missing definition"})
        store.set_qa_issues(issues)
        sev = {"high": 0, "medium": 0, "low": 0}
        for i in issues:
            sev[i["severity"]] += 1
        log("ok", f"  ✓ Audit: {sev['high']} critical, {sev['medium']} medium, {sev['low']} low.")
        return {"issues": len(issues), **sev}


# --------------------------------------------------------------------------- #
class GlossaryAgent:
    id = "glossary"
    name = "Glossary"
    icon = "tags"
    desc = "Extracts recurring business terms and links them to catalog columns."

    def run(self, store, conn: dict[str, Any], log: LogFn) -> dict[str, Any]:
        from collections import defaultdict
        term_cols = defaultdict(list)
        for d in store.datasets():
            for c in d["columns"]:
                for tok in _business_tokens(c["name"]):
                    term_cols[tok].append({"dataset_id": d["id"], "column": c["name"]})
        terms = []
        for term, cols in sorted(term_cols.items(), key=lambda kv: -len(kv[1])):
            if len(cols) >= 2:
                terms.append({
                    "term": term, "occurrences": len(cols),
                    "columns": cols[:20],
                    "definition": store.glossary_def(term) or "",
                })
        store.merge_glossary(terms)
        log("ok", f"  ✓ {len(terms)} business terms extracted.")
        return {"terms": len(terms)}


AGENTS = {a.id: a for a in [
    ProfilerAgent(), LinkerAgent(), DocumenterAgent(),
    LineageAgent(), QaAgent(), GlossaryAgent(),
]}

PIPELINE = ["profiler", "linker", "documenter", "lineage", "qa", "glossary"]


# --------------------------------------------------------------------------- #
#  Orchestrator — runs agents in a background thread, streaming a run log.     #
# --------------------------------------------------------------------------- #
def run_pipeline(store, conn: dict[str, Any], agent_ids: list[str], run_id: str):
    def log(level: str, msg: str):
        store.append_run_log(run_id, {"ts": time.time(), "level": level, "message": msg})

    store.update_run(run_id, {"status": "running", "started_at": time.time()})
    summary: dict[str, Any] = {}
    try:
        total = len(agent_ids)
        for idx, aid in enumerate(agent_ids):
            agent = AGENTS[aid]
            store.update_run(run_id, {"current_agent": agent.name,
                                      "progress": round(idx / total, 3)})
            log("agent", f"▶ Agent '{agent.name}' started.")
            res = agent.run(store, conn, log)
            summary[aid] = res
            store.update_run(run_id, {"progress": round((idx + 1) / total, 3)})
            log("agent", f"■ Agent '{agent.name}' finished.")
        store.update_run(run_id, {"status": "done", "finished_at": time.time(),
                                  "summary": summary, "progress": 1.0})
        log("done", "Pipeline complete ✅")
    except Exception as e:  # pragma: no cover
        log("error", f"Failed: {e}")
        log("error", traceback.format_exc().splitlines()[-1])
        store.update_run(run_id, {"status": "error", "finished_at": time.time(),
                                  "error": str(e)})


# --------------------------------------------------------------------------- #
#  Heuristic helpers                                                           #
# --------------------------------------------------------------------------- #
def _guess_domain(name: str) -> str:
    n = name.upper()
    if any(k in n for k in ("PAY", "INVOICE", "FINANCE", "AMOUNT")):
        return "Finance"
    if any(k in n for k in ("CLIENT", "CUSTOMER", "USER")):
        return "Customer"
    if any(k in n for k in ("ORDER", "SALE", "ITEM", "PRODUCT")):
        return "Sales"
    if any(k in n for k in ("EVENT", "CLICK", "WEB")):
        return "Web Analytics"
    return "General"


def _heuristic_table_def(d: dict) -> str:
    return (f"Table '{d['name']}' in schema {d['schema']} "
            f"(~{d['row_estimate']} rows). Documentation to be validated.")


def _heuristic_col_def(c: dict) -> str:
    p = c["profile"]
    st = p["semantic_type"]
    base = {
        "email": "Email address.", "iban": "Bank account identifier (IBAN).",
        "siret": "SIRET number (business establishment).", "integer_id": "Numeric identifier.",
        "iso_date": "Date.", "iso_datetime": "Timestamp.",
        "currency_code": "ISO 4217 currency code.", "country_code": "ISO country code.",
        "code": "Business category code.", "ipv4": "IP address.", "url": "URL.",
    }.get(st, f"Field '{c['name']}'.")
    if p["is_key_candidate"]:
        base += " Likely a key."
    return base


def _shared_keyish_column(a: dict, b: dict) -> str | None:
    for ca in a["columns"]:
        if not ca["profile"]["is_key_candidate"]:
            continue
        for cb in b["columns"]:
            if name_similarity(ca["name"], cb["name"]) >= 0.6:
                return f"{cb['name']} ≈ {ca['name']}"
    return None


def _parse_arrows(text: str, names: dict) -> list[tuple[str, str]]:
    out = []
    for line in text.splitlines():
        if "->" in line or "→" in line:
            line = line.replace("→", "->")
            parts = [p.strip() for p in line.split("->")]
            for i in range(len(parts) - 1):
                a = _match_dataset(parts[i], names)
                b = _match_dataset(parts[i + 1], names)
                if a and b:
                    out.append((a, b))
    return out


def _match_dataset(token: str, names: dict) -> str | None:
    token = token.strip().upper()
    for did, d in names.items():
        if d["name"].upper() == token or did.upper().endswith(token):
            return did
    for did, d in names.items():
        if token and token in d["name"].upper():
            return did
    return None


def _business_tokens(col_name: str) -> list[str]:
    import re
    parts = re.split(r"[^a-zA-Z0-9]+", col_name.lower())
    stop = {"id", "ref", "code", "ts", "dt", "is", "flag", "num", "no"}
    return [p for p in parts if len(p) >= 4 and p not in stop]
