"""
Column profiling engine.

For every column we compute a compact *fingerprint* used both for UI display and
for the similarity / FK-inference engine:

  - basic stats        : count, null_ratio, distinct_ratio, min/max/mean (numeric)
  - semantic type      : email / uuid / iban / siret / ip / url / date / phone /
                         currency / boolean / integer-id / code / free-text
  - format mask        : "FR76 1234..." -> "AAdd dddd..." signature (top patterns)
  - MinHash signature  : K 32-bit minima -> fast Jaccard estimate of value overlap
  - value sample set   : small hashed set for exact inclusion (containment) tests
  - data-quality score : completeness / uniqueness / validity blend (0..100)

Everything is pure-Python / stdlib so it runs offline with zero extra deps.
"""
from __future__ import annotations

import re
import hashlib
from typing import Any

MINHASH_K = 64          # number of hash permutations
SAMPLE_SET_MAX = 1500   # hashed values kept for containment tests
_MASK_TOP = 3           # number of format patterns surfaced

# --- semantic-type detectors (ordered: most specific first) ---------------- #
_RE = {
    "email": re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$"),
    "uuid": re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F-]{4,}$"),
    "iban": re.compile(r"^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$"),
    "siret": re.compile(r"^\d{14}$"),
    "siren": re.compile(r"^\d{9}$"),
    "ipv4": re.compile(r"^(\d{1,3}\.){3}\d{1,3}$"),
    "url": re.compile(r"^https?://", re.I),
    "phone": re.compile(r"^\+?\d[\d \-.]{7,}$"),
    "iso_datetime": re.compile(r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}"),
    "iso_date": re.compile(r"^\d{4}-\d{2}-\d{2}$"),
    "currency_code": re.compile(r"^[A-Z]{3}$"),
    "country_code": re.compile(r"^[A-Z]{2}$"),
}


def _h32(s: str) -> int:
    return int.from_bytes(hashlib.blake2b(s.encode("utf-8"), digest_size=4).digest(), "big")


def _minhash(values: list[str]) -> list[int]:
    """K-min-values MinHash: keep the K smallest distinct hashes (k-MV sketch)."""
    seen = set()
    for v in values:
        seen.add(_h32(v))
    sig = sorted(seen)[:MINHASH_K]
    # pad so all signatures are length K (stable Jaccard math)
    if len(sig) < MINHASH_K:
        sig += [0xFFFFFFFF] * (MINHASH_K - len(sig))
    return sig


def _format_mask(s: str) -> str:
    out = []
    for ch in s[:24]:
        if ch.isdigit():
            out.append("d")
        elif ch.isalpha():
            out.append("a")
        elif ch.isspace():
            out.append(" ")
        else:
            out.append(ch)
    # collapse runs (ddd -> d{3} style but keep short)
    return "".join(out)


def _detect_semantic(values: list[str]) -> tuple[str, float]:
    """Return (semantic_type, fraction_matching). Picks the best-supported type."""
    if not values:
        return "unknown", 0.0
    sample = values[: min(len(values), 400)]
    best_type, best_frac = "free_text", 0.0
    for name, rx in _RE.items():
        hits = sum(1 for v in sample if rx.match(v))
        frac = hits / len(sample)
        if frac > best_frac and frac >= 0.85:
            best_type, best_frac = name, frac
    if best_type == "free_text":
        # numeric id heuristic
        num = sum(1 for v in sample if v.lstrip("-").isdigit())
        if num / len(sample) >= 0.95:
            return ("integer_id", num / len(sample))
        # short uppercase categorical code
        short_codes = sum(1 for v in sample if len(v) <= 12 and v.upper() == v)
        if short_codes / len(sample) >= 0.9 and len({v for v in sample}) <= max(40, len(sample) * 0.4):
            return ("code", short_codes / len(sample))
    return best_type, best_frac


def _semantic_validity(values: list[str], semantic: str) -> float:
    rx = _RE.get(semantic)
    if not rx or not values:
        return 1.0
    sample = values[: min(len(values), 400)]
    return sum(1 for v in sample if rx.match(v)) / len(sample)


def profile_column(raw_values: list[Any], total_rows: int) -> dict[str, Any]:
    """Build the full fingerprint for one column."""
    non_null = [v for v in raw_values if v is not None]
    str_vals = [str(v) for v in non_null]
    n = len(str_vals)
    null_ratio = 0.0 if total_rows == 0 else max(0.0, 1 - n / total_rows)

    distinct = len(set(str_vals))
    distinct_ratio = (distinct / n) if n else 0.0

    # numeric stats
    nums = []
    for v in non_null:
        if isinstance(v, bool):
            continue
        if isinstance(v, (int, float)):
            nums.append(float(v))
    numeric = None
    if nums and len(nums) >= max(3, 0.5 * n):
        numeric = {
            "min": round(min(nums), 4),
            "max": round(max(nums), 4),
            "mean": round(sum(nums) / len(nums), 4),
        }

    semantic, sem_frac = _detect_semantic(str_vals)

    # format masks (top patterns)
    masks: dict[str, int] = {}
    for v in str_vals[:600]:
        m = _format_mask(v)
        masks[m] = masks.get(m, 0) + 1
    top_masks = sorted(masks.items(), key=lambda kv: -kv[1])[:_MASK_TOP]

    # top values
    counts: dict[str, int] = {}
    for v in str_vals:
        counts[v] = counts.get(v, 0) + 1
    top_values = sorted(counts.items(), key=lambda kv: -kv[1])[:8]

    # sketches for similarity engine
    minhash = _minhash(str_vals)
    sample_hashes = sorted({_h32(v) for v in str_vals})[:SAMPLE_SET_MAX]

    # data-quality blend
    completeness = 1 - null_ratio
    uniqueness = distinct_ratio
    validity = _semantic_validity(str_vals, semantic)
    is_keyish = distinct_ratio > 0.98 and null_ratio < 0.02
    # weight uniqueness less for non-key columns (categoricals are fine non-unique)
    quality = round(100 * (0.45 * completeness + 0.15 * uniqueness + 0.40 * validity), 1)

    # PII / sensitivity heuristic
    pii = semantic in {"email", "iban", "siret", "siren", "phone", "ipv4"}
    sensitivity = "PII" if pii else ("INTERNAL" if semantic in {"currency_code"} else "PUBLIC")

    return {
        "row_count": n,
        "null_ratio": round(null_ratio, 4),
        "distinct": distinct,
        "distinct_ratio": round(distinct_ratio, 4),
        "numeric": numeric,
        "semantic_type": semantic,
        "semantic_confidence": round(sem_frac, 3),
        "format_masks": [{"mask": m, "count": c} for m, c in top_masks],
        "top_values": [{"value": v, "count": c} for v, c in top_values],
        "is_key_candidate": is_keyish,
        "quality_score": quality,
        "quality_breakdown": {
            "completeness": round(completeness, 3),
            "uniqueness": round(uniqueness, 3),
            "validity": round(validity, 3),
        },
        "sensitivity": sensitivity,
        # sketches (kept server-side; trimmed before sending to UI)
        "_minhash": minhash,
        "_sample_hashes": sample_hashes,
    }
