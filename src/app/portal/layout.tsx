import { AccessibilityLink } from "@/components/app/accessibility-link";
import { getDict } from "@/lib/i18n/server";
import { requirePageCustomer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listCustomerCases } from "@/lib/services/cases";
import { unreadCount } from "@/lib/services/notifications";
import { Logo } from "@/components/app/logo";
import { LanguageSwitcher } from "@/components/app/language-switcher";
import { NotificationBell } from "@/components/app/notification-bell";
import { LogoutButton } from "@/components/app/logout-button";
import { RealtimeRefresher } from "@/components/app/realtime";
import { PortalBottomNav, PortalNav } from "@/components/portal/portal-nav";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageCustomer("/portal");
  const { d } = await getDict();
  const db = await getDb();
  const [cases, unread] = await Promise.all([listCustomerCases(db, user), unreadCount(db, user)]);
  const unreadMessages = cases.reduce((n, c) => n + c.unread, 0);
  return (
    <div className="min-h-dvh pb-20 md:pb-0">
      <RealtimeRefresher />
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-4">
            <Logo href="/portal" name={d.common.appName} />
            <PortalNav unreadMessages={unreadMessages} />
          </div>
          <div className="flex items-center gap-1.5">
            <LanguageSwitcher compact />
            <NotificationBell initialUnread={unread} allHref="/portal/notifications" />
            <LogoutButton withLabel={false} className="hidden sm:inline-flex" />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        {children}
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-24 text-center md:pb-6">
        <AccessibilityLink />
      </footer>
      <PortalBottomNav unreadMessages={unreadMessages} />
    </div>
  );
}
