"""
MCP client — connects DOINg.Catalogue OUT to another application's MCP server
as a data source, the mirror image of the MCP server this app already exposes
(see mcp_server.py). An MCP server has no declared table/column schema like a
SQL warehouse does — it exposes arbitrary named tools — so this module only
speaks the raw protocol (discover tools, call one, walk its JSON result).
See engine.explore.map_mcp_tools for the LLM-assisted step that turns tool
outputs into a table/column mapping, and engine.connectors.MCPConnector for
the read side that plugs that mapping into the standard profiling pipeline.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client


def _headers(token: str | None) -> dict[str, str] | None:
    return {"Authorization": f"Bearer {token}"} if token else None


def _result_to_json(result: Any) -> Any:
    if getattr(result, "structuredContent", None) is not None:
        return result.structuredContent
    for block in getattr(result, "content", []) or []:
        if getattr(block, "type", None) == "text":
            try:
                return json.loads(block.text)
            except (ValueError, TypeError):
                return block.text
    return None


async def _discover(url: str, token: str | None) -> list[dict[str, Any]]:
    async with streamablehttp_client(url, headers=_headers(token)) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.list_tools()
            return [{"name": t.name, "description": t.description or "",
                     "input_schema": t.inputSchema or {}} for t in result.tools]


async def _call_tool(url: str, token: str | None, name: str, args: dict[str, Any]) -> Any:
    async with streamablehttp_client(url, headers=_headers(token)) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(name, args)
            if result.isError:
                raise RuntimeError(f"MCP tool '{name}' returned an error")
            return _result_to_json(result)


def discover_sync(url: str, token: str | None = None) -> list[dict[str, Any]]:
    """List every tool the remote MCP server exposes."""
    return asyncio.run(_discover(url, token))


def call_tool_sync(url: str, token: str | None, name: str, args: dict[str, Any] | None = None) -> Any:
    """Call one tool and return its parsed JSON (or raw text) result."""
    return asyncio.run(_call_tool(url, token, name, args or {}))


def ping_sync(url: str, token: str | None = None) -> bool:
    try:
        discover_sync(url, token)
        return True
    except Exception:
        return False


def extract_records(result: Any, row_path: str | None) -> list[dict[str, Any]]:
    """Walk a dot-path (e.g. "data.items") into a tool's JSON result to reach
    the list of records. An empty/None row_path means the result IS the list —
    a single-object result becomes a one-row table."""
    node = result
    if row_path:
        for key in row_path.split("."):
            if isinstance(node, dict) and key in node:
                node = node[key]
            else:
                return []
    if isinstance(node, list):
        return [r for r in node if isinstance(r, dict)]
    if isinstance(node, dict):
        return [node]
    return []


_TOTAL_KEYS = ("total", "total_count", "totalCount", "count", "total_items", "totalItems")


def extract_total(result: Any) -> int | None:
    """Best-effort scan for a declared total-count field alongside a page of
    records, so row estimates don't just fall back to len(sample)."""
    if isinstance(result, dict):
        for k in _TOTAL_KEYS:
            v = result.get(k)
            if isinstance(v, int):
                return v
    return None
