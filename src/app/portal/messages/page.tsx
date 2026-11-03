import Link from "next/link";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import { formatDate } from "@/lib/i18n/format";
import { requirePageCustomer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listCustomerCases } from "@/lib/services/cases";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { MessageSquare } from "lucide-react";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.portal.messagesTitle };
}

export default async function MessagesPage() {
  const user = await requirePageCustomer("/portal/messages");
  const { d, locale } = await getDict();
  const cases = await listCustomerCases(await getDb(), user);
  return (
    <>
      <PageHeader title={d.portal.messagesTitle} />
      {cases.length === 0 ? (
        <EmptyState icon={<MessageSquare className="size-10" />} title={d.portal.messagesEmpty} />
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {cases.map((c) => (
            <li key={c.id}>
              <Link href={`/portal/cases/${c.id}?tab=messages`} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="bidi-auto block truncate font-medium text-slate-900">{c.title}</span>
                  <span className="text-xs text-slate-500">
                    <span dir="ltr">{c.number}</span> · {fmt(d.portal.lastUpdate, { date: formatDate(c.updatedAt, locale) })}
                  </span>
                </span>
                {c.unread > 0 ? (
                  <span className="shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">{fmt(d.portal.unread, { n: c.unread })}</span>
                ) : (
                  <MessageSquare className="size-4 shrink-0 text-slate-400" aria-hidden />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
