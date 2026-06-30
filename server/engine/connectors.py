"""
Warehouse connectors.

A connector exposes a uniform read-only introspection surface used by the
profiling engine:  list_tables -> get_columns -> sample_values -> count.

Three implementations:
  * DemoConnector       — generates a *realistic* synthetic Oracle/ClickHouse
                          warehouse whose tables share overlapping values, so
                          the similarity & FK-inference engines find real links.
  * OracleConnector     — thin wrapper over python-oracledb (optional dep).
  * ClickHouseConnector — thin wrapper over clickhouse-connect (optional dep).

Everything downstream only depends on the abstract Connector interface, so a
new warehouse type is a single new subclass.
"""
from __future__ import annotations

import random
import datetime as dt
from abc import ABC, abstractmethod
from typing import Any


class Connector(ABC):
    kind: str = "generic"

    @abstractmethod
    def list_tables(self) -> list[dict[str, Any]]:
        """Return [{schema, name, kind, row_estimate, comment}]."""

    @abstractmethod
    def get_columns(self, schema: str, table: str) -> list[dict[str, Any]]:
        """Return [{name, data_type, nullable, position, comment}]."""

    @abstractmethod
    def sample_values(self, schema: str, table: str, column: str, limit: int = 2000) -> list[Any]:
        """Return up to `limit` raw values for the column (NULLs filtered)."""

    def sample_rows(self, schema: str, table: str, limit: int = 500) -> list[dict[str, Any]]:
        """Return up to `limit` whole rows as dicts. Default: zip per-column samples.

        Subclasses with a native full-row read (Oracle/ClickHouse/Demo) override this
        so columns stay aligned even when some contain NULLs.
        """
        cols = [c["name"] for c in self.get_columns(schema, table)]
        per_col = {c: self.sample_values(schema, table, c, limit) for c in cols}
        n = max((len(v) for v in per_col.values()), default=0)
        return [{c: (per_col[c][i] if i < len(per_col[c]) else None) for c in cols}
                for i in range(min(n, limit))]

    def ping(self) -> bool:
        try:
            self.list_tables()
            return True
        except Exception:
            return False


# --------------------------------------------------------------------------- #
#  Demo connector — a synthetic but coherent retail + clickstream warehouse.   #
# --------------------------------------------------------------------------- #
class DemoConnector(Connector):
    """
    Builds a deterministic synthetic warehouse in memory. The data is crafted so
    that the engine *will* discover:
      - orders.customer_id  ⊂ customers.customer_id        (FK)
      - order_items.order_id ⊂ orders.order_id             (FK)
      - payments.cust_ref   ≈ customers.customer_id        (same field, diff name)
      - dim_client.id_client overlaps customers.customer_id (mapping/lineage)
      - events.user_id overlaps customers.customer_id       (cross-system join)
    """

    kind = "demo"

    def __init__(self, flavor: str = "oracle", seed: int = 42):
        self.flavor = flavor
        self._rng = random.Random(seed)
        self._build()

    # -- synthetic generation ------------------------------------------------ #
    def _build(self) -> None:
        rng = self._rng
        n_customers = 600
        n_orders = 1800
        n_products = 90

        customer_ids = list(range(10000, 10000 + n_customers))
        countries = ["FR", "FR", "FR", "BE", "DE", "ES", "IT", "FR", "CH", "LU"]
        segments = ["RETAIL", "PRO", "VIP", "RETAIL", "PRO"]
        first = ["Marie", "Jean", "Luc", "Sophie", "Paul", "Emma", "Hugo", "Lea", "Nina", "Theo"]
        last = ["Martin", "Bernard", "Dubois", "Petit", "Durand", "Leroy", "Moreau", "Simon"]

        customers = []
        for cid in customer_ids:
            fn = rng.choice(first); ln = rng.choice(last)
            customers.append({
                "customer_id": cid,
                "email": f"{fn.lower()}.{ln.lower()}{rng.randint(1,99)}@example.com",
                "full_name": f"{fn} {ln}",
                "country_code": rng.choice(countries),
                "segment": rng.choice(segments),
                "created_at": self._rand_date(2019, 2024),
                "siret": "".join(str(rng.randint(0, 9)) for _ in range(14)),
                "lifetime_value": round(rng.uniform(0, 9000), 2),
                "is_active": rng.choice([1, 1, 1, 0]),
            })

        products = []
        for pid in range(500, 500 + n_products):
            products.append({
                "product_id": pid,
                "sku": f"SKU-{rng.randint(1000,9999)}-{rng.choice('ABCDEF')}",
                "label": rng.choice(["Chair", "Table", "Lamp", "Sofa", "Shelf", "Desk"]) + f" {pid}",
                "category": rng.choice(["FURNITURE", "DECOR", "LIGHTING", "STORAGE"]),
                "unit_price": round(rng.uniform(9.9, 899.0), 2),
            })

        orders = []
        order_ids = []
        for oid in range(700000, 700000 + n_orders):
            order_ids.append(oid)
            cust = rng.choice(customer_ids)
            orders.append({
                "order_id": oid,
                "customer_id": cust,
                "order_ts": self._rand_date(2022, 2024),
                "status": rng.choice(["PAID", "PAID", "SHIPPED", "CANCELLED", "PENDING"]),
                "total_amount": round(rng.uniform(15, 2400), 2),
                "currency": rng.choice(["EUR", "EUR", "EUR", "CHF"]),
            })

        order_items = []
        oiid = 1
        for o in orders:
            for _ in range(rng.randint(1, 4)):
                p = rng.choice(products)
                qty = rng.randint(1, 5)
                order_items.append({
                    "order_item_id": oiid,
                    "order_id": o["order_id"],
                    "product_id": p["product_id"],
                    "quantity": qty,
                    "line_amount": round(p["unit_price"] * qty, 2),
                })
                oiid += 1

        # payments — uses cust_ref (same as customer_id, different name) + amt
        payments = []
        for pid in range(900000, 900000 + 1400):
            cust = rng.choice(customer_ids)
            payments.append({
                "payment_id": pid,
                "cust_ref": cust,
                "paid_amount": round(rng.uniform(15, 2400), 2),
                "method": rng.choice(["CARD", "CARD", "SEPA", "PAYPAL"]),
                "iban": f"FR76{''.join(str(rng.randint(0,9)) for _ in range(20))}",
                "paid_at": self._rand_date(2022, 2024),
            })

        # dim_client — a star-schema dimension that maps to customers (lineage)
        dim_client = []
        for cid in customer_ids:
            src = next(c for c in customers if c["customer_id"] == cid)
            dim_client.append({
                "id_client": cid,
                "libelle_client": src["full_name"].upper(),
                "code_pays": src["country_code"],
                "segment_client": src["segment"],
                "flag_actif": "O" if src["is_active"] else "N",
            })

        # mapping table — explicit business mapping the LineageAgent can read
        map_country = [
            {"src_code": "FR", "label_fr": "France", "region": "EUROPE"},
            {"src_code": "BE", "label_fr": "Belgique", "region": "EUROPE"},
            {"src_code": "DE", "label_fr": "Allemagne", "region": "EUROPE"},
            {"src_code": "ES", "label_fr": "Espagne", "region": "EUROPE"},
            {"src_code": "IT", "label_fr": "Italie", "region": "EUROPE"},
            {"src_code": "CH", "label_fr": "Suisse", "region": "EUROPE"},
            {"src_code": "LU", "label_fr": "Luxembourg", "region": "EUROPE"},
        ]

        # ETL configuration/mapping table — drives lineage + pre-documentation
        etl_mapping = [
            {"src_table": "CUSTOMERS", "src_field": "customer_id", "tgt_table": "DIM_CLIENT",
             "tgt_field": "id_client", "tgt_definition": "Unique client identifier (source key)",
             "transform": "DIRECT"},
            {"src_table": "CUSTOMERS", "src_field": "full_name", "tgt_table": "DIM_CLIENT",
             "tgt_field": "libelle_client", "tgt_definition": "Client display label (upper-cased name)",
             "transform": "UPPER(full_name)"},
            {"src_table": "CUSTOMERS", "src_field": "country_code", "tgt_table": "DIM_CLIENT",
             "tgt_field": "code_pays", "tgt_definition": "ISO country code of the client",
             "transform": "DIRECT"},
            {"src_table": "MAP_COUNTRY", "src_field": "region", "tgt_table": "DIM_CLIENT",
             "tgt_field": "segment_client", "tgt_definition": "Client commercial segment",
             "transform": "LOOKUP"},
            {"src_table": "ORDERS", "src_field": "total_amount", "tgt_table": "PAYMENTS",
             "tgt_field": "paid_amount", "tgt_definition": "Amount actually settled for the order",
             "transform": "SUM"},
        ]

        # ClickHouse-style clickstream events sharing user_id with customers
        events = []
        for i in range(4000):
            events.append({
                "event_id": f"{self._uuid()}",
                "user_id": rng.choice(customer_ids),
                "event_type": rng.choice(["page_view", "add_to_cart", "purchase", "search", "login"]),
                "url": "https://shop.example.com/" + rng.choice(["home", "cart", "product", "search"]),
                "event_time": self._rand_date(2023, 2024),
                "device": rng.choice(["mobile", "desktop", "tablet"]),
                "ip_address": f"{rng.randint(1,255)}.{rng.randint(0,255)}.{rng.randint(0,255)}.{rng.randint(1,255)}",
            })

        oracle_tables = {
            ("SALES", "CUSTOMERS"): ("table", customers, "Customer master data (source of truth)"),
            ("SALES", "ORDERS"): ("table", orders, "Customer orders"),
            ("SALES", "ORDER_ITEMS"): ("table", order_items, "Order line items"),
            ("SALES", "PRODUCTS"): ("table", products, "Product catalog"),
            ("FINANCE", "PAYMENTS"): ("table", payments, "Payments received"),
            ("DWH", "DIM_CLIENT"): ("table", dim_client, "Customer dimension (star schema)"),
            ("DWH", "MAP_COUNTRY"): ("table", map_country, "Country mapping table"),
            ("DWH", "ETL_MAPPING"): ("table", etl_mapping, "ETL configuration table (source→target)"),
        }
        clickhouse_tables = {
            ("analytics", "events"): ("table", events, "Web event stream (clickstream)"),
        }

        self._tables = oracle_tables if self.flavor == "oracle" else {**clickhouse_tables}
        if self.flavor == "oracle":
            # keep it Oracle-only by default
            pass
        elif self.flavor == "clickhouse":
            self._tables = clickhouse_tables
        elif self.flavor == "large":
            # 7 real coherent tables + a few hundred synthetic ones (lazy).
            self._tables = {**oracle_tables, **clickhouse_tables}
            self._build_large_inventory()
        else:  # 'mixed' demo
            self._tables = {**oracle_tables, **clickhouse_tables}

    # -- large-volume inventory (lazy) --------------------------------------- #
    def _build_large_inventory(self, n: int = 420) -> None:
        """
        Register ~n synthetic table *descriptors* only — columns and rows are
        generated on demand (get_columns / sample_values), so listing 400+ tables
        is instant and only the scoped tables ever incur generation cost.
        """
        rng = random.Random(7)
        schemas = ["SALES", "FINANCE", "HR", "MARKETING", "LOGISTICS", "SUPPLY",
                   "WEB", "STAGING", "DWH", "RISK", "PRODUCT", "SUPPORT"]
        prefixes = ["STG", "DIM", "FCT", "AGG", "REF", "MAP", "HIST", "TMP", "V", "RAW"]
        entities = ["CUSTOMER", "ORDER", "PRODUCT", "INVOICE", "PAYMENT", "SHIPMENT",
                    "EMPLOYEE", "CONTRACT", "CAMPAIGN", "LEAD", "TICKET", "ACCOUNT",
                    "LEDGER", "ASSET", "VENDOR", "WAREHOUSE", "SKU", "PRICE", "TAX",
                    "REGION", "CHANNEL", "SEGMENT", "RETURN", "REFUND", "DISCOUNT",
                    "SUBSCRIPTION", "SESSION", "CLICK", "IMPRESSION", "INVENTORY",
                    "FORECAST", "BUDGET", "QUOTA", "COMMISSION", "PAYROLL", "EXPENSE"]
        self._synth: dict[tuple[str, str], dict[str, Any]] = {}
        seen = set()
        attempts = 0
        while len(self._synth) < n and attempts < n * 20:
            attempts += 1
            schema = rng.choice(schemas)
            name = f"{rng.choice(prefixes)}_{rng.choice(entities)}"
            if rng.random() < 0.4:
                name += f"_{rng.choice(['DAILY','MONTHLY','EU','NA','V2','SNAPSHOT','RAW','CDC'])}"
            key = (schema, name)
            if key in seen or key in self._tables:
                continue
            seen.add(key)
            self._synth[key] = {
                "row_estimate": rng.choice([0, 120, 5_000, 48_000, 250_000, 1_200_000]),
                "n_cols": rng.randint(5, 18),
                "seed": rng.randint(1, 10**9),
                "comment": None,
            }

    # -- helpers ------------------------------------------------------------- #
    def _rand_date(self, y0: int, y1: int) -> str:
        rng = self._rng
        d = dt.date(rng.randint(y0, y1), rng.randint(1, 12), rng.randint(1, 28))
        t = dt.time(rng.randint(0, 23), rng.randint(0, 59), rng.randint(0, 59))
        return dt.datetime.combine(d, t).isoformat(sep=" ")

    def _uuid(self) -> str:
        h = "0123456789abcdef"
        r = self._rng
        return "".join(r.choice(h) for _ in range(8)) + "-" + "".join(r.choice(h) for _ in range(4))

    @staticmethod
    def _infer_type(value: Any) -> str:
        if isinstance(value, bool):
            return "BOOLEAN"
        if isinstance(value, int):
            return "NUMBER"
        if isinstance(value, float):
            return "NUMBER(12,2)"
        if isinstance(value, str) and len(value) > 30:
            return "VARCHAR2(255)"
        return "VARCHAR2(64)"

    # -- Connector interface ------------------------------------------------- #
    def list_tables(self) -> list[dict[str, Any]]:
        out = []
        for (schema, name), (kind, rows, comment) in self._tables.items():
            out.append({
                "schema": schema, "name": name, "kind": kind,
                "row_estimate": len(rows), "comment": comment,
            })
        for (schema, name), spec in getattr(self, "_synth", {}).items():
            out.append({
                "schema": schema, "name": name, "kind": "table",
                "row_estimate": spec["row_estimate"], "comment": spec["comment"],
            })
        return out

    def get_columns(self, schema: str, table: str) -> list[dict[str, Any]]:
        if (schema, table) in self._tables:
            rows = self._tables[(schema, table)][1]
            if not rows:
                return []
            cols = list(rows[0].keys())
            out = []
            for i, c in enumerate(cols):
                sample = next((r[c] for r in rows if r[c] is not None), None)
                nullable = any(r.get(c) is None for r in rows)
                out.append({
                    "name": c, "data_type": self._infer_type(sample),
                    "nullable": nullable, "position": i + 1, "comment": None,
                })
            return out
        # synthetic, generated lazily
        rows = self._synth_rows(schema, table)
        if not rows:
            return []
        cols = list(rows[0].keys())
        return [{"name": c, "data_type": self._infer_type(
                    next((r[c] for r in rows if r[c] is not None), None)),
                 "nullable": False, "position": i + 1, "comment": None}
                for i, c in enumerate(cols)]

    def sample_values(self, schema: str, table: str, column: str, limit: int = 2000) -> list[Any]:
        if (schema, table) in self._tables:
            rows = self._tables[(schema, table)][1]
        else:
            rows = self._synth_rows(schema, table)
        vals = [r[column] for r in rows if r.get(column) is not None]
        return vals[:limit]

    def sample_rows(self, schema: str, table: str, limit: int = 500) -> list[dict[str, Any]]:
        if (schema, table) in self._tables:
            rows = self._tables[(schema, table)][1]
        else:
            rows = self._synth_rows(schema, table)
        return [dict(r) for r in rows[:limit]]

    # -- lazy synthetic-row generation (cached) ------------------------------ #
    def _synth_rows(self, schema: str, table: str) -> list[dict[str, Any]]:
        if not hasattr(self, "_synth"):
            return []
        spec = self._synth.get((schema, table))
        if not spec:
            return []
        cache = getattr(self, "_synth_cache", None)
        if cache is None:
            cache = self._synth_cache = {}
        if (schema, table) in cache:
            return cache[(schema, table)]
        rng = random.Random(spec["seed"])
        n_rows = min(spec["row_estimate"] or 50, 400) or 50
        ent = table.split("_", 1)[-1].lower()
        # a deterministic, varied column set
        cols = [f"{ent}_id"]
        pool = ["code", "label", "status", "amount", "quantity", "created_at",
                "updated_at", "country_code", "currency", "email", "ref",
                "score", "flag_active", "rate", "region"]
        rng.shuffle(pool)
        cols += pool[: spec["n_cols"] - 1]
        rows = []
        for i in range(n_rows):
            row: dict[str, Any] = {}
            for c in cols:
                row[c] = self._synth_value(c, i, rng)
            rows.append(row)
        cache[(schema, table)] = rows
        return rows

    @staticmethod
    def _synth_value(col: str, i: int, rng: random.Random) -> Any:
        if col.endswith("_id") or col == "ref":
            return 100000 + i
        if "amount" in col or "rate" in col or "score" in col:
            return round(rng.uniform(1, 5000), 2)
        if "quantity" in col:
            return rng.randint(1, 100)
        if col in ("created_at", "updated_at"):
            return f"2024-{rng.randint(1,12):02d}-{rng.randint(1,28):02d}"
        if col == "country_code":
            return rng.choice(["FR", "DE", "ES", "IT", "BE", "NL"])
        if col == "currency":
            return rng.choice(["EUR", "USD", "GBP"])
        if col == "email":
            return f"user{i}@example.com"
        if col == "status":
            return rng.choice(["OPEN", "CLOSED", "PENDING", "ARCHIVED"])
        if col.startswith("flag"):
            return rng.choice([0, 1])
        if col == "region":
            return rng.choice(["EMEA", "AMER", "APAC"])
        return rng.choice(["A", "B", "C", "D"]) + str(rng.randint(10, 99))


# --------------------------------------------------------------------------- #
#  Real connectors (optional deps, lazy imports).                              #
# --------------------------------------------------------------------------- #
class OracleConnector(Connector):
    kind = "oracle"

    def __init__(self, dsn: str, user: str, password: str, schemas: list[str] | None = None):
        try:
            import oracledb  # type: ignore
        except ImportError as e:  # pragma: no cover
            raise RuntimeError(
                "python-oracledb not installed. `pip install oracledb` to use a real Oracle source."
            ) from e
        self._oracledb = oracledb
        self._conn = oracledb.connect(user=user, password=password, dsn=dsn)
        self._schemas = [s.upper() for s in (schemas or [user.upper()])]

    def list_tables(self) -> list[dict[str, Any]]:
        cur = self._conn.cursor()
        ph = ",".join(f":{i+1}" for i in range(len(self._schemas)))
        cur.execute(
            f"""SELECT owner, table_name, num_rows
                FROM all_tables WHERE owner IN ({ph})""",
            self._schemas,
        )
        return [{"schema": r[0], "name": r[1], "kind": "table",
                 "row_estimate": int(r[2] or 0), "comment": None} for r in cur]

    def get_columns(self, schema: str, table: str) -> list[dict[str, Any]]:
        cur = self._conn.cursor()
        cur.execute(
            """SELECT column_name, data_type, nullable, column_id
               FROM all_tab_columns WHERE owner=:1 AND table_name=:2
               ORDER BY column_id""", [schema, table])
        return [{"name": r[0], "data_type": r[1], "nullable": r[2] == "Y",
                 "position": r[3], "comment": None} for r in cur]

    def sample_values(self, schema: str, table: str, column: str, limit: int = 2000) -> list[Any]:
        cur = self._conn.cursor()
        cur.execute(
            f'SELECT "{column}" FROM "{schema}"."{table}" '
            f'WHERE "{column}" IS NOT NULL FETCH FIRST {int(limit)} ROWS ONLY')
        return [r[0] for r in cur]

    def sample_rows(self, schema: str, table: str, limit: int = 500) -> list[dict[str, Any]]:
        cur = self._conn.cursor()
        cur.execute(f'SELECT * FROM "{schema}"."{table}" FETCH FIRST {int(limit)} ROWS ONLY')
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur]


class ClickHouseConnector(Connector):
    kind = "clickhouse"

    def __init__(self, host: str, port: int, user: str, password: str, database: str):
        try:
            import clickhouse_connect  # type: ignore
        except ImportError as e:  # pragma: no cover
            raise RuntimeError(
                "clickhouse-connect not installed. `pip install clickhouse-connect` to use a real ClickHouse source."
            ) from e
        self._client = clickhouse_connect.get_client(
            host=host, port=port, username=user, password=password, database=database)
        self._database = database

    def list_tables(self) -> list[dict[str, Any]]:
        res = self._client.query(
            "SELECT database, name, total_rows FROM system.tables WHERE database = {db:String}",
            parameters={"db": self._database})
        return [{"schema": r[0], "name": r[1], "kind": "table",
                 "row_estimate": int(r[2] or 0), "comment": None} for r in res.result_rows]

    def get_columns(self, schema: str, table: str) -> list[dict[str, Any]]:
        res = self._client.query(
            "SELECT name, type, position FROM system.columns "
            "WHERE database={db:String} AND table={tbl:String} ORDER BY position",
            parameters={"db": schema, "tbl": table})
        return [{"name": r[0], "data_type": r[1], "nullable": "Nullable" in r[1],
                 "position": r[2], "comment": None} for r in res.result_rows]

    def sample_values(self, schema: str, table: str, column: str, limit: int = 2000) -> list[Any]:
        res = self._client.query(
            f'SELECT `{column}` FROM `{schema}`.`{table}` '
            f'WHERE `{column}` IS NOT NULL LIMIT {int(limit)}')
        return [r[0] for r in res.result_rows]

    def sample_rows(self, schema: str, table: str, limit: int = 500) -> list[dict[str, Any]]:
        res = self._client.query(f'SELECT * FROM `{schema}`.`{table}` LIMIT {int(limit)}')
        cols = res.column_names
        return [dict(zip(cols, row)) for row in res.result_rows]


# --------------------------------------------------------------------------- #
#  OKF connector — Frictionless Data Package (Open Knowledge Foundation).     #
#                                                                              #
#  Reads a datapackage.json descriptor and exposes its resources as tables.   #
#  Supports:  inline JSON (config.content), URL (config.url).                 #
#  Attempts to read CSV data files for sample values (best-effort).           #
# --------------------------------------------------------------------------- #

_FRICTIONLESS_TYPE_MAP = {
    "integer": "INTEGER", "number": "NUMBER", "boolean": "BOOLEAN",
    "date": "DATE", "datetime": "TIMESTAMP", "time": "TIME",
    "string": "VARCHAR", "array": "ARRAY", "object": "JSON",
    "geojson": "JSON", "year": "INTEGER", "yearmonth": "VARCHAR",
    "duration": "VARCHAR", "any": "VARCHAR",
}


class OKFConnector(Connector):
    """
    Frictionless Data Package connector.

    Config keys (at least one required):
      content  — dict   : the parsed datapackage.json content
      url      — str    : URL to fetch the datapackage.json from
      base_url — str    : base URL for resolving relative resource paths (optional)
    """
    kind = "okf"

    def __init__(self, content: dict | None = None, url: str | None = None,
                 base_url: str | None = None):
        self._pkg: dict[str, Any] = {}
        self._base_url = base_url or (url.rsplit("/", 1)[0] if url else "")
        self._csv_cache: dict[str, list[list[str]]] = {}

        if content:
            self._pkg = content
        elif url:
            import httpx
            r = httpx.get(url, timeout=15, follow_redirects=True)
            r.raise_for_status()
            self._pkg = r.json()
        else:
            raise ValueError("Either 'content' or 'url' must be provided")

        self._resources = {
            r["name"]: r for r in self._pkg.get("resources", []) if r.get("name")
        }

    def _schema_name(self) -> str:
        return (self._pkg.get("name") or "okf").upper().replace("-", "_")[:30]

    def list_tables(self) -> list[dict[str, Any]]:
        out = []
        for name, res in self._resources.items():
            out.append({
                "schema": self._schema_name(),
                "name": name.upper().replace("-", "_"),
                "kind": "table",
                "row_estimate": 0,
                "comment": res.get("description") or res.get("title"),
            })
        return out

    def get_columns(self, schema: str, table: str) -> list[dict[str, Any]]:
        res_name = table.lower().replace("_", "-")
        # Try both forms
        res = self._resources.get(res_name) or self._resources.get(table.lower())
        if not res:
            return []
        fields = res.get("schema", {}).get("fields", [])
        pk_set = set(res.get("schema", {}).get("primaryKey") or [])
        out = []
        for i, f in enumerate(fields):
            dtype = _FRICTIONLESS_TYPE_MAP.get(f.get("type", "string"), "VARCHAR")
            # String with format constraints → richer type hint
            fmt = (f.get("constraints") or {}).get("format") or f.get("format")
            if fmt == "email":
                dtype = "VARCHAR (email)"
            elif fmt == "uri":
                dtype = "VARCHAR (url)"
            out.append({
                "name": f["name"],
                "data_type": dtype,
                "nullable": not (f.get("constraints") or {}).get("required", False),
                "position": i + 1,
                "comment": f.get("description") or f.get("title"),
                "_is_pk": f["name"] in pk_set,
            })
        return out

    def sample_values(self, schema: str, table: str, column: str, limit: int = 2000) -> list[Any]:
        res_name = table.lower().replace("_", "-")
        res = self._resources.get(res_name) or self._resources.get(table.lower())
        if not res:
            return []
        path = res.get("path") or (res.get("paths") or [None])[0]
        if not path:
            return []
        cache_key = f"{schema}.{table}"
        if cache_key not in self._csv_cache:
            self._csv_cache[cache_key] = self._read_csv(path)
        rows = self._csv_cache[cache_key]
        if not rows:
            return []
        headers = rows[0]
        if column not in headers:
            return []
        idx = headers.index(column)
        return [row[idx] for row in rows[1: limit + 1] if idx < len(row) and row[idx]]

    def _read_csv(self, path: str) -> list[list[str]]:
        import csv, io
        url = path if path.startswith("http") else (
            f"{self._base_url}/{path}" if self._base_url else path)
        try:
            if url.startswith("http"):
                import httpx
                r = httpx.get(url, timeout=10, follow_redirects=True)
                r.raise_for_status()
                text = r.text
            else:
                with open(url, encoding="utf-8") as f:
                    text = f.read()
            return list(csv.reader(io.StringIO(text)))
        except Exception:
            return []


def build_connector(conn: dict[str, Any]) -> Connector:
    t = conn.get("type")
    cfg = conn.get("config", {})
    if t == "demo":
        return DemoConnector(flavor=cfg.get("flavor", "oracle"))
    if t == "okf":
        return OKFConnector(
            content=cfg.get("content"),
            url=cfg.get("url"),
            base_url=cfg.get("base_url"),
        )
    if t == "oracle":
        return OracleConnector(cfg["dsn"], cfg["user"], cfg["password"], cfg.get("schemas"))
    if t == "clickhouse":
        return ClickHouseConnector(cfg["host"], int(cfg.get("port", 8123)),
                                   cfg["user"], cfg.get("password", ""), cfg["database"])
    raise ValueError(f"Unknown connector type: {t}")
