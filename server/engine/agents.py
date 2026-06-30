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
    desc = "Introspecte les sources, échantillonne et calcule l'empreinte de chaque colonne (types sémantiques, MinHash, qualité)."

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
            log("ok", f"  ✓ {t['schema']}.{t['name']} — {len(cols)} colonnes profilées.")
        store.upsert_datasets(datasets)
        return {"datasets": len(datasets),
                "columns": sum(len(d["columns"]) for d in datasets)}


# --------------------------------------------------------------------------- #
class LinkerAgent:
    id = "linker"
    name = "Linker"
    icon = "git-compare"
    desc = "Compare toutes les colonnes par tests de valeurs (overlap réel) et infère les clés PK→FK et les champs identiques."

    def run(self, store, conn: dict[str, Any], log: LogFn) -> dict[str, Any]:
        cols = store.all_columns()
        log("info", f"Analyse croisée de {len(cols)} colonnes (MinHash + inclusion)…")
        result = analyze_catalog(cols)
        store.set_matches(result["matches"])
        store.set_relationships(result["relationships"])
        log("ok", f"  ✓ {len(result['relationships'])} relations PK/FK inférées.")
        log("ok", f"  ✓ {len(result['matches'])} paires « même champ » détectées.")
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
    desc = "Le LLM local rédige la définition fonctionnelle et la méthode de calcul de chaque table/colonne, avec score de confiance."

    def run(self, store, conn: dict[str, Any], log: LogFn) -> dict[str, Any]:
        up = llm.is_up()
        log("info", "LLM local détecté." if up else "LLM injoignable — fallback heuristique.")
        datasets = [d for d in store.datasets() if d["connection_id"] == conn["id"]]
        written = 0
        for d in datasets:
            cols_brief = ", ".join(
                f"{c['name']}:{c['profile']['semantic_type']}" for c in d["columns"][:25])
            if up:
                try:
                    out = llm.generate(
                        system=("Tu es un data steward senior. Tu documentes un data "
                                "warehouse en français, de façon concise et métier. "
                                "Réponds STRICTEMENT en JSON."),
                        prompt=(
                            f"Table {d['schema']}.{d['name']} ({d['row_estimate']} lignes).\n"
                            f"Colonnes: {cols_brief}.\n\n"
                            "Renvoie un JSON: {\"definition\": string (1-2 phrases métier), "
                            "\"domain\": string (ex: Ventes, Finance, Client), "
                            "\"columns\": [{\"name\": string, \"definition\": string, "
                            "\"calculation\": string|null}]}"),
                        model=conn.get("llm_model"),
                    )
                    doc = out if isinstance(out, dict) else {}
                except Exception as e:  # pragma: no cover
                    log("warn", f"  ! LLM erreur sur {d['name']}: {e}")
                    doc = {}
            else:
                doc = {}

            self._apply(store, d, doc, heuristic=not up)
            written += 1
            conf = "LLM" if (up and doc.get("columns")) else "heuristique"
            log("ok", f"  ✓ {d['name']} documentée ({conf}).")
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
    desc = "Reconstruit les chaînes d'information depuis les relations, les tables de mapping et tes notes de modèle."

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
                edges.append({"from": a, "to": b, "via": "note modèle",
                              "kind": "manual", "confidence": 90})
        # dedupe
        seen = set(); uniq = []
        for e in edges:
            k = (e["from"], e["to"], e["via"])
            if k not in seen and e["from"] != e["to"]:
                seen.add(k); uniq.append(e)
        store.set_lineage(uniq)
        log("ok", f"  ✓ {len(uniq)} arêtes de lineage reconstruites.")
        return {"edges": len(uniq)}


# --------------------------------------------------------------------------- #
class QaAgent:
    id = "qa"
    name = "QA Reviewer"
    icon = "shield-check"
    desc = "Audite le catalogue : définitions manquantes, faible qualité, PII non signalée, contradictions."

    def run(self, store, conn: dict[str, Any], log: LogFn) -> dict[str, Any]:
        issues = []
        for d in store.datasets():
            doc = store.get_dataset_doc(d["id"]) or {}
            if not doc.get("definition"):
                issues.append({"severity": "high", "dataset_id": d["id"],
                               "message": f"{d['name']}: définition de table manquante"})
            for c in d["columns"]:
                p = c["profile"]
                cdoc = (doc.get("columns") or {}).get(c["name"], {})
                if p["sensitivity"] == "PII":
                    issues.append({"severity": "high", "dataset_id": d["id"],
                                   "message": f"{d['name']}.{c['name']}: PII ({p['semantic_type']}) — vérifier la classification"})
                if p["quality_score"] < 60:
                    issues.append({"severity": "medium", "dataset_id": d["id"],
                                   "message": f"{d['name']}.{c['name']}: qualité faible ({p['quality_score']})"})
                if not cdoc.get("definition"):
                    issues.append({"severity": "low", "dataset_id": d["id"],
                                   "message": f"{d['name']}.{c['name']}: définition manquante"})
        store.set_qa_issues(issues)
        sev = {"high": 0, "medium": 0, "low": 0}
        for i in issues:
            sev[i["severity"]] += 1
        log("ok", f"  ✓ Audit: {sev['high']} critiques, {sev['medium']} moyens, {sev['low']} mineurs.")
        return {"issues": len(issues), **sev}


# --------------------------------------------------------------------------- #
class GlossaryAgent:
    id = "glossary"
    name = "Glossary"
    icon = "tags"
    desc = "Extrait les termes métier récurrents et les relie aux colonnes du catalogue."

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
        log("ok", f"  ✓ {len(terms)} termes métier extraits.")
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
            log("agent", f"▶ Agent « {agent.name} » démarré.")
            res = agent.run(store, conn, log)
            summary[aid] = res
            store.update_run(run_id, {"progress": round((idx + 1) / total, 3)})
            log("agent", f"■ Agent « {agent.name} » terminé.")
        store.update_run(run_id, {"status": "done", "finished_at": time.time(),
                                  "summary": summary, "progress": 1.0})
        log("done", "Pipeline terminé ✅")
    except Exception as e:  # pragma: no cover
        log("error", f"Échec: {e}")
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
        return "Client"
    if any(k in n for k in ("ORDER", "SALE", "ITEM", "PRODUCT")):
        return "Ventes"
    if any(k in n for k in ("EVENT", "CLICK", "WEB")):
        return "Web Analytics"
    return "Général"


def _heuristic_table_def(d: dict) -> str:
    return (f"Table « {d['name']} » du schéma {d['schema']} "
            f"(~{d['row_estimate']} lignes). Documentation à valider.")


def _heuristic_col_def(c: dict) -> str:
    p = c["profile"]
    st = p["semantic_type"]
    base = {
        "email": "Adresse e-mail.", "iban": "Identifiant bancaire (IBAN).",
        "siret": "Numéro SIRET (établissement).", "integer_id": "Identifiant numérique.",
        "iso_date": "Date.", "iso_datetime": "Horodatage.",
        "currency_code": "Code devise ISO 4217.", "country_code": "Code pays ISO.",
        "code": "Code métier catégoriel.", "ipv4": "Adresse IP.", "url": "URL.",
    }.get(st, f"Champ « {c['name']} ».")
    if p["is_key_candidate"]:
        base += " Probable clé."
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
