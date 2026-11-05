import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import { formatMoney } from "@/lib/i18n/format";
import { requirePageStaff } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { buildReport, reportAccess, resolvePeriod } from "@/lib/services/reports";
import { listServiceCategories } from "@/lib/services/categories";
import { duration, monthLabel, num, pct } from "@/lib/reports-format";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardContent } from "@/components/ui/card";
import { ColumnChart, HBarChart, StatTile } from "@/components/admin/reports/charts";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.reports.title };
}

const PRESETS = ["7d", "30d", "90d", "month", "last_month", "year"] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ preset?: string; from?: string; to?: string }> }) {
  const user = await requirePageStaff("/admin/reports");
  if (!reportAccess(user.role)) redirect("/admin");
  const sp = await searchParams;
  const { d, locale } = await getDict();
  const t = d.reports;
  const db = await getDb();
  const period = resolvePeriod(sp);
  const [r, categories] = await Promise.all([buildReport(db, user, period), listServiceCategories(db, { includeInactive: true })]);
  const catLabel = (k: string) => {
    const c = categories.find((x) => x.key === k);
    return c ? (locale === "he" ? c.he : c.en) : (d.categories as Record<string, string>)[k] ?? k;
  };
  const money = (c: number) => formatMoney(c, r.currency, locale);
  const dur = (h: number | null) => duration(h, locale, { hours: t.hoursValue, days: t.daysValue });
  const share = (n: number) => (r.funnel.requests ? n / r.funnel.requests : null);
  const exportHref = `/api/admin/reports/export?${new URLSearchParams(period.preset === "custom" ? { from: period.from, to: period.to } : { preset: period.preset }).toString()}`;

  return (
    <>
      <PageHeader
        title={t.title}
        subtitle={fmt(t.periodLine, { from: new Date(`${period.from}T12:00:00Z`).toLocaleDateString(locale === "he" ? "he-IL" : "en-GB"), to: new Date(`${period.to}T12:00:00Z`).toLocaleDateString(locale === "he" ? "he-IL" : "en-GB") })}
        actions={
          <a href={exportHref} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50">
            <Download className="size-4" aria-hidden /> {t.export}
          </a>
        }
      />

      {/* Filters: one row above the charts. */}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4" aria-label={t.period}>
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-slate-700">{t.period}</span>
          <select name="preset" defaultValue={period.preset === "custom" ? "" : period.preset} className="h-10 rounded-lg border border-slate-300 bg-white px-3">
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {t.presets[p]}
              </option>
            ))}
            <option value="">{t.presets.custom}</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-slate-700">{t.from}</span>
          <input type="date" name="from" dir="ltr" defaultValue={period.preset === "custom" ? period.from : ""} className="h-10 rounded-lg border border-slate-300 px-3" />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-slate-700">{t.to}</span>
          <input type="date" name="to" dir="ltr" defaultValue={period.preset === "custom" ? period.to : ""} className="h-10 rounded-lg border border-slate-300 px-3" />
        </label>
        <button type="submit" className="h-10 rounded-lg bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800">
          {t.apply}
        </button>
        <p className="w-full text-xs text-slate-500">{t.customHint}</p>
      </form>

      <div className="space-y-8">
        {r.revenue && (
          <section aria-labelledby="rev-title" className="space-y-4">
            <h2 id="rev-title" className="text-lg font-semibold">
              {t.revenue}
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile label={t.revenueTotal} value={money(r.revenue.totalCents)} hint={r.revenue.otherCurrencies.map((o) => formatMoney(o.totalCents, o.currency, locale)).join(" · ") || undefined} />
              <StatTile label={t.payments} value={num(r.revenue.count, locale)} />
              <StatTile label={t.averagePayment} value={r.revenue.averageCents === null ? "—" : money(r.revenue.averageCents)} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardContent className="py-5">
                  <h3 className="mb-3 text-sm font-semibold">{t.revenueByMonth}</h3>
                  <ColumnChart
                    labelHeader={t.month}
                    valueHeader={t.revenue}
                    empty={t.noPayments}
                    data={r.revenue.byMonth.map((m) => ({ key: m.month, label: monthLabel(m.month, locale), value: m.totalCents, display: money(m.totalCents), detail: fmt(t.nPayments, { n: m.count }) }))}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-5">
                  <h3 className="mb-3 text-sm font-semibold">{t.revenueByService}</h3>
                  <HBarChart
                    labelHeader={t.serviceType}
                    valueHeader={t.revenue}
                    empty={t.noPayments}
                    data={r.revenue.byService.map((x) => ({ key: x.category, label: catLabel(x.category), value: x.totalCents, display: money(x.totalCents), detail: fmt(t.nPayments, { n: x.count }) }))}
                  />
                </CardContent>
              </Card>
            </div>
          </section>
        )}

        <section aria-labelledby="funnel-title" className="space-y-4">
          <h2 id="funnel-title" className="text-lg font-semibold">
            {t.funnel}
          </h2>
          <p className="text-sm text-slate-600">{t.funnelHint}</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <StatTile label={t.requests} value={num(r.funnel.requests, locale)} />
            <StatTile label={t.quoted} value={pct(share(r.funnel.quoted), locale)} hint={fmt(t.ofRequests, { n: r.funnel.quoted })} />
            <StatTile label={t.approved} value={pct(share(r.funnel.approved), locale)} hint={fmt(t.ofRequests, { n: r.funnel.approved })} />
            <StatTile label={t.paid} value={pct(share(r.funnel.paid), locale)} hint={fmt(t.ofRequests, { n: r.funnel.paid })} />
          </div>
          <Card>
            <CardContent className="py-5">
              <HBarChart
                labelHeader={t.stage}
                valueHeader={t.requests}
                empty={t.noRequests}
                data={(["requests", "quoted", "approved", "paid"] as const).map((k) => ({ key: k, label: t[k], value: r.funnel[k], display: num(r.funnel[k], locale), detail: k === "requests" ? undefined : pct(share(r.funnel[k]), locale) }))}
              />
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="times-title" className="space-y-4">
          <h2 id="times-title" className="text-lg font-semibold">
            {t.times}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label={t.firstResponse} value={dur(r.times.medianFirstResponseHours)} hint={fmt(t.medianOf, { n: r.times.responded })} />
            <StatTile label={fmt(t.withinSla, { h: r.times.slaHours })} value={pct(r.times.withinSlaShare, locale)} hint={r.times.awaitingResponse ? fmt(t.awaiting, { n: r.times.awaitingResponse }) : undefined} />
            <StatTile label={t.timeToQuote} value={dur(r.times.medianHoursToQuote)} hint={t.median} />
            <StatTile label={t.timeToComplete} value={r.times.medianDaysToComplete === null ? "—" : fmt(t.daysValue, { n: num(r.times.medianDaysToComplete, locale, 1) })} hint={t.median} />
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section aria-labelledby="type-title">
            <Card>
              <CardContent className="py-5">
                <h2 id="type-title" className="mb-3 text-sm font-semibold">
                  {t.byType}
                </h2>
                <HBarChart labelHeader={t.serviceType} valueHeader={t.requests} empty={t.noRequests} data={r.byType.map((x) => ({ key: x.category, label: catLabel(x.category), value: x.count, display: num(x.count, locale) }))} />
              </CardContent>
            </Card>
          </section>
          <section aria-labelledby="status-title">
            <Card>
              <CardContent className="py-5">
                <h2 id="status-title" className="mb-3 text-sm font-semibold">
                  {t.byStatus}
                </h2>
                <HBarChart
                  labelHeader={t.status}
                  valueHeader={t.requests}
                  empty={t.noRequests}
                  data={r.byStatus.map((x) => ({ key: x.status, label: (d.status.internal as Record<string, string>)[x.status] ?? x.status, value: x.count, display: num(x.count, locale) }))}
                />
              </CardContent>
            </Card>
          </section>
        </div>

        {r.team && (
          <section aria-labelledby="team-title" className="space-y-3">
            <h2 id="team-title" className="text-lg font-semibold">
              {t.team}
            </h2>
            <p className="text-sm text-slate-600">
              {t.teamHint}
              {r.unassigned ? ` ${fmt(t.unassigned, { n: r.unassigned })}` : ""}
            </p>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full min-w-[44rem] text-sm">
                <caption className="sr-only">{t.team}</caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-start font-medium">{t.member}</th>
                    <th scope="col" className="px-4 py-3 text-end font-medium">{t.openCases}</th>
                    <th scope="col" className="px-4 py-3 text-end font-medium">{t.newCases}</th>
                    <th scope="col" className="px-4 py-3 text-end font-medium">{t.completed}</th>
                    <th scope="col" className="px-4 py-3 text-end font-medium">{t.openTasks}</th>
                    <th scope="col" className="px-4 py-3 text-end font-medium">{t.overdueTasks}</th>
                    <th scope="col" className="px-4 py-3 text-end font-medium">{t.meetings}</th>
                    <th scope="col" className="px-4 py-3 text-end font-medium">{t.firstResponse}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {r.team.map((m) => (
                    <tr key={m.id}>
                      <th scope="row" className="px-4 py-3 text-start font-medium">
                        {m.name} <span className="text-xs font-normal text-slate-500">· {(d.roles as Record<string, string>)[m.role]}</span>
                      </th>
                      <td className="px-4 py-3 text-end tabular-nums">{num(m.openCases, locale)}</td>
                      <td className="px-4 py-3 text-end tabular-nums">{num(m.newCases, locale)}</td>
                      <td className="px-4 py-3 text-end tabular-nums">{num(m.completed, locale)}</td>
                      <td className="px-4 py-3 text-end tabular-nums">{num(m.openTasks, locale)}</td>
                      <td className={m.overdueTasks ? "px-4 py-3 text-end font-semibold tabular-nums text-red-700" : "px-4 py-3 text-end tabular-nums"}>{num(m.overdueTasks, locale)}</td>
                      <td className="px-4 py-3 text-end tabular-nums">{num(m.meetings, locale)}</td>
                      <td className="px-4 py-3 text-end tabular-nums">{dur(m.medianFirstResponseHours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
