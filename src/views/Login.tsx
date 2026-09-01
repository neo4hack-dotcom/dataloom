import { useState } from "react";
import { Workflow, Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth";

export function Login() {
  const { bootstrapNeeded, login, bootstrap } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (bootstrapNeeded && password !== confirm) {
      setErr("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      if (bootstrapNeeded) await bootstrap(username.trim(), password);
      else await login(username.trim(), password);
    } catch (e) {
      setErr((e as Error).message || "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-screen place-items-center bg-grid">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-loom-500 to-violet-600 text-white shadow-lg shadow-loom-600/30">
            <Workflow size={20} />
          </div>
          <div>
            <div className="text-sm font-bold leading-tight">DOINg.Catalogue</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Data Catalogue</div>
          </div>
        </div>

        {bootstrapNeeded && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-loom-500/10 p-3 text-xs text-loom-600 dark:text-loom-300">
            <ShieldCheck size={15} className="mt-0.5 shrink-0" />
            <span>No account exists yet — create the first admin account to set up the catalogue.</span>
          </div>
        )}

        <label className="mb-3 block text-xs font-medium text-slate-500">
          Username
          <input className="input mt-1" value={username} onChange={(e) => setUsername(e.target.value)}
            autoFocus required autoComplete="username" />
        </label>
        <label className="mb-3 block text-xs font-medium text-slate-500">
          Password
          <input type="password" className="input mt-1" value={password}
            onChange={(e) => setPassword(e.target.value)} required minLength={8}
            autoComplete={bootstrapNeeded ? "new-password" : "current-password"} />
        </label>
        {bootstrapNeeded && (
          <label className="mb-3 block text-xs font-medium text-slate-500">
            Confirm password
            <input type="password" className="input mt-1" value={confirm}
              onChange={(e) => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" />
          </label>
        )}

        {err && <div className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-500">{err}</div>}

        <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
          {busy && <Loader2 size={14} className="animate-spin" />}
          {bootstrapNeeded ? "Create admin account" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
