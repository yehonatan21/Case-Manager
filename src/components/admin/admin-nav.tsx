"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronsLeft, Menu, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/db/schema";
import { isActive, navForRole, SIDEBAR_COOKIE, SIDEBAR_WIDTH, type NavBadge, type NavItem } from "@/config/admin-navigation";

type NavProps = { role: UserRole; badges: Partial<Record<NavBadge, number>>; devMailbox: boolean };

/** A collapsed item's name, shown beside it on hover or keyboard focus (the sidebar clips anything outside it). */
type Tip = { label: string; top: number } | null;

function NavLinks({ role, badges, devMailbox, collapsed = false, onNavigate, onTip }: NavProps & { collapsed?: boolean; onNavigate?: () => void; onTip?: (t: Tip) => void }) {
  const { d } = useI18n();
  const path = usePathname();
  const groups = navForRole(role, { devMailbox });
  const show = (e: React.SyntheticEvent<HTMLElement>, label: string) => {
    if (!collapsed || !onTip) return;
    const r = e.currentTarget.getBoundingClientRect();
    onTip({ label, top: r.top + r.height / 2 });
  };
  return (
    <div className="space-y-4">
      {groups.map(({ group, items }, gi) => (
        <div key={group}>
          {collapsed ? (
            gi > 0 && <div aria-hidden className="mx-3 mb-3 border-t border-slate-200" />
          ) : (
            <p id={`nav-group-${group}`} className="mb-1 px-3 text-xs font-semibold text-slate-500">
              {d.navGroups[group]}
            </p>
          )}
          <ul className="space-y-1" {...(collapsed ? { "aria-label": d.navGroups[group] } : { "aria-labelledby": `nav-group-${group}` })}>
            {items.map((it) => (
              <NavLink key={it.key} item={it} label={d.nav[it.key]} count={it.badge ? (badges[it.badge] ?? 0) : 0} countLabel={it.badge ? d.navBadges[it.badge] : ""} active={isActive(it, path)} collapsed={collapsed} onNavigate={onNavigate} onShow={show} onHide={() => onTip?.(null)} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function NavLink({ item, label, count, countLabel, active, collapsed, onNavigate, onShow, onHide }: { item: NavItem; label: string; count: number; countLabel: string; active: boolean; collapsed: boolean; onNavigate?: () => void; onShow: (e: React.SyntheticEvent<HTMLElement>, label: string) => void; onHide: () => void }) {
  const Icon = item.icon;
  // The number alone means little to a screen reader ("Tasks 3"), so it is read as what it counts ("3 overdue").
  const what = count > 0 ? fmt(countLabel, { n: count }) : "";
  const tip = what ? `${label} · ${what}` : label;
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        onMouseEnter={(e) => onShow(e, tip)}
        onFocus={(e) => onShow(e, tip)}
        onMouseLeave={onHide}
        onBlur={onHide}
        className={cn(
          "relative flex h-10 items-center rounded-xl text-sm font-medium outline-offset-2 transition-colors",
          collapsed ? "justify-center px-0" : "gap-3 px-3",
          active ? "bg-brand-100/70 text-brand-800 dark:bg-brand-100" : "text-slate-700 hover:bg-slate-900/5 hover:text-slate-900",
        )}
      >
        <Icon className="size-5 shrink-0" aria-hidden />
        <span className={collapsed ? "sr-only" : "flex-1 truncate"}>{label}</span>
        {count > 0 &&
          (collapsed ? (
            <span aria-hidden className={cn("absolute end-1 top-1 min-w-4 rounded-full px-1 text-center text-[10px] font-bold leading-4", "bg-slate-800 text-card")}>
              {count > 99 ? "99+" : count}
            </span>
          ) : (
            <span aria-hidden className={cn("rounded-full px-1.5 text-[11px] font-bold", "bg-slate-200 text-slate-800")}>
              {count > 99 ? "99+" : count}
            </span>
          ))}
        {what && <span className="sr-only">, {what}</span>}
      </Link>
    </li>
  );
}

/**
 * The staff area's frame on large screens: the sidebar (expanded or collapsed, remembered in a cookie so the first
 * render is already right) and the page beside it, offset by the same width.
 */
export function AdminFrame(props: NavProps & { initialCollapsed: boolean; header: React.ReactNode; compactHeader: React.ReactNode; footer: React.ReactNode; compactFooter: React.ReactNode; children: React.ReactNode }) {
  const { d } = useI18n();
  const [collapsed, setCollapsed] = useState(props.initialCollapsed);
  const [tip, setTip] = useState<Tip>(null);
  const width = collapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded;
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    setTip(null);
    try {
      document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
    } catch {}
  };
  return (
    <div style={{ "--nav-w": `${width}px` } as React.CSSProperties}>
      <aside
        className="glass fixed inset-y-0 start-0 z-30 hidden w-(--nav-w) flex-col border-e border-slate-900/10 motion-safe:transition-[width] motion-safe:duration-200 lg:flex"
        data-collapsed={collapsed ? "true" : "false"}
      >
        <div className={cn("flex h-16 shrink-0 items-center", collapsed ? "justify-center" : "px-5")}>{collapsed ? props.compactHeader : props.header}</div>
        <nav id="admin-sidebar-nav" aria-label={d.nav.staffMenu} className={cn("flex-1 overflow-y-auto py-2", collapsed ? "px-3" : "px-3")} onScroll={() => setTip(null)}>
          <NavLinks role={props.role} badges={props.badges} devMailbox={props.devMailbox} collapsed={collapsed} onTip={setTip} />
        </nav>
        <div className="shrink-0 border-t border-slate-100 p-3">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-controls="admin-sidebar-nav"
            className={cn("mb-2 flex h-9 w-full items-center gap-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900", collapsed ? "justify-center" : "px-3")}
          >
            <ChevronsLeft className={cn("size-4.5 shrink-0 motion-safe:transition-transform", collapsed ? "ltr:rotate-180" : "rtl:rotate-180")} aria-hidden />
            <span className={collapsed ? "sr-only" : ""}>{collapsed ? d.nav.expand : d.nav.collapse}</span>
          </button>
          {collapsed ? props.compactFooter : props.footer}
        </div>
      </aside>
      {collapsed && tip && (
        <div
          role="presentation"
          aria-hidden
          className="pointer-events-none fixed z-40 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-inverse px-2.5 py-1 text-xs font-medium text-white shadow-lg lg:block"
          style={{ top: tip.top, insetInlineStart: SIDEBAR_WIDTH.collapsed + 6 }}
        >
          {tip.label}
        </div>
      )}
      <div className="motion-safe:transition-[padding] motion-safe:duration-200 lg:ps-(--nav-w)">{props.children}</div>
    </div>
  );
}

/** The menu on small screens: a native modal dialog from the start edge (the right in Hebrew). */
export function AdminMobileMenu(props: NavProps & { header: React.ReactNode; footer: React.ReactNode }) {
  const { d } = useI18n();
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => setOpen(false), [path]);
  // A native modal <dialog>: the browser moves focus into it, keeps Tab inside, makes the page behind inert,
  // closes it on Esc and returns focus to the menu button. The page behind doesn't scroll while it's open.
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
    document.documentElement.style.overflow = open ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [open]);
  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex size-10 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
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
        className="fixed inset-y-0 start-0 m-0 h-dvh max-h-none w-72 max-w-[85vw] bg-card p-0 shadow-xl backdrop:bg-black/40"
      >
        {open && (
          <div className="flex h-full flex-col">
            <div className="flex h-16 items-center justify-between px-4">
              {props.header}
              <button onClick={() => setOpen(false)} className="inline-flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label={d.common.close}>
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <nav aria-label={d.nav.staffMenu} className="flex-1 overflow-y-auto px-3 py-2">
              <NavLinks role={props.role} badges={props.badges} devMailbox={props.devMailbox} onNavigate={() => setOpen(false)} />
            </nav>
            <div className="border-t border-slate-100 p-3">{props.footer}</div>
          </div>
        )}
      </dialog>
    </div>
  );
}
