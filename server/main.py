"""
DataLoom API — FastAPI.

All routes under /api (proxied from Vite on :3000 or served directly from :3001).
Full CRUD for all catalog elements + OKF (Frictionless Data) import/export.
Optimistic concurrency: mutating routes read X-Base-Version; mismatch -> 409.
"""
from __future__ import annotations

import os
import threading
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Any

from store import Store
from engine import llm, agents

app = FastAPI(title="DataLoom API", version="1.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
store = Store()

_DIST = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "dist"))


def guard(base_version: int | None):
    if not store.check_version(base_version):
        raise HTTPException(status_code=409, detail={
            "error": "version_conflict", "server_version": store.version,
            "your_version": base_version,
            "message": "Catalog changed since your last read. Please reload."})


# --------------------------------------------------------------------------- #
@app.get("/api/health")
def health():
    return {"ok": True, "version": store.version,
            "llm": {"up": llm.is_up(), "models": llm.list_models()},
            "agents": [{"id": a.id, "name": a.name, "icon": a.icon, "desc": a.desc}
                       for a in agents.AGENTS.values()],
            "pipeline": agents.PIPELINE}


@app.get("/api/state")
def state():
    return store.snapshot()


# -- connections ------------------------------------------------------------- #
class ConnectionIn(BaseModel):
    name: str
    type: str
    config: dict[str, Any] = {}
    llm_model: str | None = None


@app.post("/api/connections")
def add_connection(body: ConnectionIn, x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    conn = store.add_connection(body.model_dump())
    return {"connection": conn, "version": store.version}


@app.delete("/api/connections/{cid}")
def del_connection(cid: str, x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    store.delete_connection(cid)
    return {"ok": True, "version": store.version}


# -- runs / pipeline --------------------------------------------------------- #
class RunIn(BaseModel):
    connection_id: str
    agents: list[str] | None = None


@app.post("/api/runs")
def launch_run(body: RunIn, x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    conn = store.get_connection(body.connection_id)
    if not conn:
        raise HTTPException(404, "connection not found")
    agent_ids = body.agents or agents.PIPELINE
    run = store.create_run(conn["id"], agent_ids)
    t = threading.Thread(target=agents.run_pipeline,
                         args=(store, conn, agent_ids, run["id"]), daemon=True)
    t.start()
    return {"run": run, "version": store.version}


@app.get("/api/runs/{run_id}")
def get_run(run_id: str):
    run = store.get_run(run_id)
    if not run:
        raise HTTPException(404, "run not found")
    return run


# -- catalog CRUD ------------------------------------------------------------ #
class DatasetIn(BaseModel):
    schema_name: str
    name: str
    connection_id: str
    comment: str = ""


@app.post("/api/datasets")
def add_dataset(body: DatasetIn, x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    ds = store.add_manual_dataset(body.schema_name, body.name, body.connection_id, body.comment)
    return {"dataset": ds, "version": store.version}


@app.delete("/api/datasets/{ds_id:path}")
def delete_dataset(ds_id: str, x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    store.delete_dataset(ds_id)
    return {"ok": True, "version": store.version}


class DatasetMetaIn(BaseModel):
    definition: str | None = None
    domain: str | None = None
    comment: str | None = None


@app.patch("/api/datasets/{ds_id:path}/meta")
def update_dataset_meta(ds_id: str, body: DatasetMetaIn,
                        x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    store.update_dataset_meta(ds_id, body.model_dump())
    return {"ok": True, "version": store.version}


class ColumnIn(BaseModel):
    name: str
    data_type: str = "VARCHAR"
    nullable: bool = True
    semantic_type: str | None = None


@app.post("/api/datasets/{ds_id:path}/columns")
def add_column(ds_id: str, body: ColumnIn,
               x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    col = store.add_manual_column(ds_id, body.model_dump())
    return {"column": col, "version": store.version}


@app.delete("/api/datasets/{ds_id:path}/columns/{col}")
def delete_column(ds_id: str, col: str,
                  x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    store.delete_column(ds_id, col)
    return {"ok": True, "version": store.version}


class ColDocIn(BaseModel):
    definition: str | None = None
    calculation: str | None = None
    status: str | None = None
    sensitivity: str | None = None


@app.post("/api/columns/{ds_id:path}/{col}/doc")
def edit_col(ds_id: str, col: str, body: ColDocIn,
             x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    patch["source"] = "human"
    if "status" not in patch and ("definition" in patch or "calculation" in patch):
        patch["status"] = "validated"
        patch["confidence"] = 100
    store.update_column_doc(ds_id, col, patch)
    return {"ok": True, "version": store.version}


# -- relationships ----------------------------------------------------------- #
class RelStatusIn(BaseModel):
    status: str


@app.post("/api/relationships/{idx}/status")
def rel_status(idx: int, body: RelStatusIn,
               x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    store.update_relationship_status(idx, body.status)
    return {"ok": True, "version": store.version}


class RelIn(BaseModel):
    child_dataset_id: str
    child_column: str
    parent_dataset_id: str
    parent_column: str
    kind: str = "foreign_key"
    confidence: float = 100.0
    reason: str = ""


@app.post("/api/relationships")
def add_relationship(body: RelIn, x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    rel = store.add_relationship({
        "child": {"dataset_id": body.child_dataset_id, "column": body.child_column},
        "parent": {"dataset_id": body.parent_dataset_id, "column": body.parent_column},
        "kind": body.kind, "confidence": body.confidence,
        "reason": body.reason or f"{body.child_column} → {body.parent_column} (manual)",
        "containment": 1.0,
    })
    return {"relationship": rel, "version": store.version}


@app.delete("/api/relationships/{idx}")
def delete_relationship(idx: int, x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    store.delete_relationship(idx)
    return {"ok": True, "version": store.version}


@app.delete("/api/matches/{idx}")
def dismiss_match(idx: int, x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    store.dismiss_match(idx)
    return {"ok": True, "version": store.version}


# -- lineage ----------------------------------------------------------------- #
class LineageEdgeIn(BaseModel):
    from_id: str
    to_id: str
    via: str = ""
    kind: str = "manual"
    confidence: float = 100.0


@app.post("/api/lineage")
def add_lineage_edge(body: LineageEdgeIn, x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    edge = store.add_lineage_edge({
        "from": body.from_id, "to": body.to_id,
        "via": body.via, "kind": body.kind, "confidence": body.confidence,
    })
    return {"edge": edge, "version": store.version}


@app.delete("/api/lineage/{idx}")
def delete_lineage_edge(idx: int, x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    store.delete_lineage_edge(idx)
    return {"ok": True, "version": store.version}


# -- glossary ---------------------------------------------------------------- #
class GlossaryIn(BaseModel):
    definition: str


@app.post("/api/glossary/{term}")
def edit_glossary(term: str, body: GlossaryIn,
                  x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    store.update_glossary_def(term, body.definition)
    return {"ok": True, "version": store.version}


class GlossaryNewIn(BaseModel):
    term: str
    definition: str = ""


@app.post("/api/glossary")
def add_glossary_term(body: GlossaryNewIn, x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    try:
        entry = store.add_glossary_term(body.term, body.definition)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"term": entry, "version": store.version}


@app.delete("/api/glossary/{term}")
def delete_glossary_term(term: str, x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    store.delete_glossary_term(term)
    return {"ok": True, "version": store.version}


# -- notes ------------------------------------------------------------------- #
class NoteIn(BaseModel):
    text: str


@app.post("/api/notes")
def add_note(body: NoteIn, x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    note = store.add_model_note(body.text)
    return {"note": note, "version": store.version}


# -- QA issues --------------------------------------------------------------- #
@app.delete("/api/qa/{idx}")
def dismiss_qa(idx: int, x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    store.dismiss_qa_issue(idx)
    return {"ok": True, "version": store.version}


# -- reset ------------------------------------------------------------------- #
@app.post("/api/reset")
def reset_catalog(x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    store.reset_catalog()
    return {"ok": True, "version": store.version}


# -- natural language search ------------------------------------------------- #
class SearchIn(BaseModel):
    q: str


@app.post("/api/search")
def search(body: SearchIn):
    q = body.q.strip()
    snap = store.snapshot()
    hits = _lexical_search(q, snap)
    answer = None
    if llm.is_up() and hits:
        ctx = _format_context(hits[:12], snap)
        try:
            out = llm.generate(
                system=("You are a data catalog assistant. Answer in English, "
                        "relying ONLY on the context provided. Strict JSON."),
                prompt=(f"Question: {q}\n\nContext (catalog columns):\n{ctx}\n\n"
                        "Return {\"answer\": string, \"best_dataset\": string|null}"),
            )
            if isinstance(out, dict):
                answer = out.get("answer")
        except Exception:
            answer = None
    return {"query": q, "hits": hits[:25], "answer": answer, "llm": llm.is_up()}


def _lexical_search(q: str, snap: dict) -> list[dict]:
    import re
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
                    "quality": c["profile"]["quality_score"],
                    "definition": cdoc.get("definition", ""),
                    "domain": doc.get("domain", ""), "score": score,
                })
    results.sort(key=lambda r: -r["score"])
    return results


def _format_context(hits: list[dict], snap: dict) -> str:
    return "\n".join(
        f"- {h['dataset']}.{h['column']} ({h['semantic_type']}, q={h['quality']}): "
        f"{h['definition'] or '—'}" for h in hits)


# -- settings ---------------------------------------------------------------- #
class SettingsIn(BaseModel):
    patch: dict[str, Any]


@app.post("/api/settings")
def settings(body: SettingsIn, x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    store.update_settings(body.patch)
    return {"ok": True, "version": store.version}


# -- OKF (Frictionless Data) import/export ----------------------------------- #
class OKFImportIn(BaseModel):
    content: dict[str, Any] | None = None
    url: str | None = None
    connection_id: str | None = None


@app.post("/api/import/okf")
def import_okf(body: OKFImportIn, x_base_version: int | None = Header(default=None)):
    """
    Import a Frictionless Data Package (datapackage.json) into the catalog.
    Accepts either an inline `content` dict or a `url` to fetch from.
    Creates a new OKF connection automatically if no connection_id is provided.
    """
    guard(x_base_version)
    from engine.connectors import OKFConnector
    from engine.profiling import profile_column

    if not body.content and not body.url:
        raise HTTPException(400, "Provide 'content' or 'url'")
    try:
        connector = OKFConnector(content=body.content, url=body.url)
    except Exception as e:
        raise HTTPException(422, f"Invalid datapackage: {e}")

    pkg = body.content or {}
    conn_name = pkg.get("title") or pkg.get("name") or (body.url or "OKF Package")

    # Reuse or create connection
    conn_id = body.connection_id
    if not conn_id:
        conn = store.add_connection({
            "name": conn_name,
            "type": "okf",
            "config": {"content": body.content, "url": body.url},
        })
        conn_id = conn["id"]

    # Profile each resource — build full doc atomically to avoid overwrite race
    tables = connector.list_tables()
    datasets = []
    for t in tables:
        cols_meta = connector.get_columns(t["schema"], t["name"])
        ds_id = f"{conn_id}::{t['schema']}.{t['name']}"
        col_profiles = []
        col_docs: dict[str, Any] = {}
        for col in cols_meta:
            vals = connector.sample_values(t["schema"], t["name"], col["name"])
            prof = profile_column(vals, t["row_estimate"])
            if col.get("_is_pk"):
                prof["is_key_candidate"] = True
            col_profiles.append({
                "name": col["name"], "data_type": col["data_type"],
                "nullable": col["nullable"], "position": col["position"],
                "profile": prof, "dataset_id": ds_id,
            })
            if col.get("comment"):
                col_docs[col["name"]] = {
                    "definition": col["comment"], "source": "okf",
                    "status": "suggested", "confidence": 75,
                }
        datasets.append({
            "id": ds_id, "connection_id": conn_id,
            "schema": t["schema"], "name": t["name"], "kind": t["kind"],
            "row_estimate": t["row_estimate"], "comment": t.get("comment"), "columns": col_profiles,
        })
        # Write the complete doc (table + all columns) in one shot
        doc: dict[str, Any] = {"doc_source": "okf", "doc_confidence": 75}
        if t.get("comment"):
            doc["definition"] = t["comment"]
        if col_docs:
            doc["columns"] = col_docs
        if doc:
            store.set_dataset_doc(ds_id, doc)
    store.upsert_datasets(datasets)

    # Import foreign keys
    if body.content:
        _import_fk_from_package(body.content, conn_id, store)

    return {"ok": True, "imported": len(datasets), "connection_id": conn_id,
            "version": store.version}


def _import_fk_from_package(pkg: dict, conn_id: str, store: Store):
    schema_name = (pkg.get("name") or "okf").upper().replace("-", "_")[:30]
    for res in pkg.get("resources", []):
        res_name = res["name"].upper().replace("-", "_")
        child_ds = f"{conn_id}::{schema_name}.{res_name}"
        for fk in res.get("schema", {}).get("foreignKeys", []):
            fields = fk.get("fields", [])
            ref = fk.get("reference", {})
            ref_res = ref.get("resource", "")
            ref_fields = ref.get("fields", [])
            if fields and ref_fields:
                parent_name = ref_res.upper().replace("-", "_")
                parent_ds = f"{conn_id}::{schema_name}.{parent_name}"
                for cf, pf in zip(fields, ref_fields):
                    store.add_relationship({
                        "child": {"dataset_id": child_ds, "column": cf},
                        "parent": {"dataset_id": parent_ds, "column": pf},
                        "kind": "foreign_key", "confidence": 100.0,
                        "reason": f"Declared FK in datapackage.json",
                        "containment": 1.0, "status": "validated",
                    })


@app.get("/api/export/catalog/okf")
def export_okf():
    """Export the catalog as a Frictionless Data Package (datapackage.json)."""
    snap = store.snapshot()
    pkg = _build_frictionless_package(snap)
    return {"content": pkg, "filename": "datapackage.json"}


def _build_frictionless_package(snap: dict) -> dict:
    resources = []
    for d in snap["datasets"]:
        doc = snap["docs"].get(d["id"], {})
        fields = []
        for c in d["columns"]:
            cdoc = (doc.get("columns") or {}).get(c["name"], {})
            ftype = _sql_to_frictionless(c["data_type"])
            f: dict[str, Any] = {"name": c["name"], "type": ftype}
            if cdoc.get("definition"):
                f["description"] = cdoc["definition"]
            if c["profile"]["sensitivity"] == "PII":
                f["constraints"] = f.get("constraints", {})
                f["constraints"]["sensitive"] = True
            if not c["nullable"]:
                f.setdefault("constraints", {})["required"] = True
            fields.append(f)
        # FK references
        fks = []
        rels = [r for r in snap["relationships"]
                if r["child"]["dataset_id"] == d["id"] and r.get("status") != "rejected"]
        for r in rels:
            fks.append({
                "fields": [r["child"]["column"]],
                "reference": {
                    "resource": r["parent"]["dataset_id"].split(".")[-1].lower(),
                    "fields": [r["parent"]["column"]],
                }
            })
        pk = [c["name"] for c in d["columns"] if c["profile"].get("is_key_candidate")]
        schema: dict[str, Any] = {"fields": fields}
        if pk:
            schema["primaryKey"] = pk
        if fks:
            schema["foreignKeys"] = fks
        resources.append({
            "name": d["name"].lower().replace("_", "-"),
            "title": d["name"],
            "description": doc.get("definition") or d.get("comment") or "",
            "schema": schema,
        })
    return {
        "name": "dataloom-catalog",
        "title": "DataLoom — Exported Catalog",
        "description": "Generated by DataLoom",
        "licenses": [{"name": "odc-pddl"}],
        "resources": resources,
    }


def _sql_to_frictionless(dtype: str) -> str:
    d = dtype.upper()
    if "INT" in d:
        return "integer"
    if "FLOAT" in d or "NUMBER" in d or "NUMERIC" in d or "DECIMAL" in d:
        return "number"
    if "BOOL" in d:
        return "boolean"
    if "TIMESTAMP" in d or "DATETIME" in d:
        return "datetime"
    if "DATE" in d:
        return "date"
    if "TIME" in d:
        return "time"
    if "JSON" in d or "ARRAY" in d or "OBJECT" in d:
        return "object"
    return "string"


# -- catalog export (existing) ----------------------------------------------- #
@app.get("/api/export/catalog/{fmt}")
def export_catalog(fmt: str):
    snap = store.snapshot()
    if fmt == "okf":
        return {"content": _build_frictionless_package(snap), "filename": "datapackage.json"}
    if fmt == "markdown":
        return {"content": _export_catalog_markdown(snap), "filename": "catalog.md"}
    if fmt == "json":
        payload = {k: snap[k] for k in
                   ["version", "datasets", "docs", "relationships", "matches",
                    "lineage", "glossary", "model_notes"]}
        return {"content": payload, "filename": "catalog.json"}
    raise HTTPException(400, "fmt must be markdown|json|okf")


@app.get("/api/export/app/{fmt}")
def export_app(fmt: str):
    if fmt != "json":
        raise HTTPException(400, "fmt must be json")
    snap = store.snapshot()
    payload = {k: snap[k] for k in ["version", "connections", "settings", "runs", "audit"]}
    return {"content": payload, "filename": "app-config.json"}


@app.get("/api/export/{fmt}")
def export_full(fmt: str):
    snap = store.snapshot()
    if fmt == "markdown":
        return {"content": _export_catalog_markdown(snap), "filename": "data-catalog.md"}
    if fmt == "json":
        return {"content": snap, "filename": "data-catalog.json"}
    raise HTTPException(400, "fmt must be markdown|json")


def _export_catalog_markdown(snap: dict) -> str:
    lines = ["# Data Catalog\n"]
    for d in snap["datasets"]:
        doc = snap["docs"].get(d["id"], {})
        lines.append(f"## {d['schema']}.{d['name']}  \n")
        if doc.get("definition"):
            lines.append(f"> {doc['definition']}  \n")
        if doc.get("domain"):
            lines.append(f"> **Domain:** {doc['domain']}  \n")
        lines.append("\n| Column | Type | Semantic | Quality | Definition |")
        lines.append("|---|---|---|---|---|")
        for c in d["columns"]:
            cdoc = (doc.get("columns") or {}).get(c["name"], {})
            calc = f" _(calc: {cdoc['calculation']})_" if cdoc.get("calculation") else ""
            lines.append(f"| {c['name']} | {c['data_type']} | "
                         f"{c['profile']['semantic_type']} | {c['profile']['quality_score']} | "
                         f"{cdoc.get('definition','')}{calc} |")
        lines.append("")
    if snap.get("relationships"):
        lines.append("## Inferred Relationships\n")
        lines.append("| Child | → | Parent | Confidence |")
        lines.append("|---|---|---|---|")
        for r in snap["relationships"]:
            lines.append(f"| {r['child']['dataset_id']}.{r['child']['column']} | → | "
                         f"{r['parent']['dataset_id']}.{r['parent']['column']} | {r['confidence']:.0f}% |")
        lines.append("")
    return "\n".join(lines)


# -- static file serving (production build) ---------------------------------- #
@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str):
    candidate = os.path.normpath(os.path.join(_DIST, full_path))
    if candidate.startswith(_DIST) and os.path.isfile(candidate):
        return FileResponse(candidate)
    index = os.path.join(_DIST, "index.html")
    if os.path.isfile(index):
        return FileResponse(index, media_type="text/html")
    return {"message": "Frontend not built.",
            "hint": "Run `npm run build` in the project root, then restart the server."}
