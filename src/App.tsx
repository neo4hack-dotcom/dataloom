import { Component, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  LayoutDashboard, Database, Table2, GitCompare, Workflow, Bot, Tags,
  Search, Settings as SettingsIcon, Command, Moon, Sun, Sparkles, Cpu,
  CircleDot, Link2, Compass, Library as LibraryIcon, ListChecks,
} from "lucide-react";
import { CatalogProvider, useCatalog } from "./store";
import { CommandPalette } from "./components/CommandPalette";
import { Toaster } from "./components/Toaster";
import { Overview } from "./views/Overview";
import { Connections } from "./views/Connections";
import { Sources } from "./views/Sources";
import { Catalog } from "./views/Catalog";
import { Explorer } from "./views/Explorer";
import { Library } from "./views/Library";
import { Relationships } from "./views/Relationships";
import { Lineage } from "./views/Lineage";
import { Agents } from "./views/Agents";
import { Glossary } from "./views/Glossary";
import { SearchView } from "./views/SearchView";
import { SettingsView } from "./views/SettingsView";

export type Tab =
  | "overview" | "library" | "connections" | "sources" | "catalog" | "explorer" | "relationships"
  | "lineage" | "agents" | "glossary" | "search" | "settings";

const TABS: { id: Tab; label: string; icon: typeof Database; group?: string }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "library", label: "Library", icon: LibraryIcon },
  { id: "connections", label: "Connections", icon: Database, group: "Build" },
  { id: "sources", label: "Sources & scope", icon: ListChecks },
  { id: "catalog", label: "Catalog", icon: Table2 },
  { id: "explorer", label: "Explorer", icon: Compass },
  { id: "relationships", label: "Relationships", icon: GitCompare },
  { id: "lineage", label: "Lineage", icon: Workflow },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "glossary", label: "Glossary", icon: Tags },
  { id: "search", label: "Search", icon: Search },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

function Shell() {
  const [tab, setTab] = useState<Tab>("overview");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dark, setDark] = useState(true);
  const { state, health, loading, activeRun, activeConn, setActiveConn } = useCatalog();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const counts = useMemo(() => ({
    datasets: state?.datasets.length ?? 0,
    relationships: state?.relationships.length ?? 0,
    matches: state?.matches.length ?? 0,
  }), [state]);

  const running = activeRun && (activeRun.status === "running" || activeRun.status === "queued");

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white/70 backdrop-blur dark:border-slate-800 dark:bg-slate-950/60">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-loom-500 to-violet-600 text-white shadow-lg shadow-loom-600/30">
            <Workflow size={20} />
          </div>
          <div>
            <div className="text-sm font-bold leading-tight">DOINg.Catalogue</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Data Catalogue</div>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            const badge =
              t.id === "catalog" ? counts.datasets :
              t.id === "relationships" ? counts.relationships : 0;
            return (
              <div key={t.id}>
                {t.group && (
                  <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {t.group}
                  </div>
                )}
              <button onClick={() => setTab(t.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-loom-500/10 text-loom-600 dark:text-loom-300"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/60"
                }`}>
                <Icon size={17} className={active ? "" : "opacity-70"} />
                <span className="flex-1 text-left">{t.label}</span>
                {badge > 0 && (
                  <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    {badge}
                  </span>
                )}
                {t.id === "agents" && running && (
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-emerald-400" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                )}
              </button>
              </div>
            );
          })}
        </nav>

        <div className="space-y-2 border-t border-slate-200 px-3 py-3 dark:border-slate-800">
          <button onClick={() => setPaletteOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
            <Command size={14} /> Command Palette
            <kbd className="ml-auto rounded bg-slate-100 px-1.5 font-mono text-[10px] dark:bg-slate-800">⌘K</kbd>
          </button>
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-1.5 text-[11px]">
              <Cpu size={13} className={health?.llm.up ? "text-emerald-500" : "text-slate-400"} />
              <span className="text-slate-500">
                {health?.llm.up ? "LLM online" : "LLM offline"}
              </span>
            </div>
            <button onClick={() => setDark((d) => !d)} className="btn-ghost !p-1.5">
              {dark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col bg-grid">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white/60 px-6 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/40">
          <h1 className="text-base font-semibold">
            {TABS.find((t) => t.id === tab)?.label}
          </h1>

          {/* global source scope — filters every view */}
          {(state?.connections.length ?? 0) > 0 && (
            <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/60 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900/60">
              <Database size={13} className="text-loom-500" />
              <select value={activeConn} onChange={(e) => setActiveConn(e.target.value)}
                className="bg-transparent text-xs font-medium outline-none dark:text-slate-200">
                <option value="all">All sources</option>
                {state!.connections.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}

          <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <CircleDot size={13} className="text-emerald-500" /> v{state?.version ?? "—"}
            </span>
            <span className="flex items-center gap-1">
              <Link2 size={13} /> {counts.matches} links
            </span>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
          {loading ? (
            <div className="grid h-full place-items-center text-slate-400">
              <div className="flex items-center gap-2"><Sparkles className="animate-pulse" /> Loading catalog…</div>
            </div>
          ) : (
            <div className="mx-auto max-w-7xl animate-fade-in">
              {tab === "overview" && <Overview goto={setTab} />}
              {tab === "library" && <Library goto={setTab} />}
              {tab === "connections" && <Connections goto={setTab} />}
              {tab === "sources" && <Sources goto={setTab} />}
              {tab === "catalog" && <Catalog />}
              {tab === "explorer" && <Explorer />}
              {tab === "relationships" && <Relationships />}
              {tab === "lineage" && <Lineage />}
              {tab === "agents" && <Agents />}
              {tab === "glossary" && <Glossary />}
              {tab === "search" && <SearchView />}
              {tab === "settings" && <SettingsView />}
            </div>
          )}
        </div>
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} goto={setTab} />
      <Toaster />
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (this.state.err)
      return (
        <pre className="m-6 max-w-3xl overflow-auto rounded-lg bg-rose-500/10 p-4 text-xs text-rose-400">
          {this.state.err.message}
          {"\n\n"}
          {this.state.err.stack}
        </pre>
      );
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <CatalogProvider>
        <Shell />
      </CatalogProvider>
    </ErrorBoundary>
  );
}
