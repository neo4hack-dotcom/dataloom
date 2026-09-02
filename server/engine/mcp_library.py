"""
MCP Library — turns an MCP source's raw tool surface into a genuinely
browsable, enrichable inventory: every discovered tool (not just the ones
turned into catalog tables), plus user-submitted code/SQL that the local LLM
reads to describe what a tool's query actually does, which tables/columns it
really touches, and how that lines up (or doesn't) with whatever was already
mapped from a live sample.

Two deterministic (non-LLM) helpers close the loop:
  - match_link_candidates: turns a query's referenced table names into
    concrete cross-connection dataset links the user can accept in one click.
  - coverage_gaps: ranks which discovered tools most need a pasted code/SQL
    definition next, so "maximise data-point coverage" is a queue instead of
    the user having to guess which tool is still a black box.
"""
from __future__ import annotations

from typing import Any

from . import llm


class LLMUnavailable(Exception):
    pass


_EXTRACT_SYSTEM = (
    "You are a data engineer documenting the backend logic behind one MCP "
    "(Model Context Protocol) tool, from the actual SQL query or source code "
    "that implements it. Given the tool's name/description and the pasted "
    "code, extract exactly what a data catalog needs:\n\n"
    "- functional_description: 1-3 plain-English sentences on what this query "
    "or function actually does and what data it returns — written for a "
    "business reader, not a SQL reader.\n"
    "- tables_referenced: every table name you can find in the code (FROM/"
    "JOIN/UPDATE/INSERT INTO, or an ORM model/table reference), each tagged "
    "role='source' (read from) or role='target' (written to).\n"
    "- columns: every output column, with a short plain-English description "
    "and, only if it's computed (not a plain passthrough of a source column), "
    "the expression/logic behind it in source_expression.\n"
    "- column_reconciliation: ONLY if a currently-mapped column list is given "
    "below — for each mapped column say whether the code confirms it "
    "(status='matches'), the code returns a column the mapping missed "
    "(status='only_in_code'), or the mapping has a column absent from the "
    "code (status='only_in_mapping'), with a one-line note explaining why it "
    "matters. Empty list if no mapped columns were given.\n\n"
    "Ground everything in the pasted code — never invent a table or column "
    "that isn't actually referenced there. "
    "Reply STRICTLY in JSON: {\"functional_description\": string, "
    "\"tables_referenced\": [{\"name\": string, \"role\": \"source\"|\"target\"}], "
    "\"columns\": [{\"name\": string, \"description\": string, \"source_expression\": string}], "
    "\"column_reconciliation\": [{\"column\": string, \"status\": string, \"note\": string}]}."
)


def extract_query_info(tool_name: str, tool_description: str, language: str, code: str,
                       mapped_columns: list[str] | None = None,
                       model: str | None = None) -> dict[str, Any]:
    """One LLM call: functional description + referenced tables/columns +
    (when a mapping already exists for this tool) a drift-reconciliation
    pass — catching columns the live sample missed or the mapping invented,
    without a second round trip."""
    if not llm.is_up():
        raise LLMUnavailable()
    prompt = (
        f"MCP tool: {tool_name}\nTool description: {tool_description or '(none)'}\n"
        f"Language: {language}\n\n--- pasted code/query ---\n{code[:6000]}\n--- end ---\n"
    )
    if mapped_columns:
        prompt += f"\nAlready-mapped catalog columns for this tool's table: {', '.join(mapped_columns)}\n"
    out = llm.generate(system=_EXTRACT_SYSTEM, prompt=prompt, model=model, timeout=120.0)
    if not isinstance(out, dict) or "_raw" in out:
        raise LLMUnavailable()
    out.setdefault("functional_description", "")
    out.setdefault("tables_referenced", [])
    out.setdefault("columns", [])
    out.setdefault("column_reconciliation", [])
    return out


def match_link_candidates(snap: dict[str, Any], tables_referenced: list[dict[str, Any]],
                          exclude_connection_id: str) -> list[dict[str, Any]]:
    """Deterministic name-match of a query's referenced tables against every
    OTHER connection's already-cataloged datasets — no LLM — so a pasted SQL
    query's FROM/JOIN list turns into one-click cross-database lineage links."""
    names = [t.get("name", "") for t in tables_referenced if t.get("name")]
    if not names:
        return []
    candidates = []
    for d in snap.get("datasets", []):
        if d["connection_id"] == exclude_connection_id:
            continue
        best = 0.0
        matched = None
        for name in names:
            n = name.strip().lower().split(".")[-1]
            if not n:
                continue
            dn = d["name"].lower()
            score = 1.0 if n == dn else (0.6 if (n in dn or dn in n) else 0.0)
            if score > best:
                best, matched = score, name
        if best > 0:
            candidates.append({
                "dataset_id": d["id"], "label": f"{d['schema']}.{d['name']}",
                "matched_table": matched, "score": best,
            })
    candidates.sort(key=lambda c: -c["score"])
    return candidates[:10]


_READ_HINTS = ("list", "get", "search", "query", "find", "fetch", "read", "show", "describe")


def coverage_gaps(conn: dict[str, Any]) -> list[dict[str, Any]]:
    """Rank discovered tools that have neither a mapped table nor a pasted
    query definition yet — the "what to document next" queue that maximises
    data-point coverage from this MCP source."""
    tools = conn.get("mcp_tools") or []
    mapped_tools = {t.get("tool") for t in ((conn.get("config") or {}).get("mcp_mapping") or {}).get("tables", [])}
    queried_tools = {q.get("tool") for q in (conn.get("mcp_queries") or [])}
    gaps = []
    for t in tools:
        name = t.get("name", "")
        has_mapping = name in mapped_tools
        has_query = name in queried_tools
        if has_mapping and has_query:
            continue
        priority = 0
        if any(h in name.lower() for h in _READ_HINTS):
            priority += 2
        if has_mapping:
            priority += 1  # already a catalog table — a query definition here is a cheap, high-value win
        reason = ("Mapped as a table but no code/SQL evidence yet — add its query for a functional "
                  "description and cross-database lineage." if has_mapping else
                  "Not mapped and no code/SQL evidence yet — paste its query to bring it into the catalog.")
        gaps.append({"tool": name, "description": t.get("description", ""),
                     "has_mapping": has_mapping, "has_query": has_query,
                     "priority": priority, "reason": reason})
    gaps.sort(key=lambda g: -g["priority"])
    return gaps
