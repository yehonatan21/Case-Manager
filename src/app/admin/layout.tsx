import { AccessibilityLink } from "@/components/app/accessibility-link";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDict } from "@/lib/i18n/server";
import { requirePageStaff } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { cases } from "@/lib/db/schema";
import { unreadCount } from "@/lib/services/notifications";
import { staffCaseScope } from "@/lib/services/cases";
import { OPEN_STATUSES } from "@/lib/domain";
import { env } from "@/lib/env";
import { Logo } from "@/components/app/logo";
import { LanguageSwitcher } from "@/components/app/language-switcher";
import { NotificationBell } from "@/components/app/notification-bell";
import { LogoutButton } from "@/components/app/logout-button";
import { RealtimeRefresher } from "@/components/app/realtime";
import { AdminMobileMenu, AdminSidebar } from "@/components/admin/admin-nav";
import { Avatar } from "@/components/ui/misc";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageStaff("/admin");
  const { d } = await getDict();
  const db = await getDb();
  const [{ n: inboxCount } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cases)
    .where(and(staffCaseScope(user), or(eq(cases.status, "submitted"), and(isNull(cases.assigneeId), inArray(cases.status, OPEN_STATUSES)))));
  const unread = await unreadCount(db, user);
  const header = <Logo href="/admin" name={d.common.appName} />;
  const footer = (
    <div className="flex items-center gap-2.5 px-1">
      <Avatar name={user.name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800">{user.name}</p>
        <p className="truncate text-xs text-slate-500">{d.roles[user.role]}</p>
      </div>
      <LogoutButton withLabel={false} />
    </div>
  );
  const sidebarFooter = (
    <>
      {footer}
      <AccessibilityLink className="mt-2 block px-1" />
    </>
  );
  const navProps = { role: user.role, inboxCount: user.role === "admin" || user.role === "case_manager" ? inboxCount : 0, devMailbox: env.devMailbox, header, footer: sidebarFooter };
  return (
    <div className="min-h-dvh">
      <RealtimeRefresher />
      <AdminSidebar {...navProps} />
      <div className="lg:ps-60">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            <AdminMobileMenu {...navProps} />
            <span className="text-sm font-semibold text-slate-500 lg:hidden">{d.nav.staffArea}</span>
            <span className="hidden text-sm font-medium text-slate-500 lg:inline">{d.nav.staffArea}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <LanguageSwitcher compact />
            <NotificationBell initialUnread={unread} allHref="/admin/notifications" />
          </div>
        </header>
        <main id="main" className="px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
