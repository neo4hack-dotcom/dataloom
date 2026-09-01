"""
Query registry — tracks every connector call issued against a data source so
the UI can show a live "what's running" log and cancel a query in flight.

Cancellation model: the inner connector call always runs on a worker thread.
Cancelling a query unblocks the API caller immediately (the request that
launched the query — a profiling run, a discovery scan, an MCP tool call —
just stops waiting and moves on), and best-effort tries a native interrupt on
the underlying driver when one is available (see TrackedConnector.cancel).
"""
from __future__ import annotations

import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

_POLL_INTERVAL = 0.15


class QueryCancelled(Exception):
    pass


class QueryHandle:
    def __init__(self, *, connection_id: str, connection_name: str, operation: str,
                 target: str, row_limit: int | None, source: str):
        self.id = f"q_{uuid.uuid4().hex[:12]}"
        self.connection_id = connection_id
        self.connection_name = connection_name
        self.operation = operation
        self.target = target
        self.row_limit = row_limit
        self.source = source
        self.status = "running"
        self.started_at = time.time()
        self.finished_at: float | None = None
        self.rows_returned: int | None = None
        self.error: str | None = None
        self._cancel_event = threading.Event()
        self._native_cancel: Callable[[], None] | None = None

    def set_native_cancel(self, fn: Callable[[], None] | None):
        self._native_cancel = fn

    def is_cancelled(self) -> bool:
        return self._cancel_event.is_set()

    def request_cancel(self):
        self._cancel_event.set()
        if self._native_cancel:
            try:
                self._native_cancel()
            except Exception:
                pass

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "connection_id": self.connection_id,
            "connection_name": self.connection_name, "operation": self.operation,
            "target": self.target, "row_limit": self.row_limit, "source": self.source,
            "status": self.status, "started_at": self.started_at,
            "finished_at": self.finished_at, "rows_returned": self.rows_returned,
            "error": self.error,
        }


class QueryRegistry:
    def __init__(self, recent_cap: int = 200):
        self._lock = threading.RLock()
        self._active: dict[str, QueryHandle] = {}
        self._recent: list[dict[str, Any]] = []
        self._recent_cap = recent_cap
        self._pool = ThreadPoolExecutor(max_workers=16, thread_name_prefix="query")

    def start(self, **kwargs) -> QueryHandle:
        h = QueryHandle(**kwargs)
        with self._lock:
            self._active[h.id] = h
        return h

    def _finish(self, h: QueryHandle, status: str, rows_returned: int | None = None,
                error: str | None = None):
        h.status = status
        h.finished_at = time.time()
        h.rows_returned = rows_returned
        h.error = error
        with self._lock:
            self._active.pop(h.id, None)
            self._recent.insert(0, h.to_dict())
            self._recent = self._recent[: self._recent_cap]

    def cancel(self, query_id: str) -> bool:
        with self._lock:
            h = self._active.get(query_id)
        if not h:
            return False
        h.request_cancel()
        return True

    def list_active(self) -> list[dict[str, Any]]:
        with self._lock:
            return [h.to_dict() for h in self._active.values()]

    def list_recent(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._recent[:limit])

    def run_tracked(self, handle: QueryHandle, fn: Callable[[], Any]) -> Any:
        """Run `fn` on a worker thread while `handle` is active; poll for cancellation."""
        future = self._pool.submit(fn)
        while True:
            if handle.is_cancelled():
                self._finish(handle, "cancelled")
                raise QueryCancelled(f"Query {handle.id} was cancelled")
            try:
                result = future.result(timeout=_POLL_INTERVAL)
            except TimeoutError:
                continue
            except Exception as e:
                self._finish(handle, "error", error=str(e))
                raise
            else:
                rows = len(result) if isinstance(result, (list, tuple)) else None
                self._finish(handle, "done", rows_returned=rows)
                return result


registry = QueryRegistry()
