import { notFound, redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getDict } from "@/lib/i18n/server";
import { formatDateTime } from "@/lib/i18n/format";
import { requireStaffPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";

/** Development-only view of the email outbox (EMAIL_PROVIDER=console). */
export default async function MailboxPage() {
  if (!env.devMailbox) notFound();
  const user = await requireStaffPage("/admin/mailbox", "mailbox");
  const { d, locale } = await getDict();
  const rows = await (await getDb()).select().from(notifications).where(eq(notifications.channel, "email")).orderBy(desc(notifications.createdAt)).limit(100);
  return (
    <>
      <PageHeader title={d.email.mailboxTitle} />
      {rows.length === 0 ? (
        <EmptyState title={d.email.mailboxEmpty} />
      ) : (
        <ul className="space-y-2">
          {rows.map((n) => (
            <li key={n.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold" dir="ltr">
                  {n.toEmail}
                </p>
                <div className="flex items-center gap-2">
                  <Badge tone={n.status === "sent" ? "success" : n.status === "failed" ? "danger" : "warning"}>{n.status}</Badge>
                  <span className="text-xs text-slate-500">{formatDateTime(n.createdAt, locale)}</span>
                </div>
              </div>
              <p className="bidi-auto mt-1 font-medium text-slate-900">{n.title}</p>
              <p className="bidi-auto text-sm text-slate-600">{n.body}</p>
              {n.link && <p className="mt-1 font-mono text-xs text-brand-700" dir="ltr">{env.appUrl + n.link}</p>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
