# 🧵 DataLoom — Autonomous Data Catalog

Crée, gère et **maintient automatiquement** le dictionnaire de ton data warehouse
**Oracle** ou **ClickHouse**. DataLoom *profile* tes données, *infère* les liens entre
tables par tests de valeurs réels, et *enrichit* le catalogue avec des **agents LLM locaux**
(Ollama) — pour reconstruire tes chaînes d'information en quasi-autonomie.

> Un clic sur **Magic Enrich** → profilage → détection de clés → documentation LLM →
> lineage → audit qualité → glossaire. Le tout offline.

---

## ✨ Ce qui fait l'effet « wow »

Le moteur ne se contente pas de lire les métadonnées : il **regarde les valeurs**.

| Technique | Résultat |
|---|---|
| **MinHash + Jaccard** (k-MV sketch) | overlap de valeurs entre 2 champs sans tout comparer |
| **Inclusion dependency** `\|A∩B\|/\|A\|` | détection automatique des clés **PK → FK** |
| **Format-mask fingerprint** | `FR76…` → `AAdd…`, repère les colonnes de même *forme* |
| **Semantic profiling** (regex) | email, IBAN, SIRET, UUID, IP, date, devise, code… |
| **Data-quality score** | complétude × unicité × validité (0–100) |
| **PII / sensibilité** | classification automatique des champs sensibles |
| **Agents LLM locaux** | définitions fonctionnelles + méthodes de calcul, avec score de confiance |

Sur la source de démo, DataLoom retrouve **seul** :
- `orders.customer_id → customers.customer_id` (FK, 100 %)
- `payments.cust_ref ≈ customers.customer_id` (même champ, **nom différent**, 91 %)
- `country_code ≈ code_pays` (même champ, **langue différente**)
- `customer_id → dim_client.id_client` (mapping d'étoile pour le lineage)

## 🧠 Les 18 fonctionnalités

1. Pipeline **Magic Enrich** en 1 clic  · 2. 6 agents pré-construits orchestrés ·
3. Console d'agents **en temps réel** · 4. Score de confiance + **preuve** sur chaque inférence ·
5. Workflow de validation (suggéré → validé → rejeté) · 6. Détection « même champ » par **test de valeurs** ·
7. Graphe de **lineage SVG** · 8. **Recherche en langage naturel** (LLM) · 9. **Command palette** (⌘K) ·
10. Dashboard de santé · 11. Détection de PII · 12. **Glossaire métier** lié aux colonnes ·
13. Concurrence optimiste (`X-Base-Version` → 409) · 14. **Audit / time-travel** ·
15. Export **Markdown / JSON** · 16. **Heatmap** de connectivité · 17. Notes de modèle → lineage ·
18. Source **démo** synthétique aux valeurs chevauchantes.

## 🏗️ Architecture

```
Frontend  React 19 · TS 5.8 strict · Tailwind 3.4 (dark) · Vite 6 · charts SVG purs
          src/App.tsx (tabs) · store.tsx (state+concurrence) · views/* · lib/ui.tsx
Backend   FastAPI · Uvicorn :3001 · persistance db.json
          engine/connectors.py  (Oracle / ClickHouse / Demo)
          engine/profiling.py   (empreintes MinHash, types sémantiques, qualité)
          engine/similarity.py  (Jaccard, inclusion, PK/FK)
          engine/agents.py      (6 agents + orchestrateur)
          engine/llm.py         (Ollama, fallback heuristique)
LLM       Ollama local (qwen2.5-coder:7b par défaut)
```

## 🚀 Démarrage

```bash
# 1) Backend (port 3001)
cd server
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/uvicorn main:app --port 3001 --reload

# 2) Frontend (port 3000, proxy /api → 3001)
npm install
npm run dev
```

Puis ouvre http://localhost:3000 → **Connexions** → crée une connexion **Démo** →
**Magic Enrich**. (Ou `npm start` lance les deux ensemble.)

### Brancher un vrai entrepôt
```bash
./.venv/bin/pip install oracledb            # Oracle
./.venv/bin/pip install clickhouse-connect  # ClickHouse
```
Puis renseigne DSN / host dans l'écran **Connexions**. Toutes les requêtes sont en
lecture seule (`all_tables`, `system.columns`, `SELECT … FETCH FIRST n`).

## 🔌 LLM local
DataLoom interroge Ollama sur `localhost:11434`. Sélectionne le modèle dans **Réglages**.
Si Ollama est absent, les agents basculent sur des heuristiques — l'app reste 100 % utilisable.
