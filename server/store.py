"""
db.json-backed store with optimistic concurrency + full CRUD for all catalog elements.
"""
from __future__ import annotations

import json
import os
import threading
import time
import copy
from typing import Any

DB_PATH = os.path.join(os.path.dirname(__file__), "db.json")

_EMPTY_PROFILE: dict[str, Any] = {
    "row_count": 0, "null_ratio": 0.0, "distinct": 0, "distinct_ratio": 0.0,
    "numeric": None, "semantic_type": "unknown", "semantic_confidence": 0.0,
    "format_masks": [], "top_values": [], "is_key_candidate": False,
    "quality_score": 0.0,
    "quality_breakdown": {"completeness": 0.0, "uniqueness": 0.0, "validity": 0.0},
    "sensitivity": "PUBLIC",
}

_DEFAULT: dict[str, Any] = {
    "version": 0,
    "connections": [],
    "datasets": [],
    "docs": {},
    "matches": [],
    "relationships": [],
    "lineage": [],
    "qa_issues": [],
    "glossary": [],
    "model_notes": [],
    "runs": [],
    "audit": [],
    "settings": {
        "theme": "dark",
        "llm": {
            "base_url": "http://127.0.0.1:11434/v1",
            "api_key": "",
            "model": "qwen2.5-coder:7b",
            "temperature": 0.2,
            "max_tokens": 2048,
            "last_test": None,
        },
    },
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
                self._migrate_settings(db)
                return db
            except Exception:
                pass
        return copy.deepcopy(_DEFAULT)

    @staticmethod
    def _migrate_settings(db: dict[str, Any]) -> None:
        """Ensure settings.llm exists; migrate legacy settings.llm_model → llm.model."""
        s = db.setdefault("settings", {})
        llm = s.get("llm")
        if not isinstance(llm, dict):
            llm = copy.deepcopy(_DEFAULT["settings"]["llm"])
            if s.get("llm_model"):
                llm["model"] = s["llm_model"]
            s["llm"] = llm
        else:
            for k, v in _DEFAULT["settings"]["llm"].items():
                llm.setdefault(k, v)
        s.pop("llm_model", None)

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
            # never expose the LLM api_key to the client; surface a boolean flag
            llm = db.get("settings", {}).get("llm")
            if isinstance(llm, dict):
                llm["api_key_set"] = bool(llm.get("api_key"))
                llm.pop("api_key", None)
        return db

    # -- reset --------------------------------------------------------------- #
    def reset_catalog(self):
        """Clear all catalog data, keeping connections and settings."""
        with self._lock:
            self._db["datasets"] = []
            self._db["docs"] = {}
            self._db["matches"] = []
            self._db["relationships"] = []
            self._db["lineage"] = []
            self._db["qa_issues"] = []
            self._db["glossary"] = []
            self._db["model_notes"] = []
            self._db["runs"] = []
            self._bump("catalog.reset", "")

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

    def add_manual_dataset(self, schema: str, name: str, conn_id: str,
                           comment: str = "") -> dict[str, Any]:
        with self._lock:
            ds_id = f"{conn_id}::{schema}.{name}"
            dataset = {
                "id": ds_id, "connection_id": conn_id,
                "schema": schema, "name": name, "kind": "table",
                "row_estimate": 0, "comment": comment, "columns": [],
                "manual": True,
            }
            by_id = {d["id"]: d for d in self._db["datasets"]}
            by_id[ds_id] = dataset
            self._db["datasets"] = list(by_id.values())
            self._bump("dataset.add", ds_id)
            return dataset

    def delete_dataset(self, ds_id: str):
        with self._lock:
            self._db["datasets"] = [d for d in self._db["datasets"] if d["id"] != ds_id]
            self._db["docs"].pop(ds_id, None)
            self._db["relationships"] = [
                r for r in self._db["relationships"]
                if r["child"]["dataset_id"] != ds_id and r["parent"]["dataset_id"] != ds_id]
            self._db["lineage"] = [
                e for e in self._db["lineage"] if e["from"] != ds_id and e["to"] != ds_id]
            self._bump("dataset.delete", ds_id)

    def datasets(self) -> list[dict[str, Any]]:
        return self._db["datasets"]

    def all_columns(self) -> list[dict[str, Any]]:
        out = []
        for d in self._db["datasets"]:
            out.extend(d["columns"])
        return out

    def add_manual_column(self, ds_id: str, col: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            for d in self._db["datasets"]:
                if d["id"] == ds_id:
                    pos = len(d["columns"]) + 1
                    entry = {
                        "name": col["name"],
                        "data_type": col.get("data_type", "VARCHAR"),
                        "nullable": col.get("nullable", True),
                        "position": pos,
                        "profile": copy.deepcopy(_EMPTY_PROFILE),
                        "dataset_id": ds_id,
                        "manual": True,
                    }
                    # Seed semantic type if provided
                    if col.get("semantic_type"):
                        entry["profile"]["semantic_type"] = col["semantic_type"]
                    d["columns"].append(entry)
                    self._bump("column.add", f"{ds_id}.{col['name']}")
                    return entry
            raise ValueError(f"Dataset {ds_id} not found")

    def delete_column(self, ds_id: str, col_name: str):
        with self._lock:
            for d in self._db["datasets"]:
                if d["id"] == ds_id:
                    d["columns"] = [c for c in d["columns"] if c["name"] != col_name]
                    doc = self._db["docs"].get(ds_id, {})
                    if "columns" in doc:
                        doc["columns"].pop(col_name, None)
                    self._bump("column.delete", f"{ds_id}.{col_name}")
                    return
            raise ValueError(f"Dataset {ds_id} not found")

    def set_dataset_doc(self, ds_id: str, doc: dict[str, Any]):
        with self._lock:
            self._db["docs"][ds_id] = doc
            self._bump("doc.set", ds_id)

    def get_dataset_doc(self, ds_id: str) -> dict[str, Any] | None:
        return self._db["docs"].get(ds_id)

    def update_dataset_meta(self, ds_id: str, patch: dict[str, Any]):
        """Update table-level definition, domain, comment."""
        with self._lock:
            doc = self._db["docs"].setdefault(ds_id, {})
            for k, v in patch.items():
                if v is not None:
                    doc[k] = v
            # Also update comment on the dataset itself
            for d in self._db["datasets"]:
                if d["id"] == ds_id:
                    if "comment" in patch:
                        d["comment"] = patch["comment"]
            self._bump("dataset.meta", ds_id)

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

    def dismiss_match(self, idx: int):
        with self._lock:
            if 0 <= idx < len(self._db["matches"]):
                self._db["matches"].pop(idx)
                self._bump("match.dismiss", str(idx))

    def set_relationships(self, r):
        with self._lock:
            self._db["relationships"] = r; self._bump("rel.set", str(len(r)))

    def relationships(self): return self._db["relationships"]

    def add_relationship(self, rel: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            rel.setdefault("status", "validated")
            rel.setdefault("manual", True)
            self._db["relationships"].append(rel)
            self._bump("rel.add", f"{rel.get('child',{}).get('column')} -> {rel.get('parent',{}).get('column')}")
            return rel

    def update_relationship_status(self, idx: int, status: str):
        with self._lock:
            if 0 <= idx < len(self._db["relationships"]):
                self._db["relationships"][idx]["status"] = status
                self._bump("rel.status", f"{idx}:{status}")

    def delete_relationship(self, idx: int):
        with self._lock:
            if 0 <= idx < len(self._db["relationships"]):
                r = self._db["relationships"].pop(idx)
                self._bump("rel.delete", str(idx))

    def set_lineage(self, e):
        with self._lock:
            self._db["lineage"] = e; self._bump("lineage.set", str(len(e)))

    def add_lineage_edge(self, edge: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            edge.setdefault("manual", True)
            edge.setdefault("confidence", 100)
            self._db["lineage"].append(edge)
            self._bump("lineage.add", f"{edge.get('from')} -> {edge.get('to')}")
            return edge

    def delete_lineage_edge(self, idx: int):
        with self._lock:
            if 0 <= idx < len(self._db["lineage"]):
                self._db["lineage"].pop(idx)
                self._bump("lineage.delete", str(idx))

    def set_qa_issues(self, i):
        with self._lock:
            self._db["qa_issues"] = i; self._bump("qa.set", str(len(i)))

    def dismiss_qa_issue(self, idx: int):
        with self._lock:
            if 0 <= idx < len(self._db["qa_issues"]):
                self._db["qa_issues"].pop(idx)
                self._bump("qa.dismiss", str(idx))

    # -- glossary / notes ---------------------------------------------------- #
    def glossary_def(self, term: str) -> str:
        return next((g["definition"] for g in self._db["glossary"]
                     if g["term"] == term and g.get("definition")), "")

    def add_glossary_term(self, term: str, definition: str = "") -> dict[str, Any]:
        with self._lock:
            existing = {g["term"] for g in self._db["glossary"]}
            if term in existing:
                raise ValueError(f"Term '{term}' already exists")
            entry = {"term": term, "definition": definition, "occurrences": 0, "columns": [], "manual": True}
            self._db["glossary"].append(entry)
            self._bump("glossary.add", term)
            return entry

    def delete_glossary_term(self, term: str):
        with self._lock:
            self._db["glossary"] = [g for g in self._db["glossary"] if g["term"] != term]
            self._bump("glossary.delete", term)

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
            self._flush()

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

    @property
    def llm_config(self) -> dict[str, Any]:
        return self._db["settings"].get("llm", {})

    def update_llm_config(self, patch: dict[str, Any]):
        """Merge a partial LLM config. Empty api_key is ignored (keep existing)."""
        with self._lock:
            llm = self._db["settings"].setdefault("llm", {})
            for k in ("base_url", "model", "temperature", "max_tokens"):
                if k in patch and patch[k] is not None:
                    llm[k] = patch[k]
            # only overwrite api_key when a non-empty value is provided
            if patch.get("api_key"):
                llm["api_key"] = patch["api_key"]
            self._bump("settings.llm", f"{llm.get('base_url')} / {llm.get('model') or '(default)'}")
            return llm

    def set_llm_last_test(self, result: dict[str, Any]):
        with self._lock:
            self._db["settings"].setdefault("llm", {})["last_test"] = result
            self._flush()  # not version-bumping (transient diagnostic)
