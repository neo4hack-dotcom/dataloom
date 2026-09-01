import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api, getAuthToken, setAuthToken } from "./api";
import type { User } from "./types";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  bootstrapNeeded: boolean;
  login: (username: string, password: string) => Promise<void>;
  bootstrap: (username: string, password: string) => Promise<void>;
  requestReset: () => Promise<string>;
  confirmReset: (code: string, username: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside provider");
  return c;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootstrapNeeded, setBootstrapNeeded] = useState(false);

  const boot = useCallback(async () => {
    setLoading(true);
    try {
      const status = await api.authStatus();
      setBootstrapNeeded(status.bootstrap_needed);
      if (!status.bootstrap_needed && getAuthToken()) {
        try {
          const { user } = await api.me();
          setUser(user);
        } catch {
          setAuthToken(null);
          setUser(null);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { boot(); }, [boot]);

  const login = useCallback(async (username: string, password: string) => {
    const { token, user } = await api.login(username, password);
    setAuthToken(token);
    setUser(user);
  }, []);

  const bootstrap = useCallback(async (username: string, password: string) => {
    const { token, user } = await api.bootstrap(username, password);
    setAuthToken(token);
    setUser(user);
    setBootstrapNeeded(false);
  }, []);

  const logout = useCallback(() => {
    api.logout().catch(() => {});
    setAuthToken(null);
    setUser(null);
  }, []);

  const requestReset = useCallback(async () => {
    const r = await api.requestAdminReset();
    return r.message;
  }, []);

  const confirmReset = useCallback(async (code: string, username: string, password: string) => {
    const { token, user } = await api.confirmAdminReset(code, username, password);
    setAuthToken(token);
    setUser(user);
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, bootstrapNeeded, login, bootstrap, requestReset, confirmReset, logout }}>
      {children}
    </Ctx.Provider>
  );
}
