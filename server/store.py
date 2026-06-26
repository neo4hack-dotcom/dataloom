"""
db.json-backed store with optimistic concurrency.

The whole catalog lives in a single JSON document guarded by a monotonically
increasing integer `version`. Mutating HTTP endpoints must send the version they
last read in the `X-Base-Version` header; a mismatch -> HTTP 409 (handled in
main.py). Every accepted mutation bumps the version and appends to an audit log
(time-travel). A thread lock serializes writes (agents run in background threads).
"""
from __future__ import annotations

import json
import os
import threading
import time
import copy
from typing import Any

DB_PATH = os.path.join(os.path.dirname(__file__), "db.json")

_DEFAULT: dict[str, Any] = {
    "version": 0,
    "connections": [],
    "datasets": [],          # profiled tables (incl. column profiles)
    "docs": {},              # dataset_id -> {definition, domain, columns:{...}}
    "matches": [],           # same-field candidate pairs
    "relationships": [],     # inferred PK/FK
    "lineage": [],           # lineage edges
    "qa_issues": [],
    "glossary": [],
    "model_notes": [],       # user free-text model/mapping explanations
    "runs": [],              # agent run history (with logs)
    "audit": [],             # time-travel log of mutations
    "settings": {"llm_model": "qwen2.5-coder:7b", "theme": "dark"},
}


class Store:
    def __init__(self, path: str = DB_PATH):
        self.path = path
        self._lock = threading.RLock()
        self._db = self._load()

    # -- io ------------------------------------------------------------------ #
    def _load(self) -> dict[str, Any]:
        if os.path.exists(self.path):
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    db = json.load(f)
                for k, v in _DEFAULT.items():
                    db.setdefault(k, copy.deepcopy(v))
                return db
            except Exception:
                pass
        return copy.deepcopy(_DEFAULT)

    def _flush(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self._db, f, ensure_ascii=False, default=str)
        os.replace(tmp, self.path)

    # -- versioning ---------------------------------------------------------- #
    @property
    def version(self) -> int:
        return self._db["version"]

    def _bump(self, action: str, detail: str = ""):
        self._db["version"] += 1
        self._db["audit"].insert(0, {
            "version": self._db["version"], "ts": time.time(),
            "action": action, "detail": detail,
        })
        self._db["audit"] = self._db["audit"][:300]
        self._flush()

    def check_version(self, base: int | None) -> bool:
        return base is None or int(base) == self._db["version"]

    # -- public snapshot ----------------------------------------------------- #
    def snapshot(self, *, trim: bool = True) -> dict[str, Any]:
        with self._lock:
            db = copy.deepcopy(self._db)
        if trim:
            for d in db["datasets"]:
                for c in d["columns"]:
                    c["profile"].pop("_minhash", None)
                    c["profile"].pop("_sample_hashes", None)
        return db

    # -- connections --------------------------------------------------------- #
    def add_connection(self, conn: dict[str, Any]):
        with self._lock:
            conn.setdefault("id", f"conn_{int(time.time()*1000)}")
            conn.setdefault("created_at", time.time())
            self._db["connections"].append(conn)
            self._bump("connection.add", conn["name"])
            return conn

    def get_connection(self, cid: str) -> dict[str, Any] | None:
        return next((c for c in self._db["connections"] if c["id"] == cid), None)

    def delete_connection(self, cid: str):
        with self._lock:
            self._db["connections"] = [c for c in self._db["connections"] if c["id"] != cid]
            self._db["datasets"] = [d for d in self._db["datasets"] if d["connection_id"] != cid]
            self._bump("connection.delete", cid)

    # -- datasets / docs ----------------------------------------------------- #
    def upsert_datasets(self, datasets: list[dict[str, Any]]):
        with self._lock:
            by_id = {d["id"]: d for d in self._db["datasets"]}
            for d in datasets:
                by_id[d["id"]] = d
            self._db["datasets"] = list(by_id.values())
            self._bump("datasets.upsert", f"{len(datasets)} tables")

    def datasets(self) -> list[dict[str, Any]]:
        return self._db["datasets"]

    def all_columns(self) -> list[dict[str, Any]]:
        out = []
        for d in self._db["datasets"]:
            out.extend(d["columns"])
        return out

    def set_dataset_doc(self, ds_id: str, doc: dict[str, Any]):
        with self._lock:
            self._db["docs"][ds_id] = doc
            self._bump("doc.set", ds_id)

    def get_dataset_doc(self, ds_id: str) -> dict[str, Any] | None:
        return self._db["docs"].get(ds_id)

    def update_column_doc(self, ds_id: str, col: str, patch: dict[str, Any]):
        with self._lock:
            doc = self._db["docs"].setdefault(ds_id, {"columns": {}})
            cols = doc.setdefault("columns", {})
            cols.setdefault(col, {})
            cols[col].update(patch)
            self._bump("col.update", f"{ds_id}.{col}")

    # -- analysis results ---------------------------------------------------- #
    def set_matches(self, m):
        with self._lock:
            self._db["matches"] = m; self._bump("matches.set", str(len(m)))

    def set_relationships(self, r):
        with self._lock:
            self._db["relationships"] = r; self._bump("rel.set", str(len(r)))

    def relationships(self): return self._db["relationships"]

    def update_relationship_status(self, idx: int, status: str):
        with self._lock:
            if 0 <= idx < len(self._db["relationships"]):
                self._db["relationships"][idx]["status"] = status
                self._bump("rel.status", f"{idx}:{status}")

    def set_lineage(self, e):
        with self._lock:
            self._db["lineage"] = e; self._bump("lineage.set", str(len(e)))

    def set_qa_issues(self, i):
        with self._lock:
            self._db["qa_issues"] = i; self._bump("qa.set", str(len(i)))

    # -- glossary / notes ---------------------------------------------------- #
    def glossary_def(self, term: str) -> str:
        return next((g["definition"] for g in self._db["glossary"]
                     if g["term"] == term and g.get("definition")), "")

    def merge_glossary(self, terms: list[dict[str, Any]]):
        with self._lock:
            existing = {g["term"]: g for g in self._db["glossary"]}
            for t in terms:
                if t["term"] in existing:
                    existing[t["term"]].update({k: v for k, v in t.items() if k != "definition" or v})
                else:
                    existing[t["term"]] = t
            self._db["glossary"] = list(existing.values())
            self._bump("glossary.merge", str(len(terms)))

    def update_glossary_def(self, term: str, definition: str):
        with self._lock:
            for g in self._db["glossary"]:
                if g["term"] == term:
                    g["definition"] = definition
                    break
            self._bump("glossary.def", term)

    def model_notes(self): return self._db["model_notes"]

    def add_model_note(self, text: str):
        with self._lock:
            note = {"id": f"note_{int(time.time()*1000)}", "text": text, "ts": time.time()}
            self._db["model_notes"].append(note)
            self._bump("note.add", "")
            return note

    # -- runs ---------------------------------------------------------------- #
    def create_run(self, conn_id: str, agent_ids: list[str]) -> dict[str, Any]:
        with self._lock:
            run = {"id": f"run_{int(time.time()*1000)}", "connection_id": conn_id,
                   "agents": agent_ids, "status": "queued", "progress": 0.0,
                   "current_agent": None, "logs": [], "created_at": time.time(),
                   "summary": {}}
            self._db["runs"].insert(0, run)
            self._db["runs"] = self._db["runs"][:50]
            self._bump("run.create", run["id"])
            return run

    def update_run(self, run_id: str, patch: dict[str, Any]):
        with self._lock:
            for r in self._db["runs"]:
                if r["id"] == run_id:
                    r.update(patch)
                    break
            self._flush()  # frequent, don't bump version (UI polls separately)

    def append_run_log(self, run_id: str, entry: dict[str, Any]):
        with self._lock:
            for r in self._db["runs"]:
                if r["id"] == run_id:
                    r["logs"].append(entry)
                    r["logs"] = r["logs"][-400:]
                    break
            self._flush()

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        return next((r for r in self._db["runs"] if r["id"] == run_id), None)

    def runs(self): return self._db["runs"]

    # -- settings ------------------------------------------------------------ #
    def update_settings(self, patch: dict[str, Any]):
        with self._lock:
            self._db["settings"].update(patch)
            self._bump("settings", "")
