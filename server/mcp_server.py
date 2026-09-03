"""
MCP (Model Context Protocol) server — exposes the catalog to AI agents over
Streamable HTTP, mounted on the same FastAPI app at /mcp.

- Which tools exist at all is fixed here (TOOLS); which tools are *enabled*
  and what data they're allowed to return is controlled live from the admin
  "MCP" screen (store.mcp_config) — a disabled tool doesn't even appear in
  tools/list, and denied datasets/columns/PII are stripped before any tool
  returns data.
- Access to /mcp itself requires `Authorization: Bearer <token>`, checked
  against the admin-issued token's hash (see /api/mcp/token in main.py).
"""
from __future__ import annotations

from typing import Any, Awaitable, Callable

import mcp.types as types
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from starlette.responses import JSONResponse

import auth
from engine.connectors import build_connector
from engine.query_registry import QueryCancelled
from engine.search import lexical_search

# -- tool registry -------------------------------------------------------- #
TOOLS: dict[str, types.Tool] = {
    "list_datasets": types.Tool(
        name="list_datasets",
        description="List every dataset (table) exposed in the catalog, with schema, domain, "
                    "definition and row estimate.",
        inputSchema={"type": "object", "properties": {}, "additionalProperties": False},
    ),
    "get_dataset_schema": types.Tool(
        name="get_dataset_schema",
        description="Get the column list (names, types, semantic types, definitions) for one dataset.",
        inputSchema={
            "type": "object",
            "properties": {"dataset_id": {"type": "string", "description": "Dataset id, e.g. 'conn_x::SCHEMA.TABLE'"}},
            "required": ["dataset_id"], "additionalProperties": False,
        },
    ),
    "search_catalog": types.Tool(
        name="search_catalog",
        description="Full-text search across dataset and column names, semantic types and definitions.",
        inputSchema={
            "type": "object", "properties": {"query": {"type": "string"}},
            "required": ["query"], "additionalProperties": False,
        },
    ),
    "get_column_definition": types.Tool(
        name="get_column_definition",
        description="Get the business definition, calculation method and sensitivity of one column.",
        inputSchema={
            "type": "object",
            "properties": {"dataset_id": {"type": "string"}, "column": {"type": "string"}},
            "required": ["dataset_id", "column"], "additionalProperties": False,
        },
    ),
    "get_lineage": types.Tool(
        name="get_lineage",
        description="Get the inbound/outbound lineage edges for a dataset.",
        inputSchema={
            "type": "object", "properties": {"dataset_id": {"type": "string"}},
            "required": ["dataset_id"], "additionalProperties": False,
        },
    ),
    "get_glossary_term": types.Tool(
        name="get_glossary_term",
        description="Look up a business glossary term definition.",
        inputSchema={
            "type": "object", "properties": {"term": {"type": "string"}},
            "required": ["term"], "additionalProperties": False,
        },
    ),
    "sample_dataset_rows": types.Tool(
        name="sample_dataset_rows",
        description="Fetch a small, row-limited sample of real rows from a dataset's source. "
                    "Touches the live database; tracked in the app's Query Log and can be "
                    "cancelled by an admin.",
        inputSchema={
            "type": "object",
            "properties": {"dataset_id": {"type": "string"}, "limit": {"type": "integer", "minimum": 1}},
            "required": ["dataset_id"], "additionalProperties": False,
        },
    ),
    "list_mcp_sources": types.Tool(
        name="list_mcp_sources",
        description="List every other MCP (Model Context Protocol) server this catalog knows about — "
                    "the MCP Library. For each, how many tools it exposes, how many were mapped into "
                    "catalog tables, and how many have a documented query/code definition.",
        inputSchema={"type": "object", "properties": {}, "additionalProperties": False},
    ),
    "get_mcp_source_tools": types.Tool(
        name="get_mcp_source_tools",
        description="Get the full discovered tool inventory of one referenced MCP source (from the MCP "
                    "Library), flagging which tools are already mapped into a catalog table and which "
                    "have a documented query/code definition.",
        inputSchema={
            "type": "object", "properties": {"connection_id": {"type": "string"}},
            "required": ["connection_id"], "additionalProperties": False,
        },
    ),
    "get_mcp_query_definition": types.Tool(
        name="get_mcp_query_definition",
        description="Get the actual SQL/code behind one tool of a referenced MCP source, plus the local "
                    "LLM's extracted functional description, referenced tables/columns and mapping "
                    "reconciliation notes — the real logic behind that MCP tool, not just its schema.",
        inputSchema={
            "type": "object",
            "properties": {"connection_id": {"type": "string"}, "tool": {"type": "string"}},
            "required": ["connection_id", "tool"], "additionalProperties": False,
        },
    ),
    "list_datamarts": types.Tool(
        name="list_datamarts",
        description="List every datamart in the catalog — a calculated/derived table that feeds a report "
                    "or dashboard — with its generation SQL, the local LLM's functional description of what "
                    "it computes, and which raw tables feed it. Use this to trace what's behind a report.",
        inputSchema={"type": "object", "properties": {}, "additionalProperties": False},
    ),
}


# -- exposure filtering ----------------------------------------------------- #
def _exposure(store) -> dict[str, Any]:
    return store.mcp_config.get("exposure", {})


def _dataset_denied(ds_id: str, exposure: dict[str, Any]) -> bool:
    return ds_id in (exposure.get("denied_datasets") or [])


def _column_denied(ds_id: str, col: str, exposure: dict[str, Any]) -> bool:
    return any(d.get("dataset_id") == ds_id and d.get("column") == col
               for d in (exposure.get("denied_columns") or []))


def _filter_columns(ds_id: str, columns: list[dict], doc_columns: dict | None,
                    exposure: dict[str, Any]) -> list[dict]:
    hide_pii = exposure.get("hide_pii", True)
    out = []
    for c in columns:
        if _column_denied(ds_id, c["name"], exposure):
            continue
        if hide_pii and c["profile"]["sensitivity"] == "PII":
            continue
        cdoc = (doc_columns or {}).get(c["name"], {})
        out.append({
            "name": c["name"], "data_type": c["data_type"], "nullable": c["nullable"],
            "semantic_type": c["profile"]["semantic_type"], "quality_score": c["profile"]["quality_score"],
            "sensitivity": c["profile"]["sensitivity"],
            "definition": cdoc.get("definition"), "calculation": cdoc.get("calculation"),
        })
    return out


# -- tool handlers ----------------------------------------------------------- #
async def _h_list_datasets(store, args: dict[str, Any]) -> dict[str, Any]:
    snap = store.snapshot()
    exposure = _exposure(store)
    out = []
    for d in snap["datasets"]:
        if _dataset_denied(d["id"], exposure):
            continue
        doc = snap["docs"].get(d["id"], {})
        out.append({
            "id": d["id"], "schema": d["schema"], "name": d["name"],
            "row_estimate": d["row_estimate"], "domain": doc.get("domain"),
            "definition": doc.get("definition"),
        })
    return {"datasets": out}


async def _h_get_dataset_schema(store, args: dict[str, Any]) -> dict[str, Any]:
    ds_id = args["dataset_id"]
    snap = store.snapshot()
    exposure = _exposure(store)
    if _dataset_denied(ds_id, exposure):
        raise ValueError("Dataset not exposed via MCP")
    d = next((x for x in snap["datasets"] if x["id"] == ds_id), None)
    if not d:
        raise ValueError("dataset not found")
    doc = snap["docs"].get(ds_id, {})
    return {
        "id": d["id"], "schema": d["schema"], "name": d["name"],
        "definition": doc.get("definition"), "domain": doc.get("domain"),
        "columns": _filter_columns(ds_id, d["columns"], doc.get("columns"), exposure),
    }


async def _h_search_catalog(store, args: dict[str, Any]) -> dict[str, Any]:
    snap = store.snapshot()
    exposure = _exposure(store)
    hits = lexical_search(args["query"], snap)
    hits = [h for h in hits if not _dataset_denied(h["dataset_id"], exposure)
           and not _column_denied(h["dataset_id"], h["column"], exposure)]
    if exposure.get("hide_pii", True):
        hits = [h for h in hits if h.get("sensitivity") != "PII"]
    return {"hits": hits[:25]}


async def _h_get_column_definition(store, args: dict[str, Any]) -> dict[str, Any]:
    ds_id, col = args["dataset_id"], args["column"]
    snap = store.snapshot()
    exposure = _exposure(store)
    if _dataset_denied(ds_id, exposure) or _column_denied(ds_id, col, exposure):
        raise ValueError("Column not exposed via MCP")
    d = next((x for x in snap["datasets"] if x["id"] == ds_id), None)
    if not d:
        raise ValueError("dataset not found")
    c = next((x for x in d["columns"] if x["name"] == col), None)
    if not c:
        raise ValueError("column not found")
    if exposure.get("hide_pii", True) and c["profile"]["sensitivity"] == "PII":
        raise ValueError("Column not exposed via MCP (PII)")
    doc = snap["docs"].get(ds_id, {})
    cdoc = (doc.get("columns") or {}).get(col, {})
    return {
        "dataset_id": ds_id, "column": col, "data_type": c["data_type"],
        "semantic_type": c["profile"]["semantic_type"], "sensitivity": c["profile"]["sensitivity"],
        "definition": cdoc.get("definition"), "calculation": cdoc.get("calculation"),
    }


async def _h_get_lineage(store, args: dict[str, Any]) -> dict[str, Any]:
    ds_id = args["dataset_id"]
    snap = store.snapshot()
    exposure = _exposure(store)
    if _dataset_denied(ds_id, exposure):
        raise ValueError("Dataset not exposed via MCP")
    edges = [e for e in snap["lineage"] if e["from"] == ds_id or e["to"] == ds_id]
    edges = [e for e in edges
            if not _dataset_denied(e["from"], exposure) and not _dataset_denied(e["to"], exposure)]
    return {"dataset_id": ds_id, "edges": edges}


async def _h_get_glossary_term(store, args: dict[str, Any]) -> dict[str, Any]:
    term = args["term"]
    snap = store.snapshot()
    g = next((x for x in snap["glossary"] if x["term"].lower() == term.lower()), None)
    if not g:
        raise ValueError("term not found")
    return {"term": g["term"], "definition": g["definition"], "occurrences": g["occurrences"]}


async def _h_sample_dataset_rows(store, args: dict[str, Any]) -> dict[str, Any]:
    ds_id = args["dataset_id"]
    limit = int(args.get("limit") or 20)
    snap = store.snapshot()
    exposure = _exposure(store)
    if _dataset_denied(ds_id, exposure):
        raise ValueError("Dataset not exposed via MCP")
    d = next((x for x in snap["datasets"] if x["id"] == ds_id), None)
    if not d:
        raise ValueError("dataset not found")
    conn = store.get_connection(d["connection_id"])
    if not conn:
        raise ValueError("connection not found")
    connector = build_connector(conn, store=store, source="mcp")
    try:
        rows = connector.sample_rows(d["schema"], d["name"], limit=limit)
    except QueryCancelled:
        raise ValueError("Query was cancelled")
    doc = snap["docs"].get(ds_id, {})
    allowed = {c["name"] for c in _filter_columns(ds_id, d["columns"], doc.get("columns"), exposure)}
    filtered_rows = [{k: v for k, v in r.items() if k in allowed} for r in rows]
    return {"dataset_id": ds_id, "rows": filtered_rows, "row_count": len(filtered_rows)}


async def _h_list_mcp_sources(store, args: dict[str, Any]) -> dict[str, Any]:
    snap = store.snapshot()
    out = []
    for c in snap["connections"]:
        if c.get("type") != "mcp":
            continue
        mapped = ((c.get("config") or {}).get("mcp_mapping") or {}).get("tables", [])
        out.append({
            "connection_id": c["id"], "name": c["name"],
            "tool_count": len(c.get("mcp_tools") or []),
            "mapped_table_count": len(mapped),
            "query_definition_count": len(c.get("mcp_queries") or []),
        })
    return {"mcp_sources": out}


async def _h_get_mcp_source_tools(store, args: dict[str, Any]) -> dict[str, Any]:
    conn = store.get_connection(args["connection_id"])
    if not conn or conn.get("type") != "mcp":
        raise ValueError("MCP connection not found")
    mapped_tools = {t.get("tool") for t in ((conn.get("config") or {}).get("mcp_mapping") or {}).get("tables", [])}
    queried_tools = {q.get("tool") for q in (conn.get("mcp_queries") or [])}
    tools = [{
        "name": t.get("name"), "description": t.get("description"),
        "mapped_to_table": t.get("name") in mapped_tools,
        "has_query_definition": t.get("name") in queried_tools,
    } for t in (conn.get("mcp_tools") or [])]
    return {"connection_id": conn["id"], "name": conn["name"], "tools": tools}


async def _h_get_mcp_query_definition(store, args: dict[str, Any]) -> dict[str, Any]:
    conn = store.get_connection(args["connection_id"])
    if not conn or conn.get("type") != "mcp":
        raise ValueError("MCP connection not found")
    entries = [q for q in (conn.get("mcp_queries") or []) if q.get("tool") == args["tool"]]
    if not entries:
        raise ValueError("No query definition found for this tool")
    return {"connection_id": conn["id"], "tool": args["tool"], "definitions": [
        {"title": e.get("title"), "language": e.get("language"), "code": e.get("code"),
         "extraction": e.get("extraction")} for e in entries
    ]}


async def _h_list_datamarts(store, args: dict[str, Any]) -> dict[str, Any]:
    snap = store.snapshot()
    exposure = _exposure(store)
    out = []
    for d in snap["datasets"]:
        doc = snap["docs"].get(d["id"], {})
        if "datamart" not in (doc.get("tags") or []):
            continue
        if _dataset_denied(d["id"], exposure):
            continue
        dm = doc.get("datamart") or {}
        extraction = dm.get("extraction") or {}
        out.append({
            "id": d["id"], "schema": d["schema"], "name": d["name"],
            "definition": doc.get("definition"),
            "generation_sql": dm.get("sql"),
            "functional_description": extraction.get("functional_description"),
            "source_tables": [t.get("name") for t in extraction.get("tables_referenced", [])],
        })
    return {"datamarts": out}


_HANDLERS: dict[str, Callable[[Any, dict[str, Any]], Awaitable[dict[str, Any]]]] = {
    "list_datasets": _h_list_datasets,
    "get_dataset_schema": _h_get_dataset_schema,
    "search_catalog": _h_search_catalog,
    "get_column_definition": _h_get_column_definition,
    "get_lineage": _h_get_lineage,
    "get_glossary_term": _h_get_glossary_term,
    "sample_dataset_rows": _h_sample_dataset_rows,
    "list_mcp_sources": _h_list_mcp_sources,
    "get_mcp_source_tools": _h_get_mcp_source_tools,
    "get_mcp_query_definition": _h_get_mcp_query_definition,
    "list_datamarts": _h_list_datamarts,
}


# -- server wiring ------------------------------------------------------------ #
def build_mcp_server(store) -> Server:
    server: Server = Server("doing-catalogue", version="1.0")

    @server.list_tools()
    async def list_tools() -> list[types.Tool]:
        enabled = store.mcp_config.get("tools", {})
        return [t for tid, t in TOOLS.items() if enabled.get(tid, False)]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if name not in TOOLS:
            raise ValueError(f"Unknown tool: {name}")
        if not store.mcp_config.get("tools", {}).get(name, False):
            raise ValueError(f"Tool '{name}' is disabled by the administrator.")
        return await _HANDLERS[name](store, arguments)

    return server


def create_mcp_app(store):
    """Return (asgi_app, session_manager) — mount asgi_app, run session_manager during the app lifespan."""
    server = build_mcp_server(store)
    session_manager = StreamableHTTPSessionManager(app=server, stateless=True)

    async def asgi_app(scope, receive, send):
        if scope["type"] == "http":
            cfg = store.mcp_config
            if not cfg.get("enabled"):
                await JSONResponse({"error": "MCP server is disabled"}, status_code=503)(scope, receive, send)
                return
            headers = dict(scope.get("headers") or [])
            auth_header = headers.get(b"authorization", b"").decode("latin-1")
            token = auth_header[7:] if auth_header.lower().startswith("bearer ") else ""
            token_hash = cfg.get("api_token_hash")
            if not token or not token_hash or not auth.verify_token(token, token_hash):
                await JSONResponse({"error": "unauthorized"}, status_code=401)(scope, receive, send)
                return
        await session_manager.handle_request(scope, receive, send)

    return asgi_app, session_manager
