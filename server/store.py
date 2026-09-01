"""
db.json-backed store with optimistic concurrency + full CRUD for all catalog elements.
"""
from __future__ import annotations

import json
import os
import secrets
import string
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
    "users": [],
    "sessions": {},
    "admin_reset": {"code": None, "expires_at": None},
    "domains": [],
    "column_lineage": [],
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
        "connectors": {
            "row_fetch_limit": 100,
        },
        "alerts": {
            "quality_score_warn": 60,
            "quality_score_critical": 35,
            "null_ratio_warn": 0.5,
            "row_drift_warn_pct": 20,
            "require_pii_validation": True,
            "stale_days_warn": 30,
        },
        "mcp": {
            "enabled": False,
            "api_token_hash": None,
            "api_token_prefix": None,
            "tools": {
                "list_datasets": True,
                "get_dataset_schema": True,
                "search_catalog": True,
                "get_column_definition": True,
                "get_lineage": False,
                "get_glossary_term": True,
                "sample_dataset_rows": False,
            },
            "exposure": {
                "hide_pii": True,
                "denied_datasets": [],
                "denied_columns": [],
            },
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
        """Ensure settings.llm/connectors/mcp exist; migrate legacy settings.llm_model → llm.model."""
        db.setdefault("users", [])
        db.setdefault("sessions", {})
        db.setdefault("admin_reset", {"code": None, "expires_at": None})
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

        connectors = s.get("connectors")
        if not isinstance(connectors, dict):
            connectors = copy.deepcopy(_DEFAULT["settings"]["connectors"])
            s["connectors"] = connectors
        else:
            for k, v in _DEFAULT["settings"]["connectors"].items():
                connectors.setdefault(k, v)

        mcp_cfg = s.get("mcp")
        if not isinstance(mcp_cfg, dict):
            mcp_cfg = copy.deepcopy(_DEFAULT["settings"]["mcp"])
            s["mcp"] = mcp_cfg
        else:
            for k, v in _DEFAULT["settings"]["mcp"].items():
                if k in ("tools", "exposure"):
                    sub = mcp_cfg.setdefault(k, {})
                    for sk, sv in v.items():
                        sub.setdefault(sk, sv)
                else:
                    mcp_cfg.setdefault(k, v)

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
        # users/sessions/secrets never travel through the catalog snapshot
        db.pop("users", None)
        db.pop("sessions", None)
        db.pop("admin_reset", None)
        mcp_cfg = db.get("settings", {}).get("mcp")
        if isinstance(mcp_cfg, dict):
            mcp_cfg.pop("api_token_hash", None)
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
            self._db["domains"] = []
            self._db["column_lineage"] = []
            self._bump("catalog.reset", "")

    # -- backup / restore ---------------------------------------------------- #
    def restore_backup(self, backup: dict[str, Any], mode: str = "replace") -> dict[str, Any]:
        """
        Restore a previously exported full snapshot.
          mode='replace' → wipe and load the backup exactly.
          mode='merge'   → append datasets/connections/etc. that aren't already present
                           (by id / key), keeping current items.
        Returns a small summary.
        """
        with self._lock:
            data = backup.get("data", backup) if isinstance(backup, dict) else {}
            if not isinstance(data, dict):
                raise ValueError("invalid backup")
            if mode == "replace":
                merged = copy.deepcopy(_DEFAULT)
                for k in _DEFAULT:
                    if k in data and k != "version":
                        merged[k] = data[k]
                merged["version"] = self._db["version"] + 1
                self._db = merged
                self._migrate_settings(self._db)
                summary = {k: (len(data[k]) if isinstance(data.get(k), list) else 1)
                           for k in ("connections", "datasets", "relationships", "glossary") if k in data}
            else:  # merge
                def by_id(lst, key="id"):
                    return {x.get(key): x for x in lst if isinstance(x, dict)}
                # connections + datasets by id; docs/settings by key
                cur_conn = by_id(self._db["connections"])
                for c in data.get("connections", []):
                    cur_conn.setdefault(c.get("id"), c)
                self._db["connections"] = list(cur_conn.values())
                cur_ds = by_id(self._db["datasets"])
                for d in data.get("datasets", []):
                    cur_ds.setdefault(d.get("id"), d)
                self._db["datasets"] = list(cur_ds.values())
                self._db["docs"] = {**data.get("docs", {}), **self._db["docs"]}
                for key in ("relationships", "matches", "lineage", "glossary", "model_notes"):
                    self._db[key] = self._db.get(key, []) + data.get(key, [])
                summary = {"merged_datasets": len(data.get("datasets", [])),
                           "merged_connections": len(data.get("connections", []))}
            self._bump("backup.restore", mode)
            return summary

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

    def update_connection(self, cid: str, patch: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            conn = self.get_connection(cid)
            if not conn:
                raise ValueError("connection not found")
            for k in ("name", "config", "llm_model"):
                if k in patch and patch[k] is not None:
                    conn[k] = patch[k]
            self._bump("connection.update", conn["name"])
            return conn

    def delete_connection(self, cid: str):
        with self._lock:
            self._db["connections"] = [c for c in self._db["connections"] if c["id"] != cid]
            self._db["datasets"] = [d for d in self._db["datasets"] if d["connection_id"] != cid]
            self._bump("connection.delete", cid)

    # -- discovery & scope (big-volume sources) ------------------------------ #
    def set_discovered_tables(self, cid: str, tables: list[dict[str, Any]]):
        """Store the lightweight table inventory (no profiling) for a connection."""
        with self._lock:
            conn = self.get_connection(cid)
            if not conn:
                raise ValueError("connection not found")
            conn["discovered_tables"] = tables
            conn["discovered_at"] = time.time()
            self._bump("connection.discover", f"{cid}: {len(tables)} tables")
            return tables

    def set_scope(self, cid: str, keys: list[str], row_limits: dict[str, int] | None = None):
        """Persist the user-selected scope (list of 'schema.name') for a connection,
        plus an optional per-table row-fetch limit chosen after a row-count check."""
        with self._lock:
            conn = self.get_connection(cid)
            if not conn:
                raise ValueError("connection not found")
            conn["scope"] = keys
            if row_limits is not None:
                conn["scope_row_limits"] = row_limits
            self._bump("connection.scope", f"{cid}: {len(keys)} tables")
            return keys

    def get_scope(self, cid: str) -> list[str]:
        conn = self.get_connection(cid)
        return (conn or {}).get("scope", [])

    def set_table_row_count(self, cid: str, table_key: str, count: int):
        """Cache the last known live row count for one table (informational, refreshable)."""
        with self._lock:
            conn = self.get_connection(cid)
            if not conn:
                raise ValueError("connection not found")
            counts = conn.setdefault("scope_row_counts", {})
            counts[table_key] = count
            conn.setdefault("scope_row_counts_at", {})[table_key] = time.time()
            self._flush()  # informational cache — not version-bumping

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
            self._db["column_lineage"] = [
                e for e in self._db["column_lineage"]
                if e["from"]["dataset_id"] != ds_id and e["to"]["dataset_id"] != ds_id]
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
        """Merge agent-generated fields into the dataset's doc — never replaces it
        wholesale, so tags/domain/owners/deprecation/custom_properties/usage stats
        and any human-validated column definition survive an agent re-run."""
        with self._lock:
            existing = self._db["docs"].setdefault(ds_id, {})
            incoming_cols = doc.get("columns")
            for k, v in doc.items():
                if k != "columns":
                    existing[k] = v
            if incoming_cols:
                cols = existing.setdefault("columns", {})
                for name, cd in incoming_cols.items():
                    if (cols.get(name) or {}).get("status") == "validated":
                        continue  # never let an agent overwrite a human-validated column
                    cols[name] = cd
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

    # -- LLM output caches (never re-call the LLM for a preview already seen) - #
    def cache_column_suggestion(self, ds_id: str, col: str, suggestion: dict[str, Any]):
        with self._lock:
            doc = self._db["docs"].setdefault(ds_id, {"columns": {}})
            cols = doc.setdefault("columns", {})
            cols.setdefault(col, {})
            cols[col]["llm_suggestion"] = {**suggestion, "cached_at": time.time()}
            self._bump("doc.suggestion_cache", f"{ds_id}.{col}")

    def cache_table_suggestion(self, ds_id: str, suggestion: dict[str, Any]):
        with self._lock:
            doc = self._db["docs"].setdefault(ds_id, {})
            doc["llm_table_suggestion"] = {**suggestion, "cached_at": time.time()}
            self._bump("doc.table_suggestion_cache", ds_id)

    def cache_mapping_detection(self, ds_id: str, result: dict[str, Any]):
        with self._lock:
            doc = self._db["docs"].setdefault(ds_id, {})
            doc["llm_mapping_detection"] = {**result, "cached_at": time.time()}
            self._bump("doc.mapping_cache", ds_id)

    def cache_relationship_explanation(self, child_ds: str, child_col: str,
                                       parent_ds: str, parent_col: str, explanation: dict[str, Any]):
        with self._lock:
            for r in self._db["relationships"]:
                if (r["child"]["dataset_id"] == child_ds and r["child"]["column"] == child_col and
                        r["parent"]["dataset_id"] == parent_ds and r["parent"]["column"] == parent_col):
                    r["explanation"] = {**explanation, "cached_at": time.time()}
                    break
            self._bump("rel.explanation_cache", f"{child_ds}.{child_col}")

    # -- tags ------------------------------------------------------------------ #
    def add_dataset_tag(self, ds_id: str, tag: str):
        with self._lock:
            doc = self._db["docs"].setdefault(ds_id, {})
            tags = doc.setdefault("tags", [])
            if tag not in tags:
                tags.append(tag)
            self._bump("tag.add", f"{ds_id}:{tag}")

    def remove_dataset_tag(self, ds_id: str, tag: str):
        with self._lock:
            doc = self._db["docs"].get(ds_id) or {}
            if tag in (doc.get("tags") or []):
                doc["tags"].remove(tag)
            self._bump("tag.remove", f"{ds_id}:{tag}")

    def add_column_tag(self, ds_id: str, col: str, tag: str):
        with self._lock:
            doc = self._db["docs"].setdefault(ds_id, {"columns": {}})
            cols = doc.setdefault("columns", {})
            cols.setdefault(col, {})
            tags = cols[col].setdefault("tags", [])
            if tag not in tags:
                tags.append(tag)
            self._bump("tag.add_col", f"{ds_id}.{col}:{tag}")

    def remove_column_tag(self, ds_id: str, col: str, tag: str):
        with self._lock:
            doc = self._db["docs"].get(ds_id) or {}
            cdoc = (doc.get("columns") or {}).get(col) or {}
            if tag in (cdoc.get("tags") or []):
                cdoc["tags"].remove(tag)
            self._bump("tag.remove_col", f"{ds_id}.{col}:{tag}")

    # -- domains (hierarchical) ------------------------------------------------ #
    def list_domains(self) -> list[dict[str, Any]]:
        return self._db["domains"]

    def add_domain(self, name: str, parent_id: str | None, description: str, color: str) -> dict[str, Any]:
        with self._lock:
            domain = {"id": f"dom_{int(time.time()*1000)}", "name": name,
                     "parent_id": parent_id, "description": description, "color": color}
            self._db["domains"].append(domain)
            self._bump("domain.add", name)
            return domain

    def update_domain(self, domain_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            d = next((x for x in self._db["domains"] if x["id"] == domain_id), None)
            if not d:
                raise ValueError("domain not found")
            for k in ("name", "parent_id", "description", "color"):
                if k in patch and patch[k] is not None:
                    d[k] = patch[k]
            self._bump("domain.update", domain_id)
            return d

    def delete_domain(self, domain_id: str):
        with self._lock:
            if any(x.get("parent_id") == domain_id for x in self._db["domains"]):
                raise ValueError("delete or move sub-domains first")
            self._db["domains"] = [x for x in self._db["domains"] if x["id"] != domain_id]
            for doc in self._db["docs"].values():
                if doc.get("domain_id") == domain_id:
                    doc["domain_id"] = None
            self._bump("domain.delete", domain_id)

    def set_dataset_domain(self, ds_id: str, domain_id: str | None):
        with self._lock:
            doc = self._db["docs"].setdefault(ds_id, {})
            doc["domain_id"] = domain_id
            self._bump("domain.assign", f"{ds_id}->{domain_id}")

    # -- ownership -------------------------------------------------------------- #
    def add_dataset_owner(self, ds_id: str, owner: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            doc = self._db["docs"].setdefault(ds_id, {})
            owners = doc.setdefault("owners", [])
            owner = {**owner, "id": owner.get("id") or f"own_{int(time.time()*1000)}"}
            owners.append(owner)
            self._bump("owner.add", f"{ds_id}:{owner.get('name')}")
            return owner

    def remove_dataset_owner(self, ds_id: str, owner_id: str):
        with self._lock:
            doc = self._db["docs"].get(ds_id) or {}
            doc["owners"] = [o for o in (doc.get("owners") or []) if o["id"] != owner_id]
            self._bump("owner.remove", f"{ds_id}:{owner_id}")

    # -- deprecation -------------------------------------------------------------- #
    def set_deprecation(self, ds_id: str, info: dict[str, Any] | None):
        with self._lock:
            doc = self._db["docs"].setdefault(ds_id, {})
            doc["deprecated"] = info
            self._bump("deprecation.set", ds_id)

    # -- usage / popularity (informational — not version-bumping) -------------- #
    def record_dataset_view(self, ds_id: str):
        with self._lock:
            doc = self._db["docs"].setdefault(ds_id, {})
            doc["view_count"] = int(doc.get("view_count") or 0) + 1
            doc["last_viewed_at"] = time.time()
            self._flush()

    # -- custom / structured properties ----------------------------------------- #
    def set_custom_property(self, ds_id: str, key: str, value: str):
        with self._lock:
            doc = self._db["docs"].setdefault(ds_id, {})
            props = doc.setdefault("custom_properties", {})
            props[key] = value
            self._bump("property.set", f"{ds_id}:{key}")

    def delete_custom_property(self, ds_id: str, key: str):
        with self._lock:
            doc = self._db["docs"].get(ds_id) or {}
            (doc.get("custom_properties") or {}).pop(key, None)
            self._bump("property.delete", f"{ds_id}:{key}")

    # -- profile history (drives row-count-drift health check) ------------------ #
    def record_profile_snapshot(self, ds_id: str, row_estimate: int, ts: float):
        with self._lock:
            doc = self._db["docs"].setdefault(ds_id, {})
            history = doc.setdefault("profile_history", [])
            history.append({"row_estimate": row_estimate, "ts": ts})
            doc["profile_history"] = history[-10:]
            self._flush()  # informational — the profiling run itself bumps the version

    # -- column-level lineage (explicit non-FK derivations) ---------------------- #
    def add_column_lineage_edge(self, edge: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            edge.setdefault("manual", True)
            edge.setdefault("confidence", 100)
            self._db["column_lineage"].append(edge)
            self._bump("col_lineage.add",
                      f"{edge['from']['dataset_id']}.{edge['from']['column']} -> "
                      f"{edge['to']['dataset_id']}.{edge['to']['column']}")
            return edge

    def delete_column_lineage_edge(self, idx: int):
        with self._lock:
            if 0 <= idx < len(self._db["column_lineage"]):
                self._db["column_lineage"].pop(idx)
                self._bump("col_lineage.delete", str(idx))

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

    def merge_relationships(self, new_rels: list[dict[str, Any]]):
        """Re-run of the Linker agent: refresh auto-inferred relationships without
        losing what a human already did to them — a validated/rejected status or a
        cached AI explanation carries over, and manually-added edges are never dropped."""
        def rel_key(r):
            c, p = r.get("child") or {}, r.get("parent") or {}
            return (c.get("dataset_id"), c.get("column"), p.get("dataset_id"), p.get("column"))
        with self._lock:
            existing_by_key = {rel_key(r): r for r in self._db["relationships"]}
            merged = []
            for r in new_rels:
                old = existing_by_key.get(rel_key(r))
                if old:
                    r = {**r}
                    if old.get("status"):
                        r["status"] = old["status"]
                    if old.get("explanation"):
                        r["explanation"] = old["explanation"]
                merged.append(r)
            merged_keys = {rel_key(r) for r in merged}
            for r in self._db["relationships"]:
                if r.get("manual") and rel_key(r) not in merged_keys:
                    merged.append(r)
            self._db["relationships"] = merged
            self._bump("rel.set", str(len(merged)))

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
                   "summary": {}, "cancel_requested": False}
            self._db["runs"].insert(0, run)
            self._db["runs"] = self._db["runs"][:50]
            self._bump("run.create", run["id"])
            return run

    def request_run_cancel(self, run_id: str) -> bool:
        """Ask an in-progress run to stop between agents/tables (checked cooperatively)."""
        with self._lock:
            for r in self._db["runs"]:
                if r["id"] == run_id:
                    if r["status"] not in ("queued", "running"):
                        return False
                    r["cancel_requested"] = True
                    self._flush()
                    return True
            return False

    def is_run_cancel_requested(self, run_id: str) -> bool:
        r = self.get_run(run_id)
        return bool(r and r.get("cancel_requested"))

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

    @property
    def connector_settings(self) -> dict[str, Any]:
        return self._db["settings"].get("connectors", {})

    def update_connector_settings(self, patch: dict[str, Any]):
        with self._lock:
            cfg = self._db["settings"].setdefault("connectors", {})
            if "row_fetch_limit" in patch and patch["row_fetch_limit"] is not None:
                cfg["row_fetch_limit"] = max(1, int(patch["row_fetch_limit"]))
            self._bump("settings.connectors", f"row_fetch_limit={cfg.get('row_fetch_limit')}")
            return cfg

    @property
    def alert_settings(self) -> dict[str, Any]:
        return self._db["settings"].get("alerts", {})

    def update_alert_settings(self, patch: dict[str, Any]):
        with self._lock:
            cfg = self._db["settings"].setdefault("alerts", {})
            for k in ("quality_score_warn", "quality_score_critical", "row_drift_warn_pct", "stale_days_warn"):
                if patch.get(k) is not None:
                    cfg[k] = max(0, int(patch[k]))
            if patch.get("null_ratio_warn") is not None:
                cfg["null_ratio_warn"] = max(0.0, min(1.0, float(patch["null_ratio_warn"])))
            if patch.get("require_pii_validation") is not None:
                cfg["require_pii_validation"] = bool(patch["require_pii_validation"])
            self._bump("settings.alerts", "updated")
            return cfg

    @property
    def mcp_config(self) -> dict[str, Any]:
        return self._db["settings"].get("mcp", {})

    def update_mcp_config(self, patch: dict[str, Any]):
        """Merge a partial MCP config (enabled / tools / exposure)."""
        with self._lock:
            cfg = self._db["settings"].setdefault("mcp", {})
            if "enabled" in patch and patch["enabled"] is not None:
                cfg["enabled"] = bool(patch["enabled"])
            if isinstance(patch.get("tools"), dict):
                cfg.setdefault("tools", {}).update(patch["tools"])
            if isinstance(patch.get("exposure"), dict):
                exp = cfg.setdefault("exposure", {})
                for k in ("hide_pii", "denied_datasets", "denied_columns"):
                    if k in patch["exposure"] and patch["exposure"][k] is not None:
                        exp[k] = patch["exposure"][k]
            self._bump("settings.mcp", "config updated")
            return cfg

    def set_mcp_token(self, token_hash: str | None, prefix: str | None):
        with self._lock:
            cfg = self._db["settings"].setdefault("mcp", {})
            cfg["api_token_hash"] = token_hash
            cfg["api_token_prefix"] = prefix
            self._bump("settings.mcp.token", "token rotated" if token_hash else "token revoked")
            return cfg

    # -- users ----------------------------------------------------------------- #
    def has_users(self) -> bool:
        return len(self._db["users"]) > 0

    def add_user(self, username: str, password_hash: str, role: str) -> dict[str, Any]:
        with self._lock:
            if any(u["username"].lower() == username.lower() for u in self._db["users"]):
                raise ValueError(f"User '{username}' already exists")
            user = {
                "id": f"user_{int(time.time()*1000)}", "username": username,
                "password_hash": password_hash, "role": role, "active": True,
                "created_at": time.time(),
            }
            self._db["users"].append(user)
            self._bump("user.add", username)
            return user

    def get_user(self, uid: str) -> dict[str, Any] | None:
        return next((u for u in self._db["users"] if u["id"] == uid), None)

    def get_user_by_username(self, username: str) -> dict[str, Any] | None:
        return next((u for u in self._db["users"] if u["username"].lower() == username.lower()), None)

    def list_users(self) -> list[dict[str, Any]]:
        return self._db["users"]

    def update_user(self, uid: str, patch: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            user = self.get_user(uid)
            if not user:
                raise ValueError("user not found")
            for k in ("role", "active", "password_hash"):
                if k in patch and patch[k] is not None:
                    user[k] = patch[k]
            self._bump("user.update", uid)
            return user

    def delete_user(self, uid: str):
        with self._lock:
            self._db["users"] = [u for u in self._db["users"] if u["id"] != uid]
            self._db["sessions"] = {t: s for t, s in self._db["sessions"].items() if s.get("user_id") != uid}
            self._bump("user.delete", uid)

    # -- sessions ---------------------------------------------------------------- #
    def create_session(self, token: str, user_id: str, ttl_seconds: int = 60 * 60 * 24 * 30) -> dict[str, Any]:
        with self._lock:
            session = {"user_id": user_id, "created_at": time.time(),
                       "expires_at": time.time() + ttl_seconds}
            self._db["sessions"][token] = session
            self._flush()  # not version-bumping (not part of catalog state)
            return session

    def get_session(self, token: str) -> dict[str, Any] | None:
        session = self._db["sessions"].get(token)
        if not session:
            return None
        if session.get("expires_at", 0) < time.time():
            self.delete_session(token)
            return None
        return session

    def delete_session(self, token: str):
        with self._lock:
            self._db["sessions"].pop(token, None)
            self._flush()

    # -- admin account recovery ------------------------------------------------- #
    def create_admin_reset_code(self, ttl_seconds: int = 900) -> str:
        """Generate a one-time code for the locked-out-admin recovery flow.

        The code is only ever shown on the backend console (see /api/auth/request-reset
        in main.py) — never returned over the API — so completing a reset requires
        access to the machine running the server, not just the login page.
        """
        with self._lock:
            code = "".join(secrets.choice(string.digits) for _ in range(6))
            self._db["admin_reset"] = {"code": code, "expires_at": time.time() + ttl_seconds}
            self._flush()
            return code

    def verify_admin_reset_code(self, code: str) -> bool:
        r = self._db.get("admin_reset") or {}
        return bool(code) and r.get("code") == code and (r.get("expires_at") or 0) > time.time()

    def reset_all_users(self):
        """Wipe every account and session — used once a reset code has been verified."""
        with self._lock:
            self._db["users"] = []
            self._db["sessions"] = {}
            self._db["admin_reset"] = {"code": None, "expires_at": None}
            self._bump("auth.admin_reset", "all accounts cleared")
