"""Lexical search over the catalog snapshot — shared by /api/search and the MCP search_catalog tool."""
from __future__ import annotations

import re


def lexical_search(q: str, snap: dict) -> list[dict]:
    terms = [t for t in re.split(r"\W+", q.lower()) if len(t) >= 2]
    results = []
    for d in snap["datasets"]:
        doc = snap["docs"].get(d["id"], {})
        for c in d["columns"]:
            cdoc = (doc.get("columns") or {}).get(c["name"], {})
            hay = " ".join([
                d["name"], d["schema"], c["name"], c["profile"]["semantic_type"],
                cdoc.get("definition", ""), doc.get("definition", ""), doc.get("domain", ""),
            ]).lower()
            score = sum(hay.count(t) for t in terms)
            if score:
                results.append({
                    "dataset_id": d["id"], "dataset": f"{d['schema']}.{d['name']}",
                    "column": c["name"], "semantic_type": c["profile"]["semantic_type"],
                    "sensitivity": c["profile"]["sensitivity"],
                    "quality": c["profile"]["quality_score"],
                    "definition": cdoc.get("definition", ""),
                    "domain": doc.get("domain", ""), "score": score,
                })
    results.sort(key=lambda r: -r["score"])
    return results
