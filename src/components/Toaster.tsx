import { CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { useCatalog } from "../store";

export function Toaster() {
  const { toasts } = useCatalog();
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col gap-2">
      {toasts.map((t) => {
        const Icon = t.kind === "ok" ? CheckCircle2 : t.kind === "err" ? AlertTriangle : Info;
        const color =
          t.kind === "ok" ? "text-emerald-500" : t.kind === "err" ? "text-rose-500" : "text-loom-500";
        return (
          <div key={t.id}
            className="pointer-events-auto flex w-80 animate-fade-in items-start gap-2.5 rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <Icon size={18} className={`mt-0.5 shrink-0 ${color}`} />
            <span className="text-sm text-slate-700 dark:text-slate-200">{t.text}</span>
          </div>
        );
      })}
    </div>
  );
}
