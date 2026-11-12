"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { CalendarClock, CalendarPlus, FilePlus2, ListPlus, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { api } from "@/lib/client-api";
import { Dialog } from "@/components/ui/dialog";
import { fieldBase } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/db/schema";
import { caseCreateHref, quickCreateFor, type QuickCreateItem, type QuickCreateKey } from "@/config/admin-navigation";

const ICONS: Record<QuickCreateKey, React.ComponentType<{ className?: string }>> = { request: FilePlus2, task: ListPlus, meeting: CalendarClock, event: CalendarPlus };

type Pick = Extract<QuickCreateItem, { pickCase: unknown }>["pickCase"];
type Found = { id: string; number: string; title: string; customerName: string };

/**
 * "+ New" in the staff header: a short list of the things to start from anywhere, only those the role may do.
 * Links go to the existing forms; a task or a client meeting first asks which case. The list closes on Esc,
 * on a click outside it, and after a choice; the arrow keys move between its items.
 */
export function QuickCreate({ role }: { role: UserRole }) {
  const { d } = useI18n();
  const t = d.quickCreate;
  const items = quickCreateFor(role);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<Pick | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    // Focus the first choice, as a menu opened from the keyboard would.
    wrap.current?.querySelector<HTMLElement>("[data-qc-item]")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  const onListKey = (e: React.KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const all = [...(wrap.current?.querySelectorAll<HTMLElement>("[data-qc-item]") ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    const n = e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length;
    e.preventDefault();
    all[n]?.focus();
  };

  const itemClass = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-start text-sm font-medium text-slate-700 outline-offset-[-2px] hover:bg-slate-100 focus-visible:bg-slate-100";

  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={listId}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-sm font-medium text-white hover:bg-accent-strong sm:px-3"
      >
        <Plus className="size-4" aria-hidden />
        <span className="sr-only sm:not-sr-only">{t.button}</span>
        <span className="sr-only">: {t.label}</span>
      </button>
      {open && (
        <div id={listId} className="absolute end-0 top-full z-40 mt-2 w-60 rounded-card bg-card shadow-card p-1.5 shadow-xl" onKeyDown={onListKey}>
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500" aria-hidden>
            {t.label}
          </p>
          <ul aria-label={t.label}>
            {items.map((it) => {
              const Icon = ICONS[it.key];
              const body = (
                <>
                  <Icon className="size-4.5 shrink-0 text-slate-500" aria-hidden />
                  {t.items[it.key]}
                </>
              );
              return (
                <li key={it.key}>
                  {"href" in it ? (
                    <Link href={it.href} data-qc-item className={itemClass} onClick={() => setOpen(false)}>
                      {body}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      data-qc-item
                      className={itemClass}
                      aria-haspopup="dialog"
                      onClick={() => {
                        setOpen(false);
                        setPick(it.pickCase);
                      }}
                    >
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <CasePicker pick={pick} onClose={() => setPick(null)} />
    </div>
  );
}

/** Which case? A search over the open cases the user may work on; choosing one opens it with the form ready. */
function CasePicker({ pick, onClose }: { pick: Pick | null; onClose: () => void }) {
  const { d } = useI18n();
  const t = d.quickCreate;
  const router = useRouter();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [failed, setFailed] = useState(false);
  const inputId = useId();

  useEffect(() => {
    if (!pick) return;
    let live = true;
    const timer = setTimeout(
      () => {
        api<{ cases: Found[] }>(`/api/admin/cases?q=${encodeURIComponent(q.trim())}`)
          .then((r) => live && (setFound(r.cases), setFailed(false)))
          .catch(() => live && setFailed(true));
      },
      q ? 250 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, pick]);

  const close = () => {
    setQ("");
    setFound(null);
    onClose();
  };

  return (
    <Dialog open={!!pick} onClose={close} title={pick?.intent === "meeting" ? t.pickForMeeting : t.pickForTask}>
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-slate-700">
        {t.search}
      </label>
      <input id={inputId} type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.searchHint} className={cn(fieldBase, "h-10")} />
      <div className="mt-3 min-h-24" aria-live="polite">
        {failed ? (
          <p className="text-sm text-red-700">{t.failed}</p>
        ) : found === null ? (
          <p className="text-sm text-slate-500">{d.common.loading}</p>
        ) : found.length === 0 ? (
          <p className="text-sm text-slate-600">{t.noCases}</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {found.map((c) => {
              const href = caseCreateHref(c.id, pick!);
              return (
                <li key={c.id}>
                  <Link
                    href={href}
                    onClick={(e) => {
                      e.preventDefault();
                      close();
                      router.push(href);
                    }}
                    className="block px-3 py-2.5 hover:bg-slate-50 focus-visible:bg-slate-50"
                  >
                    <span className="block text-sm font-medium text-slate-900">
                      <span className="font-mono text-xs text-slate-600" dir="ltr">
                        {c.number}
                      </span>{" "}
                      · <span className="bidi-auto">{c.title}</span>
                    </span>
                    <span className="bidi-auto block text-xs text-slate-600">{c.customerName}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
