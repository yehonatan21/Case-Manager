"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BarChart3, ListTodo, MessagesSquare, CalendarClock, CreditCard, FileText, FolderKanban, Inbox, LayoutDashboard, ListChecks, Mail, Menu, Settings, Users, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/db/schema";

type Item = { href: string; key: "dashboard" | "queue" | "conversations" | "inbox" | "cases" | "quotes" | "tasks" | "meetings" | "customers" | "payments" | "reports" | "settings" | "mailbox"; icon: React.ComponentType<{ className?: string }>; roles: UserRole[]; exact?: boolean };

const ITEMS: Item[] = [
  { href: "/admin", key: "dashboard", icon: LayoutDashboard, roles: ["admin", "case_manager", "staff", "finance"], exact: true },
  { href: "/admin/queue", key: "queue", icon: ListTodo, roles: ["admin", "case_manager", "staff"] },
  { href: "/admin/conversations", key: "conversations", icon: MessagesSquare, roles: ["admin", "case_manager", "staff"] },
  { href: "/admin/inbox", key: "inbox", icon: Inbox, roles: ["admin", "case_manager"] },
  { href: "/admin/cases", key: "cases", icon: FolderKanban, roles: ["admin", "case_manager", "staff", "finance"] },
  { href: "/admin/quotes", key: "quotes", icon: FileText, roles: ["admin", "case_manager", "finance"] },
  { href: "/admin/tasks", key: "tasks", icon: ListChecks, roles: ["admin", "case_manager", "staff"] },
  { href: "/admin/meetings", key: "meetings", icon: CalendarClock, roles: ["admin", "case_manager", "staff"] },
  { href: "/admin/customers", key: "customers", icon: Users, roles: ["admin", "case_manager"] },
  { href: "/admin/payments", key: "payments", icon: CreditCard, roles: ["admin", "finance"] },
  { href: "/admin/reports", key: "reports", icon: BarChart3, roles: ["admin", "case_manager", "finance"] },
  { href: "/admin/settings", key: "settings", icon: Settings, roles: ["admin"] },
  { href: "/admin/mailbox", key: "mailbox", icon: Mail, roles: ["admin"] },
];

function NavList({ role, inboxCount, devMailbox, onNavigate }: { role: UserRole; inboxCount: number; devMailbox: boolean; onNavigate?: () => void }) {
  const { d } = useI18n();
  const path = usePathname();
  return (
    <ul className="space-y-0.5">
      {ITEMS.filter((i) => i.roles.includes(role) && (i.key !== "mailbox" || devMailbox)).map((it) => {
        const active = it.exact ? path === it.href : path.startsWith(it.href);
        return (
          <li key={it.href}>
            <Link
              href={it.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-brand-700 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <it.icon className="size-4.5 shrink-0" aria-hidden />
              <span className="flex-1">{d.nav[it.key]}</span>
              {it.key === "inbox" && inboxCount > 0 && (
                <span className={cn("rounded-full px-1.5 text-[11px] font-bold", active ? "bg-white/20 text-white" : "bg-brand-100 text-brand-800")}>{inboxCount}</span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AdminSidebar(props: { role: UserRole; inboxCount: number; devMailbox: boolean; header: React.ReactNode; footer: React.ReactNode }) {
  const { d } = useI18n();
  return (
    <aside className="fixed inset-y-0 start-0 z-30 hidden w-60 flex-col border-e border-slate-200 bg-white lg:flex">
      <div className="flex h-16 items-center px-5">{props.header}</div>
      <nav aria-label={d.nav.staffMenu} className="flex-1 overflow-y-auto px-3 py-2">
        <NavList {...props} />
      </nav>
      <div className="border-t border-slate-100 p-3">{props.footer}</div>
    </aside>
  );
}

export function AdminMobileMenu(props: { role: UserRole; inboxCount: number; devMailbox: boolean; header: React.ReactNode; footer: React.ReactNode }) {
  const { d } = useI18n();
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => setOpen(false), [path]);
  // A native modal <dialog>: the browser moves focus into it, keeps Tab inside, makes the page behind inert,
  // closes it on Esc and returns focus to the menu button.
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);
  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex size-9 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
        aria-label={d.nav.menu}
        aria-expanded={open}
        aria-controls="admin-mobile-menu"
        aria-haspopup="dialog"
      >
        <Menu className="size-5" aria-hidden />
      </button>
      <dialog
        ref={ref}
        id="admin-mobile-menu"
        aria-label={d.nav.menu}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === ref.current) setOpen(false); // click on the backdrop
        }}
        className="fixed inset-y-0 start-0 m-0 h-dvh max-h-none w-72 max-w-[85vw] bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
      >
        {open && (
          <div className="flex h-full flex-col">
            <div className="flex h-16 items-center justify-between px-4">
              {props.header}
              <button onClick={() => setOpen(false)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label={d.common.close}>
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <nav aria-label={d.nav.staffMenu} className="flex-1 overflow-y-auto px-3 py-2">
              <NavList {...props} onNavigate={() => setOpen(false)} />
            </nav>
            <div className="border-t border-slate-100 p-3">{props.footer}</div>
          </div>
        )}
      </dialog>
    </div>
  );
}
