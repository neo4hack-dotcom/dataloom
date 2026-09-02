# 🧵 DOINg.Catalogue — Autonomous Data Catalogue

Create, manage and **automatically maintain** the data dictionary of your
**Oracle** or **ClickHouse** warehouse — and let anyone, technical or not, find
and understand that data. DOINg.Catalogue *profiles* your data, *infers* the links
between tables from real value tests, and *enriches* the catalogue with **local
LLM agents** (any OpenAI-compatible server) — fully offline.

> One click on **Magic Enrich** → profiling → key detection → LLM documentation →
> lineage → quality audit → glossary. Then open the **Library** and just *ask*.

---

## ✨ Why it stands out

The engine doesn't just read metadata — it **looks at the values**.

| Technique | What it gives you |
|---|---|
| **MinHash + Jaccard** (k-MV sketch) | value overlap between two fields without comparing everything |
| **Inclusion dependency** `\|A∩B\|/\|A\|` | automatic **PK → FK** key detection |
| **Format-mask fingerprint** | `FR76…` → `AAdd…`, spots columns of the same *shape* |
| **Semantic profiling** (regex) | email, IBAN, SIRET, UUID, IP, date, currency, code… |
| **Data-quality score** | completeness × uniqueness × validity (0–100) |
| **PII / sensitivity** | automatic flagging of sensitive fields |
| **Evidence-grounded LLM** | every AI suggestion cites the real signals it used — verifiable, not hallucinated |

On the demo source, DOINg.Catalogue finds **on its own**:
- `orders.customer_id → customers.customer_id` (FK, 100 %)
- `payments.cust_ref ≈ customers.customer_id` (same field, **different name**, 91 %)
- `country_code ≈ code_pays` (same field, **different language**)
- `customer_id → dim_client.id_client` (star-schema mapping, for lineage)

## 🗂️ The two ways to use it

**Build the catalogue** (data team): Connections → MCP Library → Sources & scope → Catalog → Explorer →
Relationships → Lineage → Catalog Graph → Agents → Data Quality Checks.
**Consume the catalogue** (everyone): the **Library** — browse your data in plain language and ask the **Librarian** chatbot.

## 🧠 Feature tour

### Autonomous engine & agents
- **Magic Enrich** one-click pipeline; 6 pre-built agents (Profiler, Linker, Documenter, Lineage, QA, Glossary) orchestrated, with a live console.
- Confidence score **+ evidence** on every inference; suggested → validated → rejected workflow.
- Lineage graph (pure SVG) rebuilt from keys, mapping tables and your model notes.
- **Catalog Graph** — a zoomable, pannable map of every source, table and MCP tool and how they connect (FK/key, ETL mapping, manual, MCP). Sub-select which sources are in scope, collapse a noisy source into one cluster node, filter by relationship type, color-code tables by data quality, search-to-focus, and click a node to isolate just its neighborhood.

### Sources: warehouses, files, and other apps over MCP
- **Oracle** / **ClickHouse** (read-only), **Frictionless/OKF** (`datapackage.json`), **Demo** (synthetic).
- **MCP source** — connect to another application's MCP (Model Context Protocol) server as a data source. It has no declared schema, so the local LLM inspects its tools, samples the safely-callable ones live, and proposes a table/column mapping you review before it joins the normal pipeline.
- **MCP Library** — goes beyond schema mapping: browse every tool an MCP server exposes (not just the tabular ones), paste the real SQL or source code behind a tool and have the LLM extract a functional description, the tables/columns it actually touches, and — for already-mapped tools — a reconciliation flagging drift a live sample alone would miss. Referenced table names are matched against your other sources and offered as one-click cross-database lineage links, and a coverage queue ranks which tools to document next.
- This catalogue's **own MCP server** (Settings → MCP, admin-only) exposes both your tables *and* the MCP Library itself, so an external agent can learn about every MCP server you've referenced and the documented logic behind their tools — not just this catalogue's own data.

### Guided Explorer — local-LLM features (evidence-grounded)
1. **Column suggestion** — definition + calculation + type + PII + confidence + cited evidence, one-click accept.
2. **Auto-document table** — every column in one call, review then apply.
3. **Catalog Copilot** — conversational RAG over the catalogue, cites real columns.
4. **Next Best Action** — impact-ranked worklist of the gaps to close first.
5. **Explain relationship** — plain-business meaning + cardinality of an inferred link.
6. **Data Quality Checks** (independent module) — pick a source and tables, and an adaptive local-LLM agent plans, runs and refines statistical checks (outliers, format breaks, duplicates, categorical rarity) across multiple passes, explains what it finds in plain language, and exports a professional PDF report.

### Governance
Tags, hierarchical domains, ownership, deprecation, usage/popularity, custom properties, and column-level
lineage / Impact Analysis — the DataHub-style layer on top of the profiling engine.

### 🆕 Data Library + Librarian (for non-technical users)
- **Browse by topic** — tables grouped by business domain, described in plain language, friendly field types (Identifier, Email, Amount, Date, Yes/No…) instead of `VARCHAR2`.
- **Reader pages** — what's inside a table, how it connects ("Each row connects to one Customer"), and the related business terms — no jargon.
- **The Librarian** — a RAG chatbot that answers any question from your catalogue and links straight to the right table. *"Where can I find customer email addresses?"*

### Multi-user, roles & notifications
- **Accounts**: username/password, bcrypt-hashed, opaque session tokens (30-day TTL, auto-pruned).
- **Three roles**, managed from **Users** (admin-only): **Admin** (full access + user management + MCP exposure), **Read / write** (browse and edit the catalogue, run agents), **Read only** (browse and ask the local LLM, but every edit/create/delete route is rejected server-side, not just hidden in the UI).
- **Notifications** — a per-user bell with unread tracking surfaces pipeline/quality-run results, connection changes, and (admin-only) security- and user-management events, without a page reload.
- Sized for **~200 concurrently connected users**: the sync-route threadpool is raised at startup, sessions are pruned on login, and every write is serialized through one lock so the JSON store never corrupts under concurrent edits. See *Architecture* for where that model's ceiling is.

### Import / export
- **OKF / Frictionless Data**: import a `datapackage.json` (URL or paste) — schemas, field descriptions and declared foreign keys; **export** the catalogue back to `datapackage.json`.
- Export the dictionary as **Markdown handbook**, **JSON**, or **OKF**; export app config separately.

### Everything is editable
Manual CRUD on tables, columns, relationships, lineage edges, glossary terms and QA issues — enrich or correct anything the engine produced (subject to your role).

## ⚙️ Configurable local LLM (OpenAI-compatible)

Settings → **Local LLM**: one-click presets (**Ollama / LM Studio / vLLM / llama.cpp**),
base URL, optional API key, **model discovery**, temperature, and a **Test connection**
button with latency. Any server exposing `/v1/chat/completions` + `/v1/models` works.
If the LLM is offline, agents fall back to heuristics — the app stays usable.

## 🚀 Getting started

```bash
# 1) Backend (port 3001)
cd server
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/uvicorn main:app --port 3001 --reload

# 2) Frontend (port 3000, proxy /api → 3001)
npm install
npm run dev
```

Open http://localhost:3000 → first run creates the **admin** account (bootstrap screen) →
**Connections** → create a **Demo** connection → **Magic Enrich**. Then open the **Library**
and ask the Librarian. (`npm start` runs both.)

### Production (single origin)
```bash
npm run build                                  # builds dist/
cd server && ./.venv/bin/uvicorn main:app --port 3001   # serves API *and* the SPA
# open http://localhost:3001
```
The backend serves `dist/` (SPA fallback) while `/api/*` keeps priority.

### Connect a real warehouse
```bash
./.venv/bin/pip install oracledb            # Oracle
./.venv/bin/pip install clickhouse-connect  # ClickHouse
```
Then fill in the DSN / host in **Connections**. All queries are read-only.

## 🏗️ Architecture

```
Frontend  React 19 · TS 5.8 strict · Tailwind 3.4 (dark) · Vite 6 · pure-SVG charts & graphs
          src/App.tsx (tabs) · store.tsx (state + optimistic concurrency + notifications)
          auth.tsx (session/role) · views/* · lib/ui.tsx · lib/graphLayout.ts · lib/useZoomPan.ts
Backend   FastAPI · Uvicorn :3001 · db.json persistence (single-writer, RLock-guarded)
          auth.py               (bcrypt, sessions, roles: admin / member / viewer)
          store.py               (all CRUD + notifications, one RLock-guarded JSON file)
          mcp_server.py          (this catalogue's OWN MCP server — /mcp, Streamable HTTP)
          engine/connectors.py   (Oracle / ClickHouse / Demo / OKF / MCP-as-a-source)
          engine/mcp_client.py   (MCP client — pulls FROM another app's MCP server)
          engine/mcp_library.py  (code/SQL-grounded MCP tool documentation + link matching)
          engine/profiling.py    (MinHash fingerprints, semantic types, quality)
          engine/similarity.py   (Jaccard, inclusion, PK/FK)
          engine/agents.py       (6 agents + orchestrator)
          engine/quality_checks.py (independent deep-profiling agent: plan → check → refine → interpret)
          engine/explore.py      (evidence-grounded LLM features + RAG copilot/librarian)
          engine/llm.py          (OpenAI-compatible client, configurable)
LLM       Any OpenAI-compatible server (Ollama default: qwen2.5-coder:7b)
```

Concurrency: every catalog-mutating write bumps a version; clients send `X-Base-Version` →
HTTP 409 on conflict, so two open tabs never silently clobber each other. Every store write
is serialized through one process-wide lock and rewrites the whole `db.json` — fine for the
occasional edits a data catalogue actually sees from ~200 concurrently *connected* users
(mostly reads), but a genuinely high-write-throughput deployment would want to swap the JSON
file for a real database rather than scale this model further. Secrets (LLM `api_key`, MCP
tokens) never leave the server in plain text.

## 🔒 Access & security notes
- 100 % offline-capable: system fonts, no CDN, local LLM.
- Three roles, enforced **server-side** in the auth middleware (not just hidden in the UI):
  `admin`, `member` (read/write), `viewer` (read-only — every non-GET route is rejected
  except search and asking the local LLM a question).
- The LLM `api_key` and MCP tokens are redacted from all API responses (only a `*_set` flag is exposed).
- Locked out? The login screen's **Forgot password?** flow prints a one-time code to the
  **backend console only** — recovery requires access to the machine running the server.
