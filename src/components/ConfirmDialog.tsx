import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, ShieldAlert, Info, X } from "lucide-react";

export type ConfirmTone = "info" | "warning" | "danger";

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  tone?: ConfirmTone;
  /** How many explicit clicks are required before onConfirm fires. Escalates the copy each step. */
  steps?: 1 | 2 | 3;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const TONE_STYLE: Record<ConfirmTone, { icon: typeof Info; className: string; btn: string }> = {
  info: { icon: Info, className: "text-loom-500 bg-loom-500/10", btn: "btn-primary" },
  warning: { icon: AlertTriangle, className: "text-amber-500 bg-amber-500/10", btn: "btn-primary !bg-amber-600 hover:!bg-amber-700 shadow-amber-600/30" },
  danger: { icon: ShieldAlert, className: "text-rose-500 bg-rose-500/10", btn: "btn-primary !bg-rose-600 hover:!bg-rose-700 shadow-rose-600/30" },
};

const STEP_COPY = [
  null,
  { suffix: "", label: null as string | null },
  { suffix: " Are you sure? This can't be undone automatically.", label: "Yes, I'm sure" },
  { suffix: " This will permanently overwrite information — please confirm one more time.", label: "Yes, overwrite" },
];

export function ConfirmDialog({
  open, title, message, tone = "warning", steps = 1,
  confirmLabel = "Continue", cancelLabel = "Cancel", onConfirm, onCancel,
}: ConfirmDialogProps) {
  const [step, setStep] = useState(1);
  if (!open) return null;

  const { icon: Icon, className, btn } = TONE_STYLE[tone];
  const stepInfo = STEP_COPY[step];
  const isFinal = step >= steps;
  const label = (stepInfo?.label) || (isFinal ? confirmLabel : "Continue");

  const advance = () => {
    if (isFinal) { setStep(1); onConfirm(); }
    else setStep((s) => s + 1);
  };
  const cancel = () => { setStep(1); onCancel(); };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={cancel}>
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start gap-3">
          <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${className}`}>
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">{title}</h3>
            {steps > 1 && <div className="text-[10px] uppercase tracking-wide text-slate-400">Step {step} of {steps}</div>}
          </div>
          <button onClick={cancel} className="btn-ghost !p-1"><X size={15} /></button>
        </div>
        <div className="mb-4 text-sm text-slate-600 dark:text-slate-300">
          {message}
          {stepInfo?.suffix && <p className="mt-2 font-medium text-slate-700 dark:text-slate-200">{stepInfo.suffix}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={cancel} className="btn-outline">{cancelLabel}</button>
          <button onClick={advance} className={btn}>{label}</button>
        </div>
      </div>
    </div>
  );
}

/** Imperative confirm() -> Promise<boolean>, plus the <dialog/> JSX to render once in the tree. */
export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOpts(o);
    });
  }, []);

  const settle = useCallback((v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  }, []);

  const dialog = opts ? (
    <ConfirmDialog open {...opts} onConfirm={() => settle(true)} onCancel={() => settle(false)} />
  ) : null;

  return { confirm, dialog };
}
