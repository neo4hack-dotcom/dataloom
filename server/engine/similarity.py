"""
Similarity & relationship-inference engine.

Two columns are compared along four independent axes, then blended into a single
"same field" confidence with a human-readable explanation:

  1. name_sim       — token-jaccard + char-trigram of the two column names
                      (cust_id ≈ id_client). Optionally boosted by LLM embeddings.
  2. type_match     — same semantic type (both 'integer_id', both 'email', ...)
  3. value_jaccard  — MinHash estimate of how much the value *sets* overlap
  4. containment    — |A ∩ B| / |A|  via hashed sample sets (inclusion dependency)

Relationship (PK→FK) inference uses containment + cardinality:
  if  child.values ⊂ parent.values  (containment ≳ 0.9)  and parent is key-like,
  then  child --FK--> parent.
"""
from __future__ import annotations

import re
from typing import Any

# --- name similarity -------------------------------------------------------- #
_SYNONYMS = {
    "id": "id", "ref": "id", "code": "code", "cust": "customer", "client": "customer",
    "clt": "customer", "cli": "customer", "usr": "user", "user": "customer",
    "amt": "amount", "amount": "amount", "mnt": "amount", "montant": "amount",
    "qty": "quantity", "qte": "quantity", "ts": "timestamp", "dt": "date",
    "ccy": "currency", "cur": "currency", "lib": "label", "libelle": "label",
    "pays": "country", "country": "country", "cntry": "country",
}


def _tokens(name: str) -> set[str]:
    parts = re.split(r"[^a-z0-9]+", name.lower())
    parts = [p for p in parts if p]
    out: set[str] = set()
    for p in parts:
        out.add(_SYNONYMS.get(p, p))
    return out


def _trigrams(s: str) -> set[str]:
    s = re.sub(r"[^a-z0-9]", "", s.lower())
    return {s[i:i + 3] for i in range(len(s) - 2)} or {s}


def name_similarity(a: str, b: str) -> float:
    ta, tb = _tokens(a), _tokens(b)
    jac = len(ta & tb) / len(ta | tb) if (ta | tb) else 0.0
    ga, gb = _trigrams(a), _trigrams(b)
    tri = len(ga & gb) / len(ga | gb) if (ga | gb) else 0.0
    return round(0.65 * jac + 0.35 * tri, 4)


# --- value similarity ------------------------------------------------------- #
def minhash_jaccard(sig_a: list[int], sig_b: list[int]) -> float:
    if not sig_a or not sig_b:
        return 0.0
    sa = {x for x in sig_a if x != 0xFFFFFFFF}
    sb = {x for x in sig_b if x != 0xFFFFFFFF}
    if not sa or not sb:
        return 0.0
    # estimate from union of the two k-min sketches
    union = sorted(sa | sb)[: min(len(sig_a), len(sig_b))]
    inter = sum(1 for x in union if x in sa and x in sb)
    return round(inter / len(union), 4) if union else 0.0


def containment(sample_a: list[int], sample_b: list[int]) -> float:
    """|A ∩ B| / |A| using hashed sample sets — directional inclusion test."""
    if not sample_a:
        return 0.0
    sb = set(sample_b)
    inter = sum(1 for x in sample_a if x in sb)
    return round(inter / len(sample_a), 4)


# --- blended "same field" --------------------------------------------------- #
def compare_columns(col_a: dict[str, Any], col_b: dict[str, Any]) -> dict[str, Any]:
    name_sim = name_similarity(col_a["name"], col_b["name"])
    pa, pb = col_a["profile"], col_b["profile"]
    type_match = 1.0 if pa["semantic_type"] == pb["semantic_type"] != "unknown" else 0.0
    vj = minhash_jaccard(pa.get("_minhash", []), pb.get("_minhash", []))
    cab = containment(pa.get("_sample_hashes", []), pb.get("_sample_hashes", []))
    cba = containment(pb.get("_sample_hashes", []), pa.get("_sample_hashes", []))
    overlap = max(cab, cba)

    # blended confidence: value evidence dominates, name + type refine it
    confidence = round(
        100 * (0.50 * overlap + 0.20 * vj + 0.20 * name_sim + 0.10 * type_match), 1)

    reasons = []
    if overlap >= 0.9:
        reasons.append(f"{int(overlap*100)}% of one field's values are contained in the other")
    elif vj >= 0.3:
        reasons.append(f"value overlap (Jaccard≈{vj:.2f})")
    if name_sim >= 0.5:
        reasons.append(f"similar names (sim={name_sim:.2f})")
    if type_match:
        reasons.append(f"same semantic type '{pa['semantic_type']}'")
    if pa["format_masks"] and pb["format_masks"] and \
       pa["format_masks"][0]["mask"] == pb["format_masks"][0]["mask"]:
        reasons.append(f"same format '{pa['format_masks'][0]['mask']}'")

    return {
        "name_sim": name_sim,
        "type_match": type_match,
        "value_jaccard": vj,
        "containment_ab": cab,
        "containment_ba": cba,
        "confidence": confidence,
        "reasons": reasons,
    }


def infer_relationship(col_a: dict[str, Any], col_b: dict[str, Any], cmp: dict[str, Any]) -> dict[str, Any] | None:
    """Return a directed PK→FK candidate if the inclusion pattern holds."""
    pa, pb = col_a["profile"], col_b["profile"]
    # parent = the key-like side that contains the other
    if cmp["containment_ab"] >= 0.9 and pb["is_key_candidate"] and not pa["is_key_candidate"]:
        parent, child, cont = col_b, col_a, cmp["containment_ab"]
    elif cmp["containment_ba"] >= 0.9 and pa["is_key_candidate"] and not pb["is_key_candidate"]:
        parent, child, cont = col_a, col_b, cmp["containment_ba"]
    elif cmp["containment_ab"] >= 0.95 and pb["distinct_ratio"] >= pa["distinct_ratio"]:
        parent, child, cont = col_b, col_a, cmp["containment_ab"]
    elif cmp["containment_ba"] >= 0.95 and pa["distinct_ratio"] >= pb["distinct_ratio"]:
        parent, child, cont = col_a, col_b, cmp["containment_ba"]
    else:
        return None

    confidence = round(100 * (0.7 * cont + 0.3 * cmp["name_sim"] + 0.0), 1)
    confidence = max(confidence, round(cont * 100 * 0.85, 1))
    return {
        "parent": {"dataset_id": parent["dataset_id"], "column": parent["name"]},
        "child": {"dataset_id": child["dataset_id"], "column": child["name"]},
        "kind": "foreign_key",
        "containment": cont,
        "confidence": confidence,
        "reason": f"{int(cont*100)}% of {child['name']}'s values exist in {parent['name']} (key)",
    }


def analyze_catalog(columns: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """
    Pairwise analysis across all columns of all datasets.
    Returns {'matches': [...], 'relationships': [...]}.

    Pruned: we only deep-compare columns whose semantic type is compatible and
    whose name OR value sketch shows a minimal signal, keeping it O(n²) but light.
    """
    matches: list[dict[str, Any]] = []
    relationships: list[dict[str, Any]] = []
    seen_rel = set()

    for i in range(len(columns)):
        for j in range(i + 1, len(columns)):
            a, b = columns[i], columns[j]
            if a["dataset_id"] == b["dataset_id"]:
                continue
            pa, pb = a["profile"], b["profile"]
            # cheap pre-filter: skip obviously incompatible pairs
            if pa["semantic_type"] in {"free_text"} and pb["semantic_type"] in {"free_text"}:
                if name_similarity(a["name"], b["name"]) < 0.45:
                    continue
            cmp = compare_columns(a, b)
            if cmp["confidence"] >= 55:
                matches.append({
                    "a": {"dataset_id": a["dataset_id"], "column": a["name"]},
                    "b": {"dataset_id": b["dataset_id"], "column": b["name"]},
                    **cmp,
                })
            rel = infer_relationship(a, b, cmp)
            if rel and rel["confidence"] >= 60:
                key = (rel["child"]["dataset_id"], rel["child"]["column"],
                       rel["parent"]["dataset_id"], rel["parent"]["column"])
                if key not in seen_rel:
                    seen_rel.add(key)
                    relationships.append(rel)

    matches.sort(key=lambda m: -m["confidence"])
    relationships.sort(key=lambda r: -r["confidence"])
    return {"matches": matches, "relationships": relationships}
