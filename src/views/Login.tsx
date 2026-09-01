import { useState } from "react";
import { Workflow, Loader2, ShieldCheck, KeyRound, ArrowLeft } from "lucide-react";
import { useAuth } from "../auth";

type Mode = "login" | "reset-request" | "reset-confirm";

export function Login() {
  const { bootstrapNeeded, login, bootstrap, requestReset, confirmReset } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submitLogin = async (e: React.FormEvent) => {
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

  const submitRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const message = await requestReset();
      setInfo(message);
      setMode("reset-confirm");
    } catch (e) {
      setErr((e as Error).message || "Failed");
    } finally {
      setBusy(false);
    }
  };

  const submitConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (password !== confirm) {
      setErr("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await confirmReset(code.trim(), username.trim(), password);
    } catch (e) {
      setErr((e as Error).message || "Failed");
    } finally {
      setBusy(false);
    }
  };

  const backToLogin = () => {
    setMode("login"); setErr(null); setInfo(null);
    setCode(""); setPassword(""); setConfirm("");
  };

  return (
    <div className="grid h-screen place-items-center bg-grid">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-loom-400 to-loom-700 text-white shadow-lg shadow-loom-600/30">
            <Workflow size={20} />
          </div>
          <div>
            <div className="text-sm font-bold leading-tight">DOINg.Catalogue</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Data Catalogue</div>
          </div>
        </div>

        {mode === "login" && (
          <form onSubmit={submitLogin}>
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

            {!bootstrapNeeded && (
              <button type="button" onClick={() => { setMode("reset-request"); setErr(null); }}
                className="mt-3 w-full text-center text-xs text-slate-400 hover:text-loom-500">
                Forgot password? Reset admin account
              </button>
            )}
          </form>
        )}

        {mode === "reset-request" && (
          <form onSubmit={submitRequestReset}>
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
              <KeyRound size={15} className="mt-0.5 shrink-0" />
              <span>
                This deletes every existing account and lets you create a fresh admin. A confirmation code
                will be printed to the <strong>backend server's console</strong> (the terminal running
                <code className="mx-1 rounded bg-black/10 px-1 dark:bg-white/10">uvicorn</code>
                / <code className="rounded bg-black/10 px-1 dark:bg-white/10">npm run server</code>) —
                you need access to that machine to complete the reset.
              </span>
            </div>
            {err && <div className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-500">{err}</div>}
            <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
              {busy && <Loader2 size={14} className="animate-spin" />} Send reset code
            </button>
            <button type="button" onClick={backToLogin}
              className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-slate-400 hover:text-loom-500">
              <ArrowLeft size={12} /> Back to sign in
            </button>
          </form>
        )}

        {mode === "reset-confirm" && (
          <form onSubmit={submitConfirmReset}>
            {info && (
              <div className="mb-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
                {info}
              </div>
            )}
            <label className="mb-3 block text-xs font-medium text-slate-500">
              Confirmation code
              <input className="input mt-1 tracking-widest" value={code} onChange={(e) => setCode(e.target.value)}
                required autoFocus placeholder="6-digit code" maxLength={6} />
            </label>
            <label className="mb-3 block text-xs font-medium text-slate-500">
              New admin username
              <input className="input mt-1" value={username} onChange={(e) => setUsername(e.target.value)} required />
            </label>
            <label className="mb-3 block text-xs font-medium text-slate-500">
              New password
              <input type="password" className="input mt-1" value={password}
                onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
            </label>
            <label className="mb-3 block text-xs font-medium text-slate-500">
              Confirm password
              <input type="password" className="input mt-1" value={confirm}
                onChange={(e) => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" />
            </label>

            {err && <div className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-500">{err}</div>}

            <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
              {busy && <Loader2 size={14} className="animate-spin" />} Reset admin account
            </button>
            <button type="button" onClick={backToLogin}
              className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-slate-400 hover:text-loom-500">
              <ArrowLeft size={12} /> Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
