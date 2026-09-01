import { useEffect, useState } from "react";
import { KeyRound, Loader2, Plus, ShieldCheck, Trash2, UserX, UserCheck, Users as UsersIcon } from "lucide-react";
import { api } from "../../api";
import { useCatalog } from "../../store";
import { useAuth } from "../../auth";
import { timeAgo } from "../../lib/ui";
import type { User } from "../../types";

export function Users() {
  const { toast } = useCatalog();
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [busy, setBusy] = useState(false);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState("");

  const load = async () => {
    setLoading(true);
    try { setUsers((await api.listUsers()).users); }
    catch (e) { toast("err", (e as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.createUser({ username: username.trim(), password, role });
      setUsername(""); setPassword(""); setRole("member"); setShowNew(false);
      toast("ok", "User created");
      await load();
    } catch (e) { toast("err", (e as Error).message); }
    finally { setBusy(false); }
  };

  const toggleActive = async (u: User) => {
    try { await api.updateUser(u.id, { active: !u.active }); await load(); }
    catch (e) { toast("err", (e as Error).message); }
  };

  const changeRole = async (u: User, role: "admin" | "member") => {
    try { await api.updateUser(u.id, { role }); await load(); }
    catch (e) { toast("err", (e as Error).message); }
  };

  const remove = async (u: User) => {
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    try { await api.deleteUser(u.id); await load(); toast("ok", "User deleted"); }
    catch (e) { toast("err", (e as Error).message); }
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetFor) return;
    try {
      await api.updateUser(resetFor, { password: resetPw });
      toast("ok", "Password updated");
      setResetFor(null); setResetPw("");
    } catch (e) { toast("err", (e as Error).message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <UsersIcon size={16} className="text-loom-500" /> Users
        </div>
        <button className="btn-primary text-xs" onClick={() => setShowNew((v) => !v)}>
          <Plus size={13} /> New user
        </button>
      </div>

      {showNew && (
        <form onSubmit={createUser} className="card flex flex-wrap items-end gap-3 p-4">
          <label className="text-xs font-medium text-slate-500">
            Username
            <input className="input mt-1 w-40" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label className="text-xs font-medium text-slate-500">
            Password
            <input type="password" className="input mt-1 w-40" value={password}
              onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </label>
          <label className="text-xs font-medium text-slate-500">
            Role
            <select className="input mt-1 w-32" value={role} onChange={(e) => setRole(e.target.value as "admin" | "member")}>
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button type="submit" disabled={busy} className="btn-primary text-xs">
            {busy && <Loader2 size={13} className="animate-spin" />} Create
          </button>
        </form>
      )}

      {resetFor && (
        <form onSubmit={submitReset} className="card flex items-end gap-3 p-4">
          <label className="text-xs font-medium text-slate-500">
            New password for this user
            <input type="password" className="input mt-1 w-56" value={resetPw}
              onChange={(e) => setResetPw(e.target.value)} required minLength={8} autoFocus />
          </label>
          <button type="submit" className="btn-primary text-xs">Save</button>
          <button type="button" className="btn-ghost text-xs" onClick={() => { setResetFor(null); setResetPw(""); }}>Cancel</button>
        </form>
      )}

      {loading ? (
        <div className="card p-6 text-sm text-slate-400">Loading…</div>
      ) : (
        <div className="card divide-y divide-slate-100 dark:divide-slate-800/60">
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                u.role === "admin" ? "bg-loom-500/15 text-loom-500" : "bg-slate-200 text-slate-500 dark:bg-slate-800"}`}>
                {u.username.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{u.username}</span>
                  {u.role === "admin" && (
                    <span className="chip bg-loom-500/10 text-loom-500"><ShieldCheck size={11} /> admin</span>
                  )}
                  {!u.active && <span className="chip bg-slate-200 text-slate-500 dark:bg-slate-800">deactivated</span>}
                  {u.id === me?.id && <span className="chip bg-slate-200 text-slate-500 dark:bg-slate-800">you</span>}
                </div>
                <div className="text-xs text-slate-400">Created {timeAgo(u.created_at)} ago</div>
              </div>
              <select className="input w-28 !py-1 text-xs" value={u.role} disabled={u.id === me?.id}
                onChange={(e) => changeRole(u, e.target.value as "admin" | "member")}>
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
              <button className="btn-ghost !p-1.5 text-xs" title="Reset password"
                onClick={() => { setResetFor(u.id); setResetPw(""); }}>
                <KeyRound size={14} />
              </button>
              <button className="btn-ghost !p-1.5 text-xs" disabled={u.id === me?.id}
                title={u.active ? "Deactivate" : "Reactivate"} onClick={() => toggleActive(u)}>
                {u.active ? <UserX size={14} /> : <UserCheck size={14} />}
              </button>
              <button className="btn-ghost !p-1.5 text-xs text-rose-500" disabled={u.id === me?.id}
                title="Delete" onClick={() => remove(u)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
