import Link from "next/link";
import { cookies } from "next/headers";
import { AccessibilityLink } from "@/components/app/accessibility-link";
import { getDict } from "@/lib/i18n/server";
import { requirePageStaff } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { unreadCount } from "@/lib/services/notifications";
import { navCounts } from "@/lib/services/nav-counts";
import { env } from "@/lib/env";
import { SIDEBAR_COOKIE } from "@/config/admin-navigation";
import { Logo } from "@/components/app/logo";
import { LanguageSwitcher } from "@/components/app/language-switcher";
import { NotificationBell } from "@/components/app/notification-bell";
import { LogoutButton } from "@/components/app/logout-button";
import { RealtimeRefresher } from "@/components/app/realtime";
import { AdminFrame, AdminMobileMenu } from "@/components/admin/admin-nav";
import { QuickCreate } from "@/components/admin/quick-create";
import { Avatar } from "@/components/ui/misc";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageStaff("/admin", { allowWithoutSecondStep: true });
  const [{ d }, db, jar] = await Promise.all([getDict(), getDb(), cookies()]);
  // The menu's counters and the unread notifications don't depend on each other: load them together.
  const [badges, unread] = await Promise.all([navCounts(db, user), unreadCount(db, user)]);
  const header = <Logo href="/admin" name={d.common.appName} />;
  const footer = (
    <>
      <div className="flex items-center gap-2.5 px-1">
        <Avatar name={user.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800">{user.name}</p>
          <p className="truncate text-xs text-slate-500">{d.roles[user.role]}</p>
          <Link href="/admin/account" className="text-xs font-medium text-brand-700 hover:underline">
            {d.twoFactor.accountTitle}
          </Link>
        </div>
        <LogoutButton withLabel={false} />
      </div>
      <AccessibilityLink className="mt-2 block px-1" />
    </>
  );
  // The collapsed sidebar's footer: the avatar opens My account; signing out stays one click away.
  const compactFooter = (
    <div className="flex flex-col items-center gap-2">
      <Link href="/admin/account" className="rounded-full">
        <span aria-hidden>
          <Avatar name={user.name} />
        </span>
        <span className="sr-only">
          {d.twoFactor.accountTitle}: {user.name}
        </span>
      </Link>
      <LogoutButton withLabel={false} />
    </div>
  );
  const nav = { role: user.role, badges, devMailbox: env.devMailbox };
  return (
    <div className="min-h-dvh">
      <RealtimeRefresher />
      <AdminFrame
        {...nav}
        initialCollapsed={jar.get(SIDEBAR_COOKIE)?.value === "1"}
        header={header}
        compactHeader={<Logo href="/admin" name={d.common.appName} compact />}
        footer={footer}
        compactFooter={compactFooter}
      >
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            <AdminMobileMenu {...nav} header={header} footer={footer} />
            <span className="text-sm font-semibold text-slate-500 lg:hidden">{d.nav.staffArea}</span>
            <span className="hidden text-sm font-medium text-slate-500 lg:inline">{d.nav.staffArea}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <QuickCreate role={user.role} />
            <LanguageSwitcher compact />
            <NotificationBell initialUnread={unread} allHref="/admin/notifications" />
          </div>
        </header>
        <main id="main" className="px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </AdminFrame>
    </div>
  );
}
