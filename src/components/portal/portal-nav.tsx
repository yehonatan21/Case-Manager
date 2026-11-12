"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderOpen, Home, MessageSquare, Plus, User } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

function useItems(unreadMessages: number) {
  const { d } = useI18n();
  const path = usePathname();
  const items = [
    { href: "/portal", label: d.nav.home, icon: Home, exact: true },
    { href: "/portal/cases", label: d.nav.myCases, icon: FolderOpen },
    { href: "/portal/new", label: d.nav.newRequest, icon: Plus, primary: true },
    { href: "/portal/messages", label: d.nav.messages, icon: MessageSquare, badge: unreadMessages },
    { href: "/portal/profile", label: d.nav.profile, icon: User },
  ];
  const active = (href: string, exact?: boolean) => (exact ? path === href : path.startsWith(href));
  return { d, items, active };
}

export function PortalNav({ unreadMessages }: { unreadMessages: number }) {
  const { d, items, active } = useItems(unreadMessages);
  return (
    <nav aria-label={d.nav.mainMenu} className="hidden items-center gap-1 md:flex">
        {items.map((it) =>
          it.primary ? (
            <Link key={it.href} href={it.href} className="ms-2 inline-flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong">
              <it.icon className="size-4" aria-hidden />
              {it.label}
            </Link>
          ) : (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active(it.href, it.exact) ? "page" : undefined}
              className={cn(
                "relative inline-flex h-9 items-center rounded-full px-3.5 text-sm font-medium",
                active(it.href, it.exact) ? "bg-brand-100/70 text-brand-800 dark:bg-brand-100" : "text-slate-600 hover:bg-slate-900/5",
              )}
            >
              {it.label}
              {!!it.badge && <span className="ms-1.5 rounded-full bg-danger px-1.5 text-[0.625rem] font-bold text-white">{it.badge}</span>}
            </Link>
          ),
        )}
    </nav>
  );
}

/**
 * The phone's tab bar: four sections, floating glass above the content (tab-bars.md: tabs navigate, they don't act,
 * so "New request" is a button in the top bar instead). The current tab is filled with the accent.
 */
export function PortalBottomNav({ unreadMessages }: { unreadMessages: number }) {
  const { d, items, active } = useItems(unreadMessages);
  return (
    <nav aria-label={d.nav.bottomMenu} className="glass hairline-t fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="grid grid-cols-4">
        {items
          .filter((it) => !it.primary)
          .map((it) => {
            const on = active(it.href, it.exact);
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  aria-current={on ? "page" : undefined}
                  className={cn("relative flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 text-[0.6875rem] font-medium", on ? "text-brand-700" : "text-slate-500")}
                >
                  <it.icon className="size-6" strokeWidth={on ? 2.4 : 1.8} aria-hidden />
                  <span className="max-w-full truncate px-1">{it.label}</span>
                  {!!it.badge && (
                    <span className="absolute top-1 start-1/2 ms-2.5 min-w-[1.125rem] rounded-full bg-danger px-1 text-center text-[0.625rem] font-bold leading-[1.125rem] text-white">{it.badge}</span>
                  )}
                </Link>
              </li>
            );
          })}
      </ul>
    </nav>
  );
}

/** "New request" in the phone's top bar: an action, so it lives with the other toolbar buttons. */
export function PortalNewRequestButton() {
  const { d } = useI18n();
  return (
    <Link href="/portal/new" className="inline-flex size-11 items-center justify-center rounded-full bg-accent text-white hover:bg-accent-strong md:hidden">
      <Plus className="size-5" aria-hidden />
      <span className="sr-only">{d.nav.newRequest}</span>
    </Link>
  );
}
