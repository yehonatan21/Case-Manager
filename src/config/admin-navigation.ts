/**
 * The staff area's menu, in one place for the desktop sidebar and the mobile drawer: groups, order, who sees each
 * item, and which items carry a counter. Each page still checks access on the server; `roles` here only decides
 * what the menu shows, and matches those checks.
 */
import { BarChart3, CalendarClock, CreditCard, FileText, FolderKanban, History, Inbox, LayoutDashboard, ListChecks, ListTodo, Mail, MessagesSquare, Settings, Users } from "lucide-react";
import type { UserRole } from "@/lib/db/schema";

export type NavGroup = "workspace" | "operations" | "business" | "system";
export const NAV_GROUPS: NavGroup[] = ["workspace", "operations", "business", "system"];

export type NavKey = "dashboard" | "queue" | "inbox" | "quotes" | "cases" | "tasks" | "conversations" | "meetings" | "customers" | "payments" | "reports" | "settings" | "activity" | "mailbox";
export type NavBadge = "inbox" | "queue" | "tasks" | "conversations";

export type NavItem = {
  key: NavKey;
  href: string;
  group: NavGroup;
  icon: React.ComponentType<{ className?: string }>;
  roles: UserRole[];
  /** Active only on this exact path (not on pages below it). */
  exact?: boolean;
  badge?: NavBadge;
  /** Shown only when the development mailbox is on. */
  devOnly?: boolean;
};

const ALL_STAFF: UserRole[] = ["admin", "case_manager", "staff", "finance"];

export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", href: "/admin", group: "workspace", icon: LayoutDashboard, roles: ALL_STAFF, exact: true },
  { key: "queue", href: "/admin/queue", group: "workspace", icon: ListTodo, roles: ["admin", "case_manager", "staff"], badge: "queue" },
  { key: "inbox", href: "/admin/inbox", group: "operations", icon: Inbox, roles: ["admin", "case_manager"], badge: "inbox" },
  { key: "quotes", href: "/admin/quotes", group: "operations", icon: FileText, roles: ["admin", "case_manager", "finance"] },
  { key: "cases", href: "/admin/cases", group: "operations", icon: FolderKanban, roles: ALL_STAFF },
  { key: "tasks", href: "/admin/tasks", group: "operations", icon: ListChecks, roles: ["admin", "case_manager", "staff"], badge: "tasks" },
  { key: "conversations", href: "/admin/conversations", group: "operations", icon: MessagesSquare, roles: ["admin", "case_manager", "staff"], badge: "conversations" },
  { key: "meetings", href: "/admin/meetings", group: "operations", icon: CalendarClock, roles: ["admin", "case_manager", "staff"] },
  { key: "customers", href: "/admin/customers", group: "business", icon: Users, roles: ["admin", "case_manager"] },
  { key: "payments", href: "/admin/payments", group: "business", icon: CreditCard, roles: ["admin", "finance"] },
  { key: "reports", href: "/admin/reports", group: "business", icon: BarChart3, roles: ["admin", "case_manager", "finance"] },
  { key: "settings", href: "/admin/settings", group: "system", icon: Settings, roles: ["admin"] },
  { key: "activity", href: "/admin/activity", group: "system", icon: History, roles: ["admin"] },
  { key: "mailbox", href: "/admin/mailbox", group: "system", icon: Mail, roles: ["admin"], devOnly: true },
];

/** The menu for a role, by group in order; groups with nothing in them are left out. */
export function navForRole(role: UserRole, opts: { devMailbox: boolean }): { group: NavGroup; items: NavItem[] }[] {
  const visible = NAV_ITEMS.filter((i) => i.roles.includes(role) && (!i.devOnly || opts.devMailbox));
  return NAV_GROUPS.map((group) => ({ group, items: visible.filter((i) => i.group === group) })).filter((g) => g.items.length > 0);
}

/** Whether an item is the current page: the dashboard only on itself, others on themselves and their sub-pages. */
export function isActive(item: Pick<NavItem, "href" | "exact">, path: string): boolean {
  if (item.exact) return path === item.href;
  return path === item.href || path.startsWith(`${item.href}/`);
}

/** The sidebar's two widths (px), shared by the sidebar and the page's offset so they always match. */
export const SIDEBAR_WIDTH = { expanded: 256, collapsed: 72 } as const;
export const SIDEBAR_COOKIE = "cm_nav_collapsed";

/**
 * Quick Create ("+ New" in the staff header): the common things to start from anywhere, each opening the form
 * that already exists for it. "pickCase" asks which case first (a task or a client meeting belongs to a case),
 * then opens that case on the right tab with the form ready.
 */
export type QuickCreateKey = "request" | "task" | "meeting" | "event";
export type QuickCreateItem = { key: QuickCreateKey; roles: UserRole[] } & ({ href: string } | { pickCase: { tab: "tasks" | "meetings"; intent: "task" | "meeting" } });

export const QUICK_CREATE: QuickCreateItem[] = [
  { key: "request", roles: ["admin", "case_manager"], href: "/admin/cases/new" },
  { key: "task", roles: ["admin", "case_manager", "staff"], pickCase: { tab: "tasks", intent: "task" } },
  { key: "meeting", roles: ["admin", "case_manager", "staff"], pickCase: { tab: "meetings", intent: "meeting" } },
  { key: "event", roles: ["admin", "case_manager", "staff"], href: "/admin/meetings?new=event" },
];

export const quickCreateFor = (role: UserRole) => QUICK_CREATE.filter((i) => i.roles.includes(role));

/** Where a picked case opens for a Quick Create action. */
export const caseCreateHref = (caseId: string, pick: { tab: string; intent: string }) => `/admin/cases/${caseId}?tab=${pick.tab}&new=${pick.intent}`;
