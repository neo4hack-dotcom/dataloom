"""
DataLoom API — FastAPI.

Routes (all under /api, proxied from Vite dev server on :3000 or served directly
from the built frontend on :3001):
  GET  /api/health
  GET  /api/state                          full trimmed snapshot (+ version)
  POST /api/connections                    add connection         [optimistic]
  DEL  /api/connections/{id}                                       [optimistic]
  POST /api/runs                           launch agent pipeline (background)
  GET  /api/runs/{id}                      poll run status + logs
  POST /api/columns/{ds}/{col}/doc         edit a column doc       [optimistic]
  POST /api/relationships/{idx}/status     validate/reject FK      [optimistic]
  POST /api/glossary/{term}                edit glossary term      [optimistic]
  POST /api/notes                          add model/mapping note  [optimistic]
  POST /api/search                         natural-language catalog search (LLM)
  POST /api/settings                                               [optimistic]
  GET  /api/export/catalog/{fmt}           export catalog only (markdown|json)
  GET  /api/export/app/{fmt}               export app config only (json)
  GET  /api/export/{fmt}                   full export — kept for back-compat

Static serving (production):
  The server serves the compiled frontend from ../dist when it exists.
  Any non-/api path returns dist/index.html (SPA fallback).

Optimistic concurrency: mutating routes read `X-Base-Version`; mismatch -> 409.
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

# Path to the compiled frontend (../dist relative to this file)
_DIST = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "dist"))
_ASSETS = os.path.join(_DIST, "assets")


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
    type: str  # demo | oracle | clickhouse
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
    agents: list[str] | None = None  # default -> full pipeline


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


# -- catalog edits ----------------------------------------------------------- #
class ColDocIn(BaseModel):
    definition: str | None = None
    calculation: str | None = None
    status: str | None = None  # suggested | validated | rejected
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


class RelStatusIn(BaseModel):
    status: str  # validated | rejected | suggested


@app.post("/api/relationships/{idx}/status")
def rel_status(idx: int, body: RelStatusIn,
               x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    store.update_relationship_status(idx, body.status)
    return {"ok": True, "version": store.version}


class GlossaryIn(BaseModel):
    definition: str


@app.post("/api/glossary/{term}")
def edit_glossary(term: str, body: GlossaryIn,
                  x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    store.update_glossary_def(term, body.definition)
    return {"ok": True, "version": store.version}


class NoteIn(BaseModel):
    text: str


@app.post("/api/notes")
def add_note(body: NoteIn, x_base_version: int | None = Header(default=None)):
    guard(x_base_version)
    note = store.add_model_note(body.text)
    return {"note": note, "version": store.version}


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


# -- export ------------------------------------------------------------------ #
@app.get("/api/export/catalog/{fmt}")
def export_catalog(fmt: str):
    """Export the data dictionary only: tables, columns, docs, relationships, matches, lineage, glossary."""
    snap = store.snapshot()
    if fmt == "markdown":
        return {"content": _export_catalog_markdown(snap), "filename": "catalog.md"}
    if fmt == "json":
        payload = {
            "version": snap["version"],
            "datasets": snap["datasets"],
            "docs": snap["docs"],
            "relationships": snap["relationships"],
            "matches": snap["matches"],
            "lineage": snap["lineage"],
            "glossary": snap["glossary"],
            "model_notes": snap["model_notes"],
        }
        return {"content": payload, "filename": "catalog.json"}
    raise HTTPException(400, "fmt must be markdown|json")


@app.get("/api/export/app/{fmt}")
def export_app(fmt: str):
    """Export app configuration: connections, settings, run history, audit log."""
    if fmt != "json":
        raise HTTPException(400, "fmt must be json")
    snap = store.snapshot()
    payload = {
        "version": snap["version"],
        "connections": snap["connections"],
        "settings": snap["settings"],
        "runs": snap["runs"],
        "audit": snap["audit"],
    }
    return {"content": payload, "filename": "app-config.json"}


@app.get("/api/export/{fmt}")
def export_full(fmt: str):
    """Full export (catalog + app). Kept for backwards compatibility."""
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
    # relationships summary
    if snap.get("relationships"):
        lines.append("## Inferred Relationships\n")
        lines.append("| Child | → | Parent | Confidence |")
        lines.append("|---|---|---|---|")
        for r in snap["relationships"]:
            lines.append(f"| {r['child']['dataset_id']}.{r['child']['column']} | → | "
                         f"{r['parent']['dataset_id']}.{r['parent']['column']} | {r['confidence']:.0f}% |")
        lines.append("")
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
#  Static file serving — production frontend build                             #
# --------------------------------------------------------------------------- #
@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str):
    """
    Serve the compiled frontend (dist/).
    - Exact file match  → serve that file (assets, favicons, etc.)
    - Everything else   → serve dist/index.html (SPA client-side routing)
    All /api/* routes above take priority over this catch-all.
    """
    # Try the exact path inside dist first (assets, favicon, manifest…)
    candidate = os.path.normpath(os.path.join(_DIST, full_path))
    # Guard against path-traversal
    if candidate.startswith(_DIST) and os.path.isfile(candidate):
        return FileResponse(candidate)
    # SPA fallback
    index = os.path.join(_DIST, "index.html")
    if os.path.isfile(index):
        return FileResponse(index, media_type="text/html")
    return {
        "message": "Frontend not built.",
        "hint": "Run `npm run build` in the project root, then restart the server.",
    }
