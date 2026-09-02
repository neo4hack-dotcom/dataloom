import { useState } from "react";
import type { ReactNode } from "react";
import {
  LifeBuoy, Rocket, Database, ListChecks, Bot, Table2, Tags, ShieldCheck,
  Route, Search, Compass, UserCog, Sliders, ChevronRight, Zap, Sparkles, Microscope, BookMarked,
} from "lucide-react";

function H3({ children }: { children: ReactNode }) {
  return <h3 className="mb-1.5 mt-4 text-sm font-semibold text-slate-800 first:mt-0 dark:text-slate-100">{children}</h3>;
}
function P({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{children}</p>;
}
function Ul({ children }: { children: ReactNode }) {
  return <ul className="mb-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{children}</ul>;
}
function Callout({ tone = "info", children }: { tone?: "info" | "warn" | "ai" | "danger"; children: ReactNode }) {
  const cls = tone === "warn" ? "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300"
    : tone === "ai" ? "border-loom-500/30 bg-loom-500/5 text-loom-700 dark:text-loom-300"
    : tone === "danger" ? "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300"
    : "border-slate-300 bg-slate-500/5 text-slate-600 dark:border-slate-700 dark:text-slate-300";
  return <div className={`mb-3 rounded-lg border px-3 py-2 text-xs leading-relaxed ${cls}`}>{children}</div>;
}
function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[11px] dark:bg-slate-700">{children}</kbd>;
}

interface Section { id: string; label: string; icon: typeof LifeBuoy; content: ReactNode }

const SECTIONS: Section[] = [
  {
    id: "start", label: "Getting started", icon: Rocket,
    content: (
      <>
        <P>
          DOINg.Catalogue is an autonomous data catalog. Instead of asking humans to fill out a spreadsheet
          of table and column definitions, it connects to your warehouse, profiles every column with real
          value tests, and has a local LLM propose functional definitions — which a human then reviews,
          edits, and validates. The result is a searchable, governed data dictionary that stays close to
          the actual data.
        </P>
        <H3>The core workflow</H3>
        <Ul>
          <li><b>Connect</b> a warehouse (or use Demo mode) in <b>Connections</b>.</li>
          <li><b>Scope</b> which tables to include in <b>Sources &amp; scope</b> — nothing is profiled until you opt in.</li>
          <li><b>Run agents</b> (Profiler → Linker → Documenter → Lineage → QA Reviewer → Glossary) from the
            <b> Agents</b> view, individually or as one "Magic Enrich" pipeline.</li>
          <li><b>Review</b> what the LLM proposed in the <b>Catalog</b>, editing or validating each definition.</li>
          <li><b>Govern</b> the result with tags, domains, owners, deprecation, and quality thresholds.</li>
          <li><b>Discover &amp; search</b> across the whole catalog, trace lineage, and analyse the impact of a change.</li>
        </Ul>
        <H3>Two operating principles worth knowing</H3>
        <Ul>
          <li><b>Nothing is called or computed twice for nothing.</b> Every LLM output (a definition, an
            explanation, a synthesis) is stored the first time it's generated and reused on every later
            visit. You only pay for a fresh LLM call when you explicitly click <b>Regenerate</b>.</li>
          <li><b>Human input is protected.</b> Once you validate a definition, an AI re-run will not silently
            overwrite it — see <b>Conventions &amp; colors</b> in the sidebar for exactly how that's enforced.</li>
        </Ul>
        <H3>Finding your way around</H3>
        <P>
          Press <Kbd>⌘K</Kbd> / <Kbd>Ctrl K</Kbd> anywhere to open the <b>Command Palette</b> — it jumps to any
          view, table, tag, domain, or glossary term instantly, and can launch Magic Enrich. The sun/moon
          toggle in the sidebar switches between light and dark themes. The source-scope selector in the top
          bar filters every view (Catalog, Search, Overview KPIs…) down to one connection, or "All sources".
        </P>
      </>
    ),
  },
  {
    id: "connections", label: "Connections", icon: Database,
    content: (
      <>
        <P>
          A connection is one warehouse or file source. Five types are supported: <b>Demo</b> (a synthetic
          dataset, no setup — the fastest way to try the app), <b>Oracle</b>, <b>ClickHouse</b>,
          <b> Frictionless/OKF</b> (importing a <code>datapackage.json</code> instead of connecting live), and
          <b> MCP</b> (pulling data from another application over the Model Context Protocol).
        </P>
        <H3>Adding, editing, testing</H3>
        <Ul>
          <li><b>New connection</b> opens a form per type; each connection can pin its own local LLM model.</li>
          <li>Hover a connection card to reveal <b>Edit</b> (pencil) and <b>Delete</b> (trash) — editing lets
            you change credentials or the target host without re-creating the connection and losing its scope.</li>
          <li><b>Test</b> pings the connection without profiling anything.</li>
        </Ul>
        <H3>MCP sources</H3>
        <P>
          The mirror of this app's own MCP exposure (see <b>Administration</b>): instead of DOINg.Catalogue
          being the server, here it's the <i>client</i>, pulling data out of another application's MCP
          server. An MCP server has no declared table schema — it exposes arbitrary named tools — so after
          adding the connection (its Streamable HTTP URL and an optional bearer token), click <b>Map with
          AI</b> on its card. The local LLM inspects every tool's name, description and input schema, calls
          the ones it can safely invoke without guessing required arguments, and proposes a table for every
          tool that returns an enumerable collection of records — with a column for every field it can
          identify, to maximise how much of the source becomes usable catalog data. Review the proposal
          (uncheck anything that isn't really tabular) and <b>Apply</b> it; from that point the mapped tables
          behave exactly like any other source in Discovery, Sources &amp; scope, and the agent pipeline —
          <b> Run pipeline</b> stays disabled until at least one table has been mapped. Since an MCP tool
          rarely exposes a true row count, row estimates there are a best-effort approximation, not an exact
          count. If the server's tools change, <b>Remap with AI</b> proposes a fresh set — this turns red
          because it can rename or drop tables a previous mapping had, orphaning any scope or profiling done
          under the old names, so it asks for confirmation first.
        </P>
        <H3>Running the pipeline</H3>
        <P>
          <b>Run pipeline</b> launches all 6 agents against every table in scope (or the whole source if no
          scope was saved). If this connection was already profiled before, the button turns
          {" "}<span className="font-medium text-rose-600 dark:text-rose-400">red</span> and asks you to confirm —
          re-running can overwrite existing profiling and documentation, so it's a deliberate choice, not a
          default. See <b>Sources &amp; scope</b> for a safer, table-by-table way to do the same thing on
          large warehouses.
        </P>
      </>
    ),
  },
  {
    id: "mcp-library", label: "MCP Library", icon: BookMarked,
    content: (
      <>
        <P>
          An MCP source's <b>Map with AI</b> mapping only captures what a tool's live sample looks like —
          the <b>MCP Library</b> goes further, browsing the server's full tool surface (mapped or not) and
          letting you paste the real SQL query or source code behind a tool so the local LLM can describe
          what it actually does, instead of guessing from a JSON sample alone.
        </P>
        <H3>Tools, Queries, Coverage</H3>
        <Ul>
          <li><b>Tools</b> lists every tool the MCP server declares — including write/action tools the
            mapping step skips — flagging which are already mapped to a catalog table and which have a
            documented query.</li>
          <li><b>Add code/SQL</b> on any tool opens a small editor: paste the query or function that backs
            it, pick <b>SQL</b> or <b>Code</b>, and click <b>Extract with AI</b>. One LLM call returns a
            plain-English functional description, every table the query actually reads from or writes to,
            column-level meaning (including computed-column logic), and — if that tool is already mapped —
            a <b>reconciliation</b> against the mapped columns, flagging anything the live sample missed or
            invented.</li>
          <li><b>Coverage</b> ranks the tools most worth documenting next, so maximising coverage is a
            queue to work through rather than a guess.</li>
        </Ul>
        <H3>Cross-database links</H3>
        <P>
          When a pasted query references a table name that matches a dataset from a <i>different</i>
          connection, the extraction proposes it as a <b>link candidate</b> — click <b>Add link</b> to turn
          it into a real lineage edge (visible in Lineage / Impact Analysis) without typing anything by
          hand. This only activates once the tool itself has been mapped and profiled into a catalog table.
        </P>
        <Callout tone="ai">
          Everything the MCP Library learns is also exposed through this app's own MCP server (see
          <b> Administration → MCP</b>) — so another agent connecting to your catalog can learn not just
          your tables, but the real logic behind the other MCP servers you've referenced.
        </Callout>
      </>
    ),
  },
  {
    id: "sources", label: "Sources & scope", icon: ListChecks,
    content: (
      <>
        <P>
          Designed for warehouses with hundreds of tables or billion-row tables, where profiling everything
          blindly would be slow or dangerous. This view lets you decide exactly what gets touched.
        </P>
        <H3>Discover → filter → select → count → run</H3>
        <Ul>
          <li><b>Discover tables</b> lists the source's full inventory (name, schema, kind) — instant, with
            no profiling or sampling, even for thousands of tables.</li>
          <li>Filter by name/schema, or toggle <b>Not yet catalogued</b> to see only what's new.</li>
          <li><b>Select</b> exactly the tables you want (checkboxes, "select all filtered", "invert").</li>
          <li>Once tables are selected, a <b>row-count check</b> panel appears: a simple <code>SELECT COUNT</code>
            per table, run sequentially (never in parallel) so it can't overload the source. You confirm
            per table (or per batch) before it runs, and can <b>cancel</b> a check mid-flight.</li>
          <li>Set a <b>sample size</b> per table (default 500 rows) — this caps how many rows Profiling and
            ETL-mapping ever fetch from that table, overriding the admin's global row-fetch limit when you
            deliberately raise it.</li>
          <li><b>Save scope</b> persists the selection without running anything; <b>Run agents on selection</b>
            launches the pipeline restricted to exactly those tables. If any selected table is already in the
            catalog, the button turns red and a confirmation explains re-running may overwrite it.</li>
        </Ul>
        <Callout tone="info">
          Agents launched from this view <b>never</b> touch a table outside your selection — the footer always
          states how many tables are selected out of the source's total inventory.
        </Callout>
      </>
    ),
  },
  {
    id: "agents", label: "Agents & automation", icon: Bot,
    content: (
      <>
        <P>The six built-in agents, run individually or chained as one pipeline:</P>
        <Ul>
          <li><b>Profiler</b> — connects, samples values, computes each column's fingerprint (semantic type,
            null/distinct ratios, format masks, quality score, MinHash for similarity).</li>
          <li><b>Linker</b> — compares every column pairwise via real value-overlap tests to infer PK→FK
            relationships and "same field" matches — not guesses from column names alone.</li>
          <li><b>Documenter</b> — the local LLM writes a functional definition and calculation method per
            table/column, with a confidence score; falls back to heuristics if the LLM is offline.</li>
          <li><b>Lineage</b> — rebuilds table-level data chains from relationships, detected mapping tables,
            and any free-text model notes you've written (e.g. "CUSTOMERS → DIM_CLIENT").</li>
          <li><b>QA Reviewer</b> — audits the catalog against your configured alert thresholds (see
            <b> Data quality &amp; alerts</b>) and produces a severity-ranked issue list.</li>
          <li><b>Glossary</b> — extracts recurring business terms across columns and links them back to
            where they appear.</li>
        </Ul>
        <H3>Magic Enrich</H3>
        <P>
          Runs all six agents in order, streaming live progress in the <b>Agent console</b>. You can also run
          any single agent with its own <b>Run</b> button. Both are green when there's nothing to lose, and
          turn red — with a confirmation dialog — the moment re-running could overwrite profiling or
          documentation already on file for that connection.
        </P>
        <H3>Monitoring a run</H3>
        <Ul>
          <li>The progress bar and per-agent checkmarks update live; the console streams timestamped log lines.</li>
          <li><b>Stop</b> cancels a running pipeline cooperatively — it finishes the table in flight, then halts.</li>
          <li><b>Run history</b> lists past runs; click one to reload its console output.</li>
        </Ul>
      </>
    ),
  },
  {
    id: "catalog", label: "Catalog", icon: Table2,
    content: (
      <>
        <P>
          The Catalog is where you review and edit what the agents produced. Pick a table on the left; the
          entity page on the right is organised into tabs:
        </P>
        <Ul>
          <li><b>Overview</b> — stats, health score, tags, domain assignment, owners, deprecation status, and view count.</li>
          <li><b>Schema</b> — every column with its semantic type, tags, and a fingerprint panel (top values,
            null/distinct ratios, format) when selected.</li>
          <li><b>Lineage</b> — this table's relationships and column-lineage edges, with a link to open the
            full <b>Impact Analysis</b> view scoped to a specific column.</li>
          <li><b>Quality</b> — the health checklist behind this table's score (see <b>Data quality &amp; alerts</b>).</li>
          <li><b>Properties</b> — free-form key/value custom metadata (SLA, retention policy, source system…).</li>
          <li><b>Documentation</b> — identity card, content synthesis, logical partitioning, and ETL mapping import.</li>
        </Ul>
        <H3>Editing a column definition</H3>
        <P>
          Select a column, click <b>Edit</b> to write a definition, calculation method, and optional source
          origin by hand — or click <b>AI suggest</b> to have the local LLM propose one, grounded in the
          column's actual profiled evidence (not hallucinated). Review the suggestion, its cited evidence,
          and confidence score, then <b>Accept</b>, <b>Regenerate</b> (fetch a new suggestion), or <b>Discard</b>.
        </P>
        <Callout tone="danger">
          If a column already has a human-validated definition, Accept turns red and asks for a
          <b> triple confirmation</b> before overwriting it — the strongest safeguard in the app, reserved for
          destroying validated human work.
        </Callout>
        <H3>Auto-document table</H3>
        <P>
          Documents every column of a table in one LLM call. Human-validated columns are automatically
          skipped unless you explicitly opt in to overwrite them (with the same triple-confirmation
          safeguard) — so batch documentation can never silently erase reviewed work.
        </P>
        <H3>Identity card &amp; content synthesis</H3>
        <P>
          <b>Generate with AI</b> produces a reusable natural-language synthesis of the table (its grain,
          data kind, related products) — stored once and never recomputed unless you click <b>Regenerate</b>,
          which asks for confirmation since it replaces the stored text.
        </P>
        <H3>ETL mapping import</H3>
        <P>
          If a table looks like ETL configuration (column names like target/source/transformation), the LLM
          can read it and build lineage edges plus pre-documentation from it. This action is <b>always safe</b> —
          it merges with what exists and never erases a definition, so its controls stay green throughout.
        </P>
        <H3>Deprecation</H3>
        <P>
          Mark a table <b>Deprecated</b> with a reason and optional replacement table. A banner appears on the
          entity page, and a warning badge propagates to the Catalog list, Library cards, and Search results
          — so nobody builds new work on a table that's being phased out. <b>Undeprecate</b> reverses it, no
          confirmation needed (deprecation is reversible metadata, not data loss).
        </P>
      </>
    ),
  },
  {
    id: "governance", label: "Governance", icon: ShieldCheck,
    content: (
      <>
        <H3>Tags</H3>
        <P>
          Free-form labels on tables and columns, with autocomplete against tags already in use. The
          <b> Tags</b> view lists every tag with its usage count and lets you drill into every table/column
          carrying it.
        </P>
        <H3>Domains</H3>
        <P>
          A hierarchical business taxonomy (e.g. Sales → EMEA), separate from the LLM-guessed free-text
          domain shown elsewhere. Build the tree in the <b>Domains</b> view, then assign each table to a node
          from the Catalog's Overview tab. A parent node's count includes all its descendants.
        </P>
        <H3>Ownership</H3>
        <P>
          Assign one or more owners (technical, business, or steward) to a table — pick an existing user or
          add a free-text name. Owners show as avatar initials on Catalog rows and feed directly into the
          table's health score.
        </P>
        <H3>Custom properties</H3>
        <P>
          Arbitrary key/value metadata on the Properties tab — SLA, retention policy, source system, or
          anything specific to your organisation that doesn't fit the built-in fields.
        </P>
      </>
    ),
  },
  {
    id: "lineage", label: "Relationships, lineage & impact", icon: Route,
    content: (
      <>
        <H3>Relationships</H3>
        <P>
          Every PK→FK link the Linker agent inferred, with a confidence score. <b>Validate</b> or
          <b> reject</b> a relationship, or click the sparkle icon to have the LLM <b>explain</b> it in
          plain business language (cardinality + meaning) — cached so it's only computed once per edge. You
          can also add a relationship manually; manual and validated edges are never lost when the Linker
          agent re-runs — only the auto-inferred set is refreshed.
        </P>
        <H3>Lineage</H3>
        <P>
          A table-level directed graph combining inferred keys, detected mapping tables, and free-text model
          notes ("A → B", parsed automatically). This view is intentionally <b>rebuilt</b> every time the
          Lineage agent runs — think of it as a live projection of your relationships and notes, not
          independently-edited data.
        </P>
        <H3>Impact Analysis</H3>
        <P>
          Column-level, not table-level: pick a dataset and column, and trace every upstream source that
          feeds it and every downstream column that would be affected by a change — combining relationships
          with explicit <b>column lineage</b> edges you add manually (e.g. "this column is computed from that
          one via an ETL job"). Use this before altering or dropping a column to see the blast radius.
        </P>
        <H3>Catalog Graph</H3>
        <P>
          A single zoomable map of everything: sources, tables and (for MCP sources) unmapped tools, with
          every relationship, lineage and mapping edge between them. <b>Scroll to zoom, drag to pan</b>, or
          use the toolbar's zoom/fit buttons. The left panel lets you <b>sub-select a scope</b> — uncheck a
          source to hide it entirely, or collapse a large source into one cluster node (automatic past 6
          tables) to keep the graph readable; cross-source edges still show, just pointing at the cluster.
          Table nodes are colored by data quality (green/amber/red), relationship types can be toggled off
          individually, the search box finds and selects any node by name, and checking <b>Isolate
          neighborhood</b> after selecting a node dims everything except its direct connections.
        </P>
      </>
    ),
  },
  {
    id: "search", label: "Search & discovery", icon: Search,
    content: (
      <>
        <P>
          <b>Universal Search</b> queries tables, columns, glossary terms, tags, and domains in one box, with
          facet counts to filter by type and an optional LLM-generated natural-language answer grounded in
          the matched results. Every result drills straight into the right view — a table result opens the
          Catalog pre-scrolled to that table (and column, if the match was a column).
        </P>
        <P>
          The <b>Command Palette</b> (<Kbd>⌘K</Kbd>) is the fast, always-available counterpart: instant,
          client-side fuzzy matching across navigation, tables, glossary terms, tags, and domains — with the
          same drill-down behaviour.
        </P>
      </>
    ),
  },
  {
    id: "explorer", label: "Explorer & Library", icon: Compass,
    content: (
      <>
        <H3>Explorer</H3>
        <P>
          A prioritised "next best action" queue — the highest-impact undocumented columns first — plus a
          <b> Copilot</b> chat that answers questions about the catalog, grounded in real data (RAG over your
          tables, columns, and definitions). Click a queue item to jump straight to that column in the
          Catalog, where you can get an AI suggestion and apply it.
        </P>
        <H3>Library</H3>
        <P>
          The plain-language front door to the catalog for non-technical users: browse tables grouped by
          domain with human-readable names, or <b>Ask the Librarian</b> a free-text question and get an
          answer with citations back to the underlying tables.
        </P>
      </>
    ),
  },
  {
    id: "quality", label: "Data quality & alerts", icon: Sliders,
    content: (
      <>
        <P>
          Every table has a 0–100 <b>health score</b>, and the QA Reviewer agent produces a severity-ranked
          issue list. Both are driven by the same admin-configurable thresholds, so they never disagree.
        </P>
        <H3>What's checked</H3>
        <Ul>
          <li>Has a table-level definition, an assigned owner, and a candidate primary key.</li>
          <li>No column's <b>null ratio</b> exceeds the configured threshold (default 50%).</li>
          <li>No column's <b>quality score</b> falls below the warn/critical thresholds (default 60 / 35).</li>
          <li><b>Row-count drift</b> — a table's row count dropped more than the configured percentage
            (default 20%) since the last time it was profiled.</li>
          <li><b>Stale profiling</b> — a table hasn't been re-profiled within the configured window (default 30 days).</li>
          <li>Every <b>PII</b> column has been explicitly reviewed and validated (can be toggled off).</li>
          <li>The table isn't deprecated.</li>
        </Ul>
        <H3>Configuring your own thresholds</H3>
        <P>
          Admins can tune every threshold above in <b>Settings → Data quality alerts</b>: lower them to catch
          more issues, raise them to reduce noise for a warehouse that's noisier by nature. Changes apply
          immediately to both the health score shown throughout the app and the next QA Reviewer run.
        </P>
        <H3>AI help on a specific issue</H3>
        <P>
          Click the sparkle icon next to any issue in the Agents view's Quality audit panel to have the local
          LLM explain, in plain business language, what the issue means, why it matters, and a concrete
          suggested fix — grounded in that table's real definition and profile. Nothing is called
          automatically; it's generated on demand and not persisted, since the issue list itself is
          recomputed on every QA Reviewer run.
        </P>
        <P>Dismiss an issue with the × if it's been triaged and doesn't need to stay in the list.</P>
      </>
    ),
  },
  {
    id: "deep-quality", label: "Data Quality Checks (deep analysis)", icon: Microscope,
    content: (
      <>
        <P>
          A separate, independent module from the QA Reviewer agent above — instead of auditing metadata
          against fixed thresholds, it runs its own live statistical analysis directly against the source
          (numeric outliers, categorical rarity, format-pattern breaks, duplicate rows) and uses the local LLM
          to decide what's worth checking, follow up on anything surprising, and write the findings up in
          plain English.
        </P>
        <H3>Running an analysis</H3>
        <Ul>
          <li>Pick a <b>connection</b> and the specific <b>tables</b> to analyse — nothing outside your selection is touched.</li>
          <li>Optional <b>focus notes</b> steer the LLM toward specific tables, columns, or concerns
            ("check payment amounts for fraud-like outliers").</li>
          <li><b>Thresholds</b> (z-score, IQR multiplier, outlier/duplicate severity cutoffs, sample sizes) have
            sensible defaults — expand <b>Thresholds → customise</b> to tune them.</li>
        </Ul>
        <H3>How the agent reasons — plan, check, adapt, interpret</H3>
        <Ul>
          <li><b>Plan</b> — before running anything expensive, the LLM looks at cheap discovery signals (column
            types, existing functional definitions, PII flags, your focus notes) and decides which checks are
            worth running on which columns of which tables — skipping ones unlikely to reveal anything, which
            is what keeps a run on a large warehouse fast.</li>
          <li><b>Check</b> — the planned statistical checks run directly against the source.</li>
          <li><b>Adapt</b> — the LLM reviews the first pass of results and can propose a small number of
            targeted follow-up checks if something looks surprising, before moving on.</li>
          <li><b>Interpret</b> — for each table, the LLM writes an executive summary and ranks findings by how
            much they'd surprise someone who knows the dataset well — surfacing what a quick manual look
            wouldn't easily catch, not just the obvious issues.</li>
        </Ul>
        <P>Every phase streams live to the console, and you can <b>cancel</b> a run in progress at any time.</P>
        <H3>Reading the results &amp; exporting a report</H3>
        <P>
          Each table gets a risk badge (low/medium/high) and an executive summary, with its top findings
          explained in plain language alongside a suggested next step; minor findings collapse into a "more
          findings" list. Click <b>Export PDF report</b> for a professionally formatted, shareable summary of
          the whole run — table risk levels, findings, and the LLM's explanations — matching the app's branding.
        </P>
        <P>
          Past reports are kept in the <b>Past reports</b> list on the left so you can revisit or re-export
          them without recomputing anything.
        </P>
      </>
    ),
  },
  {
    id: "admin", label: "Administration", icon: UserCog,
    content: (
      <>
        <H3>Users &amp; roles</H3>
        <P>
          Admin-only user management. Three roles: <b>Admin</b> (everything, plus user management and MCP
          exposure), <b>Read / write</b> (browse and edit the catalogue, run agents and quality checks), and
          <b> Read only</b> (browse the catalogue and ask the local LLM/Librarian, but every create, edit,
          delete or run action is rejected — enforced by the server itself, not just hidden buttons, so it
          holds even if someone calls the API directly). A role change or deactivation notifies every admin.
        </P>
        <H3>Notifications</H3>
        <P>
          The bell icon in the sidebar footer shows a per-user unread count. Everyone sees pipeline and
          Data Quality Check completions/failures and connection removals; admins additionally see
          user-management and security events (a user's role changed, the MCP token rotated or revoked).
          Clicking a notification marks it read and jumps to the relevant view; <b>Mark all read</b> clears
          the badge. Each user's read state is their own — nothing is dismissed for anyone else.
        </P>
        <H3>Admin account recovery</H3>
        <P>
          If you're locked out, click <b>Forgot password? Reset admin account</b> on the login screen. A
          one-time reset code is printed to the <b>backend server console</b> only — never emailed or shown
          in the browser — so recovery requires access to the machine running the server.
        </P>
        <H3>MCP (Model Context Protocol)</H3>
        <P>
          Admin-only configuration for exposing the catalog to external AI agents over MCP: toggle it on,
          choose which tools are exposed (list datasets, get schema, search, get a definition, lineage,
          glossary, sample rows), and control exposure (hide PII by default, deny specific datasets or columns).
          Three tools expose the <b>MCP Library</b> itself — <code>list_mcp_sources</code>,
          <code> get_mcp_source_tools</code> and <code>get_mcp_query_definition</code> — so an external agent
          connecting to this catalog's own MCP endpoint can discover which other MCP servers you've referenced
          and read the actual documented logic behind their tools, not just this catalog's own tables.
        </P>
        <H3>Connector settings</H3>
        <P>
          The admin-wide <b>row fetch limit</b> caps how many rows any profiling, ETL-mapping, or MCP query
          fetches per call, protecting the source from runaway queries. A table-specific sample size set in
          Sources &amp; scope overrides this ceiling deliberately, per table.
        </P>
        <H3>Query log</H3>
        <P>Live view of every query the app issues against a source, with status and the ability to kill a running query.</P>
        <H3>Audit log &amp; time-travel</H3>
        <P>Every mutation is versioned; the audit log lists each change with its version number, action, and timestamp.</P>
        <H3>Backup, restore, export &amp; reset</H3>
        <Ul>
          <li><b>Backup &amp; restore</b> — download a full snapshot (catalog + connections + settings + LLM
            config) and reload it later, replacing or merging into the current state.</li>
          <li><b>Export</b> — the catalog alone, the app configuration alone, or a full snapshot, as Markdown, JSON, or OKF.</li>
          <li><b>Reset catalog</b> — clears all profiled data (tables, relationships, lineage, glossary, runs)
            while keeping connections and settings. Irreversible — a confirmation is required.</li>
        </Ul>
      </>
    ),
  },
  {
    id: "conventions", label: "Conventions & colors", icon: Zap,
    content: (
      <>
        <P>Buttons in DOINg.Catalogue follow one consistent color rule, everywhere the local LLM is involved:</P>
        <Callout tone="ai">
          <b>Green</b> — this button lets the local LLM enrich the catalog or create new content: suggest a
          definition, document a table, synthesise an identity card, explain a relationship, or run an
          agent for the first time. Clicking it is safe — nothing you've already saved is at risk.
        </Callout>
        <Callout tone="danger">
          <b>Red</b> — clicking this button <i>can</i> overwrite data you (or a previous run) already saved:
          re-running an agent that already completed, accepting an AI suggestion over a validated
          definition, or applying auto-documentation that includes human-validated columns. The color is a
          warning, not a blocker — the same confirmation dialogs that existed before this convention still
          fire, and the more validated data is at stake, the stronger the confirmation:
        </Callout>
        <Ul>
          <li><b>No dialog</b> — nothing to lose (e.g. suggesting a definition for an empty column).</li>
          <li><b>Single confirmation</b> — overwriting existing but non-validated content.</li>
          <li><b>Triple confirmation</b> — overwriting a human-validated definition. This is the strongest
            safeguard in the app and cannot be bypassed accidentally.</li>
        </Ul>
        <P>
          A few actions stay green even though they write data, because they're designed to never erase
          anything — ETL mapping import merges by construction, and undeprecating a table is purely additive.
        </P>
      </>
    ),
  },
];

export function Guide() {
  const [active, setActive] = useState(SECTIONS[0].id);
  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  return (
    <div className="grid h-[calc(100vh-9rem)] gap-4 lg:grid-cols-[260px_1fr]">
      <div className="card flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
          <LifeBuoy size={16} className="text-loom-500" />
          <span className="text-sm font-semibold">User Guide</span>
        </div>
        <div className="flex-1 space-y-0.5 overflow-auto p-1.5">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const isActive = s.id === active;
            return (
              <button key={s.id} onClick={() => setActive(s.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm ${
                  isActive ? "bg-loom-500/10 text-loom-600 dark:text-loom-300" : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/60"}`}>
                <Icon size={16} className={isActive ? "" : "opacity-70"} />
                <span className="flex-1 truncate">{s.label}</span>
                {isActive && <ChevronRight size={14} className="opacity-60" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card min-h-0 overflow-auto p-6">
        <div className="mx-auto max-w-2xl">
          <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-loom-500">
            <Sparkles size={13} /> {section.label}
          </div>
          {section.content}
        </div>
      </div>
    </div>
  );
}
