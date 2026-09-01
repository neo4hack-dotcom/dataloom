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


def universal_search(q: str, snap: dict, limit: int = 40) -> dict:
    """
    Search across datasets, columns, glossary terms, tags and domains — the
    human-facing /api/search. (lexical_search above stays column-only and
    unchanged since the MCP search_catalog tool's exposure filtering depends
    on every hit carrying dataset_id/column.)

    Returns {"hits": [...], "facets": {type: count}}; each hit has a common
    {type, label, sub, score} shape plus a type-specific id field
    (dataset_id / dataset_id+column / term / tag / domain_id).
    """
    terms = [t for t in re.split(r"\W+", q.lower()) if len(t) >= 2]
    if not terms:
        return {"hits": [], "facets": {}}

    def score(hay: str) -> int:
        hay = hay.lower()
        return sum(hay.count(t) for t in terms)

    hits: list[dict] = []
    docs = snap.get("docs", {})

    for d in snap["datasets"]:
        doc = docs.get(d["id"], {}) or {}
        hay = " ".join([d["name"], d["schema"], doc.get("definition", "") or "",
                        doc.get("domain", "") or "", " ".join(doc.get("tags") or [])])
        s = score(hay)
        if s:
            hits.append({"type": "dataset", "dataset_id": d["id"],
                        "label": f"{d['schema']}.{d['name']}",
                        "sub": doc.get("definition") or doc.get("domain") or "", "score": s})
        for c in d["columns"]:
            cdoc = (doc.get("columns") or {}).get(c["name"], {}) or {}
            hay = " ".join([c["name"], c["profile"]["semantic_type"], cdoc.get("definition", "") or "",
                            " ".join(cdoc.get("tags") or [])])
            s = score(hay)
            if s:
                hits.append({"type": "column", "dataset_id": d["id"], "column": c["name"],
                            "label": f"{d['schema']}.{d['name']}.{c['name']}",
                            "sub": cdoc.get("definition") or c["profile"]["semantic_type"], "score": s})

    for g in snap.get("glossary", []):
        s = score(f"{g['term']} {g.get('definition', '')}")
        if s:
            hits.append({"type": "glossary", "term": g["term"], "label": g["term"],
                        "sub": g.get("definition") or "", "score": s})

    seen_tags: set[str] = set()
    for doc in docs.values():
        seen_tags.update(doc.get("tags") or [])
        for cdoc in (doc.get("columns") or {}).values():
            seen_tags.update(cdoc.get("tags") or [])
    for tag in seen_tags:
        s = score(tag)
        if s:
            hits.append({"type": "tag", "tag": tag, "label": tag, "sub": "Tag", "score": s})

    for dom in snap.get("domains", []):
        s = score(f"{dom['name']} {dom.get('description', '')}")
        if s:
            hits.append({"type": "domain", "domain_id": dom["id"], "label": dom["name"],
                        "sub": dom.get("description") or "Domain", "score": s})

    hits.sort(key=lambda h: -h["score"])
    hits = hits[:limit]
    facets: dict[str, int] = {}
    for h in hits:
        facets[h["type"]] = facets.get(h["type"], 0) + 1
    return {"hits": hits, "facets": facets}
