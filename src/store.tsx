import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, Unauthorized, VersionConflict } from "./api";
import { useAuth } from "./auth";
import type { AgentRun, CatalogState, Health, Notification } from "./types";

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
  /** global source scope: "all" or a connection id — filters every view */
  activeConn: string;
  setActiveConn: (id: string) => void;
  /** cross-view drill-down: Search/CommandPalette/Impact Analysis set this, Catalog reads it on mount */
  focusDataset: { dsId: string; col?: string } | null;
  setFocusDataset: (f: { dsId: string; col?: string } | null) => void;
  /** cross-view drill-down into Impact Analysis, pre-selecting a dataset+column */
  focusImpact: { dsId: string; col: string } | null;
  setFocusImpact: (f: { dsId: string; col: string } | null) => void;
  /** true unless the signed-in user has the read-only "viewer" role */
  canWrite: boolean;
  notifications: Notification[];
  unreadCount: number;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
}

const CatalogContext = createContext<Ctx | null>(null);

export function useCatalog(): Ctx {
  const c = useContext(CatalogContext);
  if (!c) throw new Error("useCatalog outside provider");
  return c;
}

/** Datasets filtered by the active source scope ("all" → everything). */
export function useScopedDatasets() {
  const { state, activeConn } = useCatalog();
  const all = state?.datasets ?? [];
  return activeConn === "all" ? all : all.filter((d) => d.connection_id === activeConn);
}

export function CatalogProvider({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [state, setState] = useState<CatalogState | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const [activeConn, setActiveConnState] = useState<string>(
    () => localStorage.getItem("dl.activeConn") || "all");
  const [focusDataset, setFocusDataset] = useState<{ dsId: string; col?: string } | null>(null);
  const [focusImpact, setFocusImpact] = useState<{ dsId: string; col: string } | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const toastId = useRef(0);
  const canWrite = user?.role !== "viewer";

  const setActiveConn = useCallback((id: string) => {
    setActiveConnState(id);
    localStorage.setItem("dl.activeConn", id);
  }, []);

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
    } catch (e) {
      if (e instanceof Unauthorized) logout();
      else toast("err", "API unreachable — start the backend on port 3001.");
    } finally {
      setLoading(false);
    }
  }, [toast, logout]);

  useEffect(() => {
    if (user) refresh();
    else setLoading(false);
  }, [user, refresh]);

  const mutate = useCallback(
    async <T,>(fn: (version: number) => Promise<T>): Promise<T | undefined> => {
      if (!state) return;
      if (user?.role === "viewer") {
        toast("err", "Your account has read-only access — ask an admin for edit rights.");
        return undefined;
      }
      try {
        const r = await fn(state.version);
        await refresh();
        return r;
      } catch (e) {
        if (e instanceof VersionConflict) {
          toast("err", "Version conflict — catalog changed, reloading…");
          await refresh();
        } else if (e instanceof Unauthorized) {
          logout();
        } else {
          toast("err", (e as Error).message || "Error");
        }
        return undefined;
      }
    },
    [state, user, refresh, toast, logout]
  );

  // notifications — light poll, independent of the catalog refresh cadence
  const loadNotifications = useCallback(async () => {
    try {
      const r = await api.listNotifications();
      setNotifications(r.notifications);
      setUnreadCount(r.unread_count);
    } catch { /* ignore — not worth surfacing a toast for a background poll */ }
  }, []);

  useEffect(() => {
    if (!user) { setNotifications([]); setUnreadCount(0); return; }
    loadNotifications();
    const t = setInterval(loadNotifications, 20000);
    return () => clearInterval(t);
  }, [user, loadNotifications]);

  const markNotificationRead = useCallback((id: string) => {
    setNotifications((ns) => ns.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    api.markNotificationRead(id).catch(() => {});
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((ns) => ns.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    api.markAllNotificationsRead().catch(() => {});
  }, []);

  // poll an active run until done
  useEffect(() => {
    if (!activeRun || activeRun.status === "done" || activeRun.status === "error" || activeRun.status === "cancelled") return;
    const t = setInterval(async () => {
      try {
        const r = await api.getRun(activeRun.id);
        setActiveRun(r);
        if (r.status === "done" || r.status === "error" || r.status === "cancelled") {
          await refresh();
          if (r.status === "done") toast("ok", "Pipeline complete ✓");
          else if (r.status === "cancelled") toast("info", "Pipeline cancelled");
          else toast("err", "Pipeline failed");
        }
      } catch { /* ignore */ }
    }, 700);
    return () => clearInterval(t);
  }, [activeRun, refresh, toast]);

  return (
    <CatalogContext.Provider value={{
      state, health, loading, toasts, refresh, toast, mutate, activeRun, setActiveRun, activeConn, setActiveConn,
      focusDataset, setFocusDataset, focusImpact, setFocusImpact, canWrite,
      notifications, unreadCount, markNotificationRead, markAllNotificationsRead,
    }}>
      {children}
    </CatalogContext.Provider>
  );
}
