"use client";

import { RelativeTime } from "@/components/ui/relative-time";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";

type N = { id: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string };

export function NotificationBell({ initialUnread, allHref }: { initialUnread: number; allHref: string }) {
  const { d, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<N[] | null>(null);
  const [unread, setUnread] = useState(initialUnread);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => setUnread(initialUnread), [initialUnread]);

  const load = useCallback(async () => {
    const res = await api<{ items: N[]; unread: number }>("/api/notifications");
    setItems(res.items);
    setUnread(res.unread);
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    // Esc closes the panel and returns focus to the bell (WCAG 2.1.1, 2.4.3).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    // Move focus into the panel when it opens.
    requestAnimationFrame(() => panel.current?.focus());
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, load]);

  const markAll = async () => {
    await api("/api/notifications", { body: {} });
    await load();
    router.refresh();
  };

  return (
    <div className="relative" ref={box}>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex size-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="notifications-panel"
      >
        {/* The name comes from the content ("Notifications 3 unread"), so it always contains the visible badge (WCAG 2.5.3). */}
        <Bell className="size-5" aria-hidden />
        <span className="sr-only">{d.nav.notifications}</span>
        {unread > 0 && (
          <>
            <span className="absolute -top-0.5 -end-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
            <span className="sr-only"> {d.notificationsUi.unreadCount}</span>
          </>
        )}
      </button>
      {open && (
        <div
          ref={panel}
          id="notifications-panel"
          role="dialog"
          aria-label={d.notificationsUi.title}
          tabIndex={-1}
          className="absolute end-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl focus:outline-none"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold">{d.notificationsUi.title}</p>
            {unread > 0 && (
              <button className="text-xs font-medium text-brand-700 hover:underline" onClick={markAll}>
                {d.notificationsUi.markAllRead}
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items === null && <li className="px-4 py-6 text-center text-sm text-slate-500">{d.common.loading}</li>}
            {items?.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">{d.notificationsUi.empty}</li>}
            {items?.map((n) => (
              <li key={n.id} className={cn("border-b border-slate-50 last:border-0", !n.readAt && "bg-brand-50/50")}>
                <Link
                  href={n.link ?? allHref}
                  onClick={() => {
                    setOpen(false);
                    if (!n.readAt) void api("/api/notifications", { body: { ids: [n.id] } }).then(() => router.refresh());
                  }}
                  className="block px-4 py-3 hover:bg-slate-50"
                >
                  <p className="bidi-auto text-sm font-medium text-slate-800">
                    {!n.readAt && <span className="sr-only">{d.notificationsUi.unread}: </span>}
                    {n.title}
                  </p>
                  {n.body && <p className="bidi-auto mt-0.5 line-clamp-2 text-xs text-slate-500">{n.body}</p>}
                  <p className="mt-1 text-[11px] text-slate-500"><RelativeTime value={n.createdAt} /></p>
                </Link>
              </li>
            ))}
          </ul>
          <Link href={allHref} onClick={() => setOpen(false)} className="block border-t border-slate-100 px-4 py-2.5 text-center text-xs font-medium text-brand-700 hover:bg-slate-50">
            {d.notificationsUi.viewAll}
          </Link>
        </div>
      )}
    </div>
  );
}
