"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FileText, FolderKanban, Inbox, Search, SquareArrowOutUpRight, User } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { api } from "@/lib/client-api";
import { Dialog } from "@/components/ui/dialog";
import { fieldBase } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/db/schema";
import { navForRole } from "@/config/admin-navigation";
import type { SearchHit } from "@/lib/services/global-search";

type Kind = SearchHit["kind"] | "page";
type Item = { key: string; kind: Kind; href: string; title: string; ref?: string; context?: string | null; status?: string };
const ORDER: Kind[] = ["page", "request", "case", "customer", "quote"];
const ICONS: Record<Kind, React.ComponentType<{ className?: string }>> = { page: SquareArrowOutUpRight, request: Inbox, case: FolderKanban, customer: User, quote: FileText };

/**
 * Search across the staff area (Ctrl+K, or ⌘K on a Mac): pages from the menu, and cases, incoming requests, clients
 * and quotes from the server — only what the person may see. A combobox: type, move with the arrow keys, Enter
 * opens, Esc closes.
 */
export function CommandSearch({ role, devMailbox }: { role: UserRole; devMailbox: boolean }) {
  const { d } = useI18n();
  const t = d.search;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [active, setActive] = useState(0);
  const [mac, setMac] = useState(false);
  const listId = useId();
  const inputId = useId();
  const seq = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  // The dialog focuses its first button (Close); typing should start in the search field.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);

  // Ctrl+K / ⌘K from anywhere in the staff area.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Records from the server, a moment after typing stops; an older answer never replaces a newer one.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setState("idle");
      return;
    }
    const mine = ++seq.current;
    setState("loading");
    const timer = setTimeout(() => {
      api<{ hits: SearchHit[] }>(`/api/admin/search?q=${encodeURIComponent(term)}`)
        .then((r) => {
          if (mine !== seq.current) return;
          setHits(r.hits);
          setState("done");
        })
        .catch(() => mine === seq.current && setState("error"));
    }, 220);
    return () => clearTimeout(timer);
  }, [q, open]);

  // Pages from the menu (what the role sees), matched by name.
  const pages = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return navForRole(role, { devMailbox })
      .flatMap((g) => g.items)
      .filter((i) => d.nav[i.key].toLowerCase().includes(term))
      .slice(0, 4)
      .map((i) => ({ key: `page-${i.key}`, kind: "page", href: i.href, title: d.nav[i.key] }));
  }, [q, role, devMailbox, d]);

  const items: Item[] = useMemo(() => {
    const records = hits.map((h) => ({ key: `${h.kind}-${h.id}`, kind: h.kind, href: h.href, title: h.title, ref: h.ref, context: h.context, status: "status" in h ? h.status : undefined }));
    return [...pages, ...records].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  }, [pages, hits]);
  useEffect(() => setActive(0), [items.length, q]);

  const close = () => {
    setOpen(false);
    setQ("");
    setHits([]);
    setState("idle");
  };
  const go = (item: Item | undefined) => {
    if (!item) return;
    close();
    router.push(item.href);
  };
  const statusLabel = (it: Item) => {
    if (!it.status) return null;
    if (it.kind === "quote") return d.quoteStatus[it.status as keyof typeof d.quoteStatus];
    return d.status.internal[it.status as keyof typeof d.status.internal];
  };
  const optionId = (i: number) => `${listId}-o${i}`;
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      const n = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      setActive(n);
      document.getElementById(optionId(n))?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(items[active]);
    }
  };

  const term = q.trim();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-600 hover:bg-slate-50 sm:w-56 lg:w-64"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="sr-only sm:not-sr-only sm:flex-1 sm:text-start">{t.button}</span>
        <kbd className="hidden rounded border border-slate-200 bg-slate-50 px-1.5 font-sans text-[11px] text-slate-500 sm:inline" aria-hidden>
          {mac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>
      <Dialog open={open} onClose={close} title={t.title} className="w-[min(100%-2rem,40rem)] self-start sm:mt-[12vh]">
        <label htmlFor={inputId} className="sr-only">
          {t.label}
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" aria-hidden />
          <input
            ref={input}
            id={inputId}
            type="text"
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={items.length ? optionId(active) : undefined}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t.placeholder}
            className={cn(fieldBase, "h-11 ps-9 text-base")}
          />
        </div>
        <div tabIndex={0} role="region" aria-label={t.label} className="mt-3 max-h-[55vh] min-h-24 overflow-y-auto rounded-lg outline-offset-2">
          <p className="sr-only" role="status">
            {state === "loading" ? t.loading : state === "error" ? t.failed : term.length >= 2 ? fmt(t.results, { n: items.length }) : ""}
          </p>
          {items.length > 0 && (
            <ul id={listId} role="listbox" aria-label={t.label} className="space-y-0.5">
              {items.map((it, i) => {
                const Icon = ICONS[it.kind];
                const first = i === 0 || items[i - 1]!.kind !== it.kind;
                const status = statusLabel(it);
                return (
                  <li key={it.key} role="presentation">
                    {first && (
                      <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500" aria-hidden>
                        {t.groups[it.kind]}
                      </p>
                    )}
                    <div
                      id={optionId(i)}
                      role="option"
                      aria-selected={i === active}
                      onMouseMove={() => setActive(i)}
                      onClick={() => go(it)}
                      className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2", i === active ? "bg-brand-50 ring-1 ring-brand-200" : "hover:bg-slate-50")}
                    >
                      <Icon className="size-4 shrink-0 text-slate-500" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="sr-only">{t.groups[it.kind]}: </span>
                        <span className="bidi-auto block truncate text-sm font-medium text-slate-900">{it.title}</span>
                        {(it.ref || it.context) && (
                          <span className="block truncate text-xs text-slate-600">
                            {it.ref && (
                              <span dir="ltr" className={it.kind === "customer" ? undefined : "font-mono"}>
                                {it.ref}
                              </span>
                            )}
                            {it.ref && it.context && " · "}
                            {it.context && <span className="bidi-auto">{it.context}</span>}
                          </span>
                        )}
                      </span>
                      {status && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">{status}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {items.length === 0 && <p className="px-2 py-6 text-center text-sm text-slate-600">{term.length < 2 ? t.hint : state === "loading" ? t.loading : state === "error" ? t.failed : t.none}</p>}
        </div>
        <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500" aria-hidden>
          {t.keys}
        </p>
      </Dialog>
    </>
  );
}
