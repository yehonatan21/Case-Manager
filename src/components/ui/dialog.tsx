"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";

/** Native <dialog> modal: focus trapping, Esc to close and inert background come from the platform. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  const { d } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[min(100%-2rem,32rem)] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/40",
        className,
      )}
    >
      {open && (
        <div>
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label={d.common.close}>
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
