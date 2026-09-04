import { useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, Workflow, Microscope, UserCog, ShieldAlert, Database, Info } from "lucide-react";
import { useCatalog } from "../store";
import { timeAgo } from "../lib/ui";
import type { Notification } from "../types";
import type { Tab } from "../App";

const KIND_DOT: Record<string, string> = {
  info: "bg-slate-400", success: "bg-emerald-500", warning: "bg-amber-500", error: "bg-rose-500",
};

const CATEGORY_ICON: Record<string, typeof Bell> = {
  run: Workflow, quality: Microscope, user_mgmt: UserCog, security: ShieldAlert, connection: Database,
};

export function NotificationBell({ goto }: { goto: (t: Tab) => void }) {
  const { notifications, unreadCount, markNotificationRead, markAllNotificationsRead } = useCatalog();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const click = (n: Notification) => {
    if (!n.read) markNotificationRead(n.id);
    if (n.link?.tab) goto(n.link.tab as Tab);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} className="btn-ghost relative !p-1.5" title="Notifications">
        <Bell size={15} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 max-h-[70vh] w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-800">
            <span className="text-xs font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <button onClick={markAllNotificationsRead} className="flex items-center gap-1 text-[11px] text-loom-500 hover:underline">
                <CheckCheck size={12} /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">Nothing yet — you're all caught up.</div>
            ) : notifications.map((n) => {
              const Icon = CATEGORY_ICON[n.category] || Info;
              return (
                <button key={n.id} onClick={() => click(n)}
                  className={`flex w-full items-start gap-2.5 border-b border-slate-100 px-3 py-2.5 text-left last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40 ${
                    n.read ? "opacity-60" : ""}`}>
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${KIND_DOT[n.kind] || KIND_DOT.info}`} />
                  <Icon size={14} className="mt-0.5 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium">{n.title}</div>
                    <div className="truncate text-[11px] text-slate-500">{n.message}</div>
                    <div className="mt-0.5 text-[10px] text-slate-400">{timeAgo(n.created_at)} ago</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
