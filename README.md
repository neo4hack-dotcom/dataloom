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

**Build the catalogue** (data team): Connections → Catalog → Explorer → Relationships → Lineage → Agents.
**Consume the catalogue** (everyone): the **Library** — browse your data in plain language and ask the **Librarian** chatbot.

## 🧠 Feature tour

### Autonomous engine & agents
- **Magic Enrich** one-click pipeline; 6 pre-built agents (Profiler, Linker, Documenter, Lineage, QA, Glossary) orchestrated, with a live console.
- Confidence score **+ evidence** on every inference; suggested → validated → rejected workflow.
- Lineage graph (pure SVG) rebuilt from keys, mapping tables and your model notes.

### Guided Explorer — 5 local-LLM features (evidence-grounded)
1. **Column suggestion** — definition + calculation + type + PII + confidence + cited evidence, one-click accept.
2. **Auto-document table** — every column in one call, review then apply.
3. **Catalog Copilot** — conversational RAG over the catalogue, cites real columns.
4. **Next Best Action** — impact-ranked worklist of the gaps to close first.
5. **Explain relationship** — plain-business meaning + cardinality of an inferred link.

### 🆕 Data Library + Librarian (for non-technical users)
- **Browse by topic** — tables grouped by business domain, described in plain language, friendly field types (Identifier, Email, Amount, Date, Yes/No…) instead of `VARCHAR2`.
- **Reader pages** — what's inside a table, how it connects ("Each row connects to one Customer"), and the related business terms — no jargon.
- **The Librarian** — a RAG chatbot that answers any question from your catalogue and links straight to the right table. *"Where can I find customer email addresses?"*

### Import / export
- **OKF / Frictionless Data**: import a `datapackage.json` (URL or paste) — schemas, field descriptions and declared foreign keys; **export** the catalogue back to `datapackage.json`.
- Export the dictionary as **Markdown handbook**, **JSON**, or **OKF**; export app config separately.

### Everything is editable
Manual CRUD on tables, columns, relationships, lineage edges, glossary terms and QA issues — enrich or correct anything the engine produced.

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

Open http://localhost:3000 → **Connections** → create a **Demo** connection →
**Magic Enrich**. Then open the **Library** and ask the Librarian. (`npm start` runs both.)

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
Frontend  React 19 · TS 5.8 strict · Tailwind 3.4 (dark) · Vite 6 · pure-SVG charts
          src/App.tsx (tabs) · store.tsx (state + optimistic concurrency) · views/* · lib/ui.tsx
Backend   FastAPI · Uvicorn :3001 · db.json persistence
          engine/connectors.py  (Oracle / ClickHouse / Demo / OKF)
          engine/profiling.py   (MinHash fingerprints, semantic types, quality)
          engine/similarity.py  (Jaccard, inclusion, PK/FK)
          engine/agents.py      (6 agents + orchestrator)
          engine/explore.py     (5 evidence-grounded LLM features + RAG copilot/librarian)
          engine/llm.py         (OpenAI-compatible client, configurable)
LLM       Any OpenAI-compatible server (Ollama default: qwen2.5-coder:7b)
```

Concurrency: every mutation bumps a version; clients send `X-Base-Version` → HTTP 409
on conflict. Secrets (LLM api_key) never leave the server.

## 🔒 Notes
- 100 % offline-capable: system fonts, no CDN, local LLM.
- The LLM `api_key` is redacted from all API responses (only an `api_key_set` flag is exposed).
