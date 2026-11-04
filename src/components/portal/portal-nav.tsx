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
            <Link key={it.href} href={it.href} className="ms-2 inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-700 px-3 text-sm font-medium text-white hover:bg-brand-800">
              <it.icon className="size-4" aria-hidden />
              {it.label}
            </Link>
          ) : (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active(it.href, it.exact) ? "page" : undefined}
              className={cn(
                "relative inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium",
                active(it.href, it.exact) ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              {it.label}
              {!!it.badge && <span className="ms-1.5 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{it.badge}</span>}
            </Link>
          ),
        )}
    </nav>
  );
}

/** Compact bottom navigation on mobile, with a prominent "new request" button. Rendered outside the blurred header. */
export function PortalBottomNav({ unreadMessages }: { unreadMessages: number }) {
  const { d, items, active } = useItems(unreadMessages);
  return (
      <nav aria-label={d.nav.bottomMenu} className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="grid grid-cols-5">
          {items.map((it) => (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active(it.href, it.exact) ? "page" : undefined}
                className={cn("relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active(it.href, it.exact) ? "text-brand-700" : "text-slate-500")}
              >
                {it.primary ? (
                  <span className="-mt-5 flex size-11 items-center justify-center rounded-full bg-brand-700 text-white shadow-lg ring-4 ring-white">
                    <it.icon className="size-5" aria-hidden />
                  </span>
                ) : (
                  <it.icon className="size-5" aria-hidden />
                )}
                <span className="max-w-full truncate px-1">{it.label}</span>
                {!!it.badge && <span className="absolute top-1 start-1/2 ms-2 rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">{it.badge}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
  );
}
