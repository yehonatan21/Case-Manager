import Link from "next/link";
import { getDict } from "@/lib/i18n/server";
import { formatDateTime } from "@/lib/i18n/format";
import { requirePageUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listNotifications } from "@/lib/services/notifications";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { MarkAllRead } from "@/components/app/mark-all-read";
import { PushToggle } from "@/components/app/push-toggle";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.notificationsUi.title };
}

export default async function NotificationsPage() {
  const user = await requirePageUser("/admin/notifications");
  const { d, locale } = await getDict();
  const items = await listNotifications(await getDb(), user, 100);
  return (
    <>
      <PageHeader title={d.notificationsUi.title} actions={items.some((n) => !n.readAt) ? <MarkAllRead /> : null} />
      <PushToggle className="mb-4 rounded-xl border border-slate-200 bg-white p-4" />
      {items.length === 0 ? (
        <EmptyState icon={<Bell className="size-10" />} title={d.notificationsUi.empty} />
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {items.map((n) => (
            <li key={n.id} className={cn(!n.readAt && "bg-brand-50/50")}>
              <Link href={n.link ?? "#"} className="block px-5 py-4 hover:bg-slate-50">
                <p className="bidi-auto font-medium text-slate-900">
                  {!n.readAt && <span className="sr-only">{d.notificationsUi.unread}: </span>}
                  {n.title}
                </p>
                {n.body && <p className="bidi-auto mt-0.5 text-sm text-slate-600">{n.body}</p>}
                <p className="mt-1 text-xs text-slate-500">{formatDateTime(n.createdAt, locale)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
