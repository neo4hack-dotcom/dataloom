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
                "label": rng.choice(["Chaise", "Table", "Lampe", "Canapé", "Étagère", "Bureau"]) + f" {pid}",
                "category": rng.choice(["MOBILIER", "DECO", "LUMINAIRE", "RANGEMENT"]),
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
            ("SALES", "CUSTOMERS"): ("table", customers, "Référentiel clients (source de vérité)"),
            ("SALES", "ORDERS"): ("table", orders, "Commandes clients"),
            ("SALES", "ORDER_ITEMS"): ("table", order_items, "Lignes de commande"),
            ("SALES", "PRODUCTS"): ("table", products, "Catalogue produits"),
            ("FINANCE", "PAYMENTS"): ("table", payments, "Encaissements"),
            ("DWH", "DIM_CLIENT"): ("table", dim_client, "Dimension client (étoile)"),
            ("DWH", "MAP_COUNTRY"): ("table", map_country, "Table de mapping pays"),
        }
        clickhouse_tables = {
            ("analytics", "events"): ("table", events, "Flux d'évènements web (clickstream)"),
        }

        self._tables = oracle_tables if self.flavor == "oracle" else {**clickhouse_tables}
        if self.flavor == "oracle":
            # keep it Oracle-only by default
            pass
        elif self.flavor == "clickhouse":
            self._tables = clickhouse_tables
        else:  # 'mixed' demo
            self._tables = {**oracle_tables, **clickhouse_tables}

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
        return out

    def get_columns(self, schema: str, table: str) -> list[dict[str, Any]]:
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

    def sample_values(self, schema: str, table: str, column: str, limit: int = 2000) -> list[Any]:
        rows = self._tables[(schema, table)][1]
        vals = [r[column] for r in rows if r.get(column) is not None]
        return vals[:limit]


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


def build_connector(conn: dict[str, Any]) -> Connector:
    t = conn.get("type")
    cfg = conn.get("config", {})
    if t == "demo":
        return DemoConnector(flavor=cfg.get("flavor", "oracle"))
    if t == "oracle":
        return OracleConnector(cfg["dsn"], cfg["user"], cfg["password"], cfg.get("schemas"))
    if t == "clickhouse":
        return ClickHouseConnector(cfg["host"], int(cfg.get("port", 8123)),
                                   cfg["user"], cfg.get("password", ""), cfg["database"])
    raise ValueError(f"Unknown connector type: {t}")
