"""
Guided exploration engine — 5 local-LLM features for fast, accurate cataloguing.

Design principle (accuracy): every LLM call is *grounded* in the real profiled
evidence of a column — semantic type, top values, format masks, distinct/null
ratios, numeric stats, neighbour columns (MinHash matches & inferred FKs) and the
surrounding table context. The model is told to rely ONLY on that evidence and to
cite which signals it used, so suggestions are verifiable rather than hallucinated.

Features:
  1. suggest_column      — evidence-grounded definition / calc / type / PII + confidence + cited evidence
  2. document_table      — one call documents every column of a table (batch review)
  3. copilot             — conversational Q&A grounded in the catalog (RAG)
  4. completion_queue    — prioritised "next best action" gaps to close (impact-ranked)
  5. explain_relationship— plain-business meaning + cardinality of an inferred link

All functions degrade gracefully: if the LLM is down they raise LLMUnavailable
and the API returns a heuristic fallback so the app stays usable offline.
"""
from __future__ import annotations

from typing import Any
from . import llm


class LLMUnavailable(Exception):
    pass


# --------------------------------------------------------------------------- #
#  Evidence builder — the heart of the accuracy story                         #
# --------------------------------------------------------------------------- #
def _find_dataset(snap: dict, ds_id: str) -> dict | None:
    return next((d for d in snap["datasets"] if d["id"] == ds_id), None)


def _find_column(ds: dict, col: str) -> dict | None:
    return next((c for c in ds["columns"] if c["name"] == col), None)


def column_evidence(snap: dict, ds_id: str, col_name: str) -> dict[str, Any]:
    """Assemble all real, profiled signals for one column into a compact dict."""
    ds = _find_dataset(snap, ds_id)
    if not ds:
        raise ValueError(f"dataset {ds_id} not found")
    col = _find_column(ds, col_name)
    if not col:
        raise ValueError(f"column {col_name} not found")
    p = col["profile"]

    # neighbour columns: same-field matches + FK relationships involving this column
    neighbours: list[str] = []
    for m in snap.get("matches", []):
        if m["a"]["dataset_id"] == ds_id and m["a"]["column"] == col_name:
            neighbours.append(f"{_short(m['b']['dataset_id'])}.{m['b']['column']} (value overlap {m['confidence']:.0f}%)")
        elif m["b"]["dataset_id"] == ds_id and m["b"]["column"] == col_name:
            neighbours.append(f"{_short(m['a']['dataset_id'])}.{m['a']['column']} (value overlap {m['confidence']:.0f}%)")
    for r in snap.get("relationships", []):
        if r["child"]["dataset_id"] == ds_id and r["child"]["column"] == col_name:
            neighbours.append(f"FK → {_short(r['parent']['dataset_id'])}.{r['parent']['column']}")
        elif r["parent"]["dataset_id"] == ds_id and r["parent"]["column"] == col_name:
            neighbours.append(f"PK ← {_short(r['child']['dataset_id'])}.{r['child']['column']}")

    return {
        "table": f"{ds['schema']}.{ds['name']}",
        "table_definition": (snap.get("docs", {}).get(ds_id, {}) or {}).get("definition", ""),
        "sibling_columns": [c["name"] for c in ds["columns"] if c["name"] != col_name][:30],
        "column": col_name,
        "data_type": col["data_type"],
        "nullable": col["nullable"],
        "semantic_type": p["semantic_type"],
        "is_key_candidate": p["is_key_candidate"],
        "distinct_ratio": p["distinct_ratio"],
        "null_ratio": p["null_ratio"],
        "numeric": p.get("numeric"),
        "top_values": [tv["value"] for tv in p.get("top_values", [])[:8]],
        "format_masks": [fm["mask"] for fm in p.get("format_masks", [])[:3]],
        "sensitivity": p["sensitivity"],
        "quality_score": p["quality_score"],
        "neighbours": neighbours[:6],
    }


def _short(ds_id: str) -> str:
    return ds_id.split("::")[-1]


def _evidence_block(ev: dict) -> str:
    lines = [
        f"Table: {ev['table']}" + (f" — {ev['table_definition']}" if ev['table_definition'] else ""),
        f"Column: {ev['column']}  (declared type: {ev['data_type']}, nullable: {ev['nullable']})",
        f"Detected semantic type: {ev['semantic_type']}",
        f"Distinct ratio: {ev['distinct_ratio']:.2f}  |  Null ratio: {ev['null_ratio']:.2f}  |  Key candidate: {ev['is_key_candidate']}",
        f"Current sensitivity flag: {ev['sensitivity']}",
    ]
    if ev["numeric"]:
        n = ev["numeric"]
        lines.append(f"Numeric range: min={n['min']} max={n['max']} mean={n['mean']}")
    if ev["top_values"]:
        lines.append("Sample values: " + ", ".join(str(v) for v in ev["top_values"]))
    if ev["format_masks"]:
        lines.append("Format patterns (d=digit, a=letter): " + ", ".join(ev["format_masks"]))
    if ev["neighbours"]:
        lines.append("Linked columns in other tables: " + "; ".join(ev["neighbours"]))
    if ev["sibling_columns"]:
        lines.append("Other columns in same table: " + ", ".join(ev["sibling_columns"][:20]))
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
#  Feature 1 — Evidence-grounded column suggestion                            #
# --------------------------------------------------------------------------- #
_SUGGEST_SYSTEM = (
    "You are a senior data steward documenting a data warehouse. You are given the "
    "REAL profiled evidence of a single column (sampled values, format patterns, "
    "cardinality, links to other tables). Infer its business meaning from THIS "
    "evidence only — never invent facts not supported by the signals. "
    "Reply STRICTLY in JSON: {"
    "\"definition\": \"1-2 sentence business definition\", "
    "\"calculation\": \"derivation/formula if it is a computed/measure column, else null\", "
    "\"semantic_type\": \"one of: integer_id, email, iban, siret, ipv4, url, phone, "
    "iso_date, iso_datetime, currency_code, country_code, code, boolean, free_text, unknown\", "
    "\"sensitivity\": \"PII | INTERNAL | PUBLIC\", "
    "\"confidence\": 0-100, "
    "\"evidence\": [\"short bullet citing which signal supports the definition\"]}. "
    "PII rule: anything identifying a person — email, phone, full name, postal address, "
    "IBAN/bank, SIRET/SIREN, national id, IP address — MUST be sensitivity=PII. "
    "Write in English. Be concise and specific to this column."
)


def suggest_column(snap: dict, ds_id: str, col_name: str, model: str | None = None) -> dict[str, Any]:
    if not llm.is_up():
        raise LLMUnavailable()
    ev = column_evidence(snap, ds_id, col_name)
    out = llm.generate(system=_SUGGEST_SYSTEM, prompt=_evidence_block(ev), model=model)
    if not isinstance(out, dict) or "_raw" in out:
        raise LLMUnavailable()
    out.setdefault("definition", "")
    out.setdefault("calculation", None)
    out.setdefault("semantic_type", ev["semantic_type"])
    out.setdefault("sensitivity", ev["sensitivity"])
    out.setdefault("confidence", 70)
    out.setdefault("evidence", [])
    out["_evidence_used"] = ev
    return out


# --------------------------------------------------------------------------- #
#  Feature 2 — Auto-document a whole table in one call                        #
# --------------------------------------------------------------------------- #
_TABLE_SYSTEM = (
    "You are a senior data steward. You receive the profiled evidence of every column "
    "of one table. Produce a concise business definition for the table and for EACH "
    "column, grounded strictly in the evidence. "
    "Reply STRICTLY in JSON: {"
    "\"table_definition\": \"1-2 sentences\", "
    "\"domain\": \"one of: Sales, Finance, Customer, Product, Web Analytics, Operations, Reference, Other\", "
    "\"columns\": [{\"name\": \"...\", \"definition\": \"...\", "
    "\"calculation\": null, \"sensitivity\": \"PII|INTERNAL|PUBLIC\", \"confidence\": 0-100}]}. "
    "English, concise."
)


def document_table(snap: dict, ds_id: str, model: str | None = None) -> dict[str, Any]:
    if not llm.is_up():
        raise LLMUnavailable()
    ds = _find_dataset(snap, ds_id)
    if not ds:
        raise ValueError("dataset not found")
    blocks = []
    for c in ds["columns"]:
        ev = column_evidence(snap, ds_id, c["name"])
        blocks.append(_evidence_block(ev))
    prompt = (f"Table {ds['schema']}.{ds['name']} ({ds['row_estimate']} rows).\n\n"
              "Per-column evidence:\n\n" + "\n---\n".join(blocks))
    out = llm.generate(system=_TABLE_SYSTEM, prompt=prompt, model=model, timeout=180.0)
    if not isinstance(out, dict) or "_raw" in out:
        raise LLMUnavailable()
    out.setdefault("table_definition", "")
    out.setdefault("domain", "Other")
    out.setdefault("columns", [])
    return out


# --------------------------------------------------------------------------- #
#  Feature 3 — Catalog Copilot (conversational RAG)                           #
# --------------------------------------------------------------------------- #
_COPILOT_SYSTEM = (
    "You are DataLoom Copilot, an assistant embedded in a data catalog. Answer the "
    "user's question about their data warehouse using ONLY the catalog context "
    "provided (tables, columns, semantic types, definitions, relationships). If the "
    "answer is not in the context, say so plainly. Be concise, factual and helpful. "
    "When you reference a column, use the form TABLE.column. Plain text, no markdown headers."
)


def copilot(snap: dict, question: str, history: list[dict] | None = None,
            model: str | None = None) -> dict[str, Any]:
    if not llm.is_up():
        raise LLMUnavailable()
    context = _catalog_context(snap, question)
    convo = ""
    for h in (history or [])[-6:]:
        role = "User" if h.get("role") == "user" else "Assistant"
        convo += f"{role}: {h.get('content','')}\n"
    prompt = (f"Catalog context:\n{context}\n\n"
              f"{convo}User: {question}\nAssistant:")
    answer = llm.complete_text(system=_COPILOT_SYSTEM, prompt=prompt, model=model)
    cited = _cited_columns(snap, answer)
    return {"answer": answer, "cited": cited}


def _catalog_context(snap: dict, question: str, limit: int = 40) -> str:
    """Lexical-rank columns by overlap with the question, format the top ones."""
    import re
    terms = [t for t in re.split(r"\W+", question.lower()) if len(t) >= 3]
    scored = []
    for d in snap["datasets"]:
        doc = snap.get("docs", {}).get(d["id"], {}) or {}
        for c in d["columns"]:
            cdoc = (doc.get("columns") or {}).get(c["name"], {})
            hay = f"{d['name']} {c['name']} {c['profile']['semantic_type']} {cdoc.get('definition','')} {doc.get('definition','')}".lower()
            score = sum(hay.count(t) for t in terms) or (1 if not terms else 0)
            scored.append((score, d, c, cdoc, doc))
    scored.sort(key=lambda x: -x[0])
    lines = []
    for score, d, c, cdoc, doc in scored[:limit]:
        defn = cdoc.get("definition") or ""
        lines.append(f"- {d['schema']}.{d['name']}.{c['name']} [{c['profile']['semantic_type']}]"
                     + (f": {defn}" if defn else ""))
    # add relationships summary
    rels = snap.get("relationships", [])[:15]
    if rels:
        lines.append("\nRelationships:")
        for r in rels:
            lines.append(f"- {_short(r['child']['dataset_id'])}.{r['child']['column']} → "
                         f"{_short(r['parent']['dataset_id'])}.{r['parent']['column']}")
    return "\n".join(lines)


def _cited_columns(snap: dict, answer: str) -> list[dict]:
    cited = []
    for d in snap["datasets"]:
        for c in d["columns"]:
            token = f"{d['name']}.{c['name']}"
            if token.lower() in answer.lower():
                cited.append({"dataset_id": d["id"], "column": c["name"]})
    return cited[:12]


# --------------------------------------------------------------------------- #
#  Feature 4 — Next-Best-Action completion queue (impact-ranked gaps)         #
# --------------------------------------------------------------------------- #
def completion_queue(snap: dict, limit: int = 40) -> list[dict[str, Any]]:
    """
    Rank catalog gaps by impact so the user always works the highest-value item
    first. Pure deterministic scoring (instant, no LLM) — each item deep-links to
    its column and exposes a one-click action the LLM features can fulfil.
    """
    docs = snap.get("docs", {})
    items: list[dict[str, Any]] = []
    for d in snap["datasets"]:
        doc = docs.get(d["id"], {}) or {}
        cols_doc = doc.get("columns") or {}
        # table-level gap
        if not doc.get("definition"):
            items.append({
                "kind": "table_undocumented", "dataset_id": d["id"], "column": None,
                "label": f"{d['schema']}.{d['name']} has no table definition",
                "action": "document_table", "impact": 60 + min(len(d["columns"]), 20),
            })
        for c in d["columns"]:
            p = c["profile"]
            cdoc = cols_doc.get(c["name"], {})
            documented = bool(cdoc.get("definition"))
            score = 0
            reasons = []
            if not documented:
                score += 30; reasons.append("undocumented")
            if p["is_key_candidate"] and not documented:
                score += 30; reasons.append("key column")
            if p["sensitivity"] == "PII" and cdoc.get("status") != "validated":
                score += 35; reasons.append("PII to confirm")
            if p["semantic_type"] == "unknown" and not documented:
                score += 15; reasons.append("unknown type")
            if p["quality_score"] < 60:
                score += 10; reasons.append("low quality")
            if documented and (cdoc.get("confidence", 100) < 60):
                score += 12; reasons.append("low-confidence doc")
            if score == 0:
                continue
            items.append({
                "kind": "column_gap", "dataset_id": d["id"], "column": c["name"],
                "label": f"{d['name']}.{c['name']} — {', '.join(reasons)}",
                "reasons": reasons, "action": "suggest_column", "impact": score,
            })
    # ambiguous matches worth confirming
    for i, m in enumerate(snap.get("matches", [])):
        if 55 <= m["confidence"] < 80:
            items.append({
                "kind": "match_ambiguous", "match_index": i,
                "dataset_id": m["a"]["dataset_id"], "column": m["a"]["column"],
                "label": f"Is {_short(m['a']['dataset_id'])}.{m['a']['column']} the same as "
                         f"{_short(m['b']['dataset_id'])}.{m['b']['column']}? ({m['confidence']:.0f}%)",
                "action": "review_match", "impact": 40,
            })
    items.sort(key=lambda x: -x["impact"])
    return items[:limit]


# --------------------------------------------------------------------------- #
#  Feature 5 — Relationship semantics explainer                               #
# --------------------------------------------------------------------------- #
_REL_SYSTEM = (
    "You are a data modeller. Given two columns linked by an inferred foreign key, "
    "and their profiled evidence, explain the relationship in plain business language "
    "and state the cardinality. "
    "Reply STRICTLY in JSON: {"
    "\"meaning\": \"one business sentence, e.g. 'Each order belongs to one customer'\", "
    "\"cardinality\": \"one-to-one | one-to-many | many-to-one | many-to-many\", "
    "\"confidence\": 0-100, \"caveats\": [\"optional short note\"]}. English."
)


def explain_relationship(snap: dict, child_ds: str, child_col: str,
                         parent_ds: str, parent_col: str, model: str | None = None) -> dict[str, Any]:
    if not llm.is_up():
        raise LLMUnavailable()
    child_ev = column_evidence(snap, child_ds, child_col)
    parent_ev = column_evidence(snap, parent_ds, parent_col)
    prompt = (
        "CHILD column (the foreign key):\n" + _evidence_block(child_ev) +
        "\n\nPARENT column (the primary key it references):\n" + _evidence_block(parent_ev) +
        f"\n\nNote: child distinct ratio={child_ev['distinct_ratio']:.2f} "
        f"(lower ⇒ many child rows share a value), parent is key candidate={parent_ev['is_key_candidate']}."
    )
    out = llm.generate(system=_REL_SYSTEM, prompt=prompt, model=model)
    if not isinstance(out, dict) or "_raw" in out:
        raise LLMUnavailable()
    out.setdefault("meaning", "")
    out.setdefault("cardinality", "many-to-one")
    out.setdefault("confidence", 70)
    out.setdefault("caveats", [])
    return out
