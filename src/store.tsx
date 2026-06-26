import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, VersionConflict } from "./api";
import type { AgentRun, CatalogState, Health } from "./types";

interface Toast { id: number; kind: "ok" | "err" | "info"; text: string; }

interface Ctx {
  state: CatalogState | null;
  health: Health | null;
  loading: boolean;
  toasts: Toast[];
  refresh: () => Promise<void>;
  toast: (kind: Toast["kind"], text: string) => void;
  /** run a mutation, auto-refresh, and surface version conflicts as toasts */
  mutate: <T>(fn: (version: number) => Promise<T>) => Promise<T | undefined>;
  activeRun: AgentRun | null;
  setActiveRun: (r: AgentRun | null) => void;
}

const CatalogContext = createContext<Ctx | null>(null);

export function useCatalog(): Ctx {
  const c = useContext(CatalogContext);
  if (!c) throw new Error("useCatalog outside provider");
  return c;
}

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CatalogState | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const toastId = useRef(0);

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([api.state(), api.health()]);
      setState(s);
      setHealth(h);
    } catch {
      toast("err", "API unreachable — start the backend on port 3001.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { refresh(); }, [refresh]);

  const mutate = useCallback(
    async <T,>(fn: (version: number) => Promise<T>): Promise<T | undefined> => {
      if (!state) return;
      try {
        const r = await fn(state.version);
        await refresh();
        return r;
      } catch (e) {
        if (e instanceof VersionConflict) {
          toast("err", "Version conflict — catalog changed, reloading…");
          await refresh();
        } else {
          toast("err", (e as Error).message || "Error");
        }
        return undefined;
      }
    },
    [state, refresh, toast]
  );

  // poll an active run until done
  useEffect(() => {
    if (!activeRun || activeRun.status === "done" || activeRun.status === "error") return;
    const t = setInterval(async () => {
      try {
        const r = await api.getRun(activeRun.id);
        setActiveRun(r);
        if (r.status === "done" || r.status === "error") {
          await refresh();
          if (r.status === "done") toast("ok", "Pipeline complete ✓");
          else toast("err", "Pipeline failed");
        }
      } catch { /* ignore */ }
    }, 700);
    return () => clearInterval(t);
  }, [activeRun, refresh, toast]);

  return (
    <CatalogContext.Provider value={{ state, health, loading, toasts, refresh, toast, mutate, activeRun, setActiveRun }}>
      {children}
    </CatalogContext.Provider>
  );
}
