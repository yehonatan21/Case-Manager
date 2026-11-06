import Link from "next/link";
import { AlertTriangle, ArrowRight, Clock, FileClock, FolderKanban, Inbox, Receipt, UserRoundX } from "lucide-react";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import { formatRelative } from "@/lib/i18n/format";
import { requirePageStaff } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { attentionItems, dashboardMetrics } from "@/lib/services/dashboard";
import { getSettings } from "@/lib/services/settings";
import { getSystemHealth } from "@/lib/services/health";
import { PageHeader } from "@/components/ui/misc";
import { UrgencyBadgeServer } from "@/components/admin/server-badges";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.admin.dashboardTitle };
}

export default async function Dashboard() {
  const user = await requirePageStaff("/admin");
  const { d, locale } = await getDict();
  const db = await getDb();
  const settings = await getSettings(db);
  const [m, items] = await Promise.all([dashboardMetrics(db, user), attentionItems(db, user, settings.first_response_sla_hours)]);
  // Admins see when an integration or the scheduled jobs stop working, without opening the health page.
  const broken = user.role === "admin" ? (await getSystemHealth(db, user).catch(() => null))?.level === "error" : false;
  const tiles = [
    { label: d.admin.metrics.newRequests, hint: d.admin.metrics.newRequestsHint, value: m.newRequests, href: "/admin/inbox", icon: Inbox, tone: "text-brand-700 bg-brand-50" },
    { label: d.admin.metrics.awaitingQuote, hint: d.admin.metrics.awaitingQuoteHint, value: m.awaitingQuote, href: "/admin/cases?status=quote_preparation", icon: FileClock, tone: "text-sky-700 bg-sky-50" },
    { label: d.admin.metrics.quotesPending, hint: d.admin.metrics.quotesPendingHint, value: m.quotesPending, href: "/admin/quotes", icon: Receipt, tone: "text-violet-700 bg-violet-50" },
    { label: d.admin.metrics.activeCases, hint: d.admin.metrics.activeCasesHint, value: m.activeCases, href: "/admin/cases?status=active", icon: FolderKanban, tone: "text-emerald-700 bg-emerald-50" },
    { label: d.admin.metrics.awaitingClient, hint: d.admin.metrics.awaitingClientHint, value: m.awaitingClient, href: "/admin/cases?status=awaiting_client", icon: UserRoundX, tone: "text-amber-700 bg-amber-50" },
    { label: d.admin.metrics.overdueTasks, hint: d.admin.metrics.overdueTasksHint, value: m.overdueTasks, href: "/admin/tasks?overdue=1", icon: AlertTriangle, tone: m.overdueTasks ? "text-red-700 bg-red-50" : "text-slate-600 bg-slate-100" },
  ];
  return (
    <>
      <PageHeader title={d.admin.dashboardTitle} subtitle={d.admin.dashboardSub} />
      {broken && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span className="flex-1 font-medium">{d.health.dashboardAlert}</span>
          <Link href="/admin/health" className="font-semibold underline">
            {d.health.dashboardAlertLink}
          </Link>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="group rounded-xl border border-slate-200 bg-white p-4 shadow-xs transition hover:border-brand-200 hover:shadow-sm">
            <div className="flex items-center justify-between">
              <span className={cn("flex size-9 items-center justify-center rounded-lg", t.tone)}>
                <t.icon className="size-4.5" aria-hidden />
              </span>
              <span className="text-2xl font-bold tabular-nums text-slate-900">{t.value}</span>
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-800">{t.label}</p>
            <p className="text-xs text-slate-500">{t.hint}</p>
          </Link>
        ))}
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">{d.admin.attentionTitle}</h2>
        {items.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-600">{d.admin.attentionEmpty}</p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {items.map((it) => (
              <li key={it.key}>
                <Link href={`/admin/cases/${it.caseId}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 hover:bg-slate-50">
                  <span className={cn("size-2 shrink-0 rounded-full", it.reason === "sla_breach" || it.reason === "overdue_task" ? "bg-red-500" : it.urgency === "urgent" || it.urgency === "high" ? "bg-amber-500" : "bg-brand-500")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-900">{fmt(d.admin.reasons[it.reason], it.vars)}</span>
                    <span className="bidi-auto block truncate text-sm text-slate-600">
                      <span dir="ltr" className="font-mono text-xs">{it.number}</span> · {it.title} · {it.customerName}
                    </span>
                  </span>
                  <UrgencyBadgeServer urgency={it.urgency} label={d.urgency[it.urgency as "normal"]} />
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                    <Clock className="size-3.5" aria-hidden />
                    {formatRelative(it.at, locale)}
                  </span>
                  <ArrowRight className="size-4 text-slate-400 flip-rtl" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
