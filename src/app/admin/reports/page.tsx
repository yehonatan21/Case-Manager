import { formatDate } from "@/lib/i18n/format";
import { DateInput } from "@/components/ui/date-input";
import { Download } from "lucide-react";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import { formatMoney } from "@/lib/i18n/format";
import { requireStaffPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { buildReport, resolvePeriod } from "@/lib/services/reports";
import { listServiceCategories } from "@/lib/services/categories";
import { duration, hhmm, monthLabel, num, pct } from "@/lib/reports-format";
import { buildProfitReport } from "@/lib/services/time";
import { getSettings } from "@/lib/services/settings";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardContent } from "@/components/ui/card";
import { ColumnChart, HBarChart, StatTile } from "@/components/admin/reports/charts";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.reports.title };
}

const PRESETS = ["7d", "30d", "90d", "month", "last_month", "year"] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ preset?: string; from?: string; to?: string }> }) {
  const user = await requireStaffPage("/admin/reports", "reports");
  const sp = await searchParams;
  const { d, locale } = await getDict();
  const t = d.reports;
  const db = await getDb();
  const period = resolvePeriod(sp);
  const settingsCurrency = (await getSettings(db)).currency;
  const [r, categories, profit] = await Promise.all([buildReport(db, user, period), listServiceCategories(db, { includeInactive: true }), buildProfitReport(db, user, period, settingsCurrency)]);
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
        subtitle={fmt(t.periodLine, { from: formatDate(period.from, locale), to: formatDate(period.to, locale) })}
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
          <DateInput name="from" defaultValue={period.preset === "custom" ? period.from : ""} className="w-40" />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-slate-700">{t.to}</span>
          <DateInput name="to" defaultValue={period.preset === "custom" ? period.to : ""} className="w-40" />
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

        <section aria-labelledby="sat-title" className="space-y-4">
          <h2 id="sat-title" className="text-lg font-semibold">
            {d.feedback.reportTitle}
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label={d.feedback.average} value={r.satisfaction.average === null ? "—" : `${num(r.satisfaction.average, locale, 1)} / 5`} hint={fmt(d.feedback.count, { n: r.satisfaction.count })} />
            <StatTile label={d.feedback.responseRate} value={pct(r.satisfaction.responseRate, locale)} hint={fmt(d.feedback.responseRateHint, { n: r.satisfaction.completed })} />
            <StatTile label={fmt(d.feedback.stars, { n: 5 })} value={num(r.satisfaction.distribution[0]!.count, locale)} hint={fmt(d.feedback.count, { n: r.satisfaction.count })} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="py-5">
                <h3 className="mb-3 text-sm font-semibold">{d.feedback.distribution}</h3>
                <HBarChart
                  labelHeader={d.feedback.rating}
                  valueHeader={t.requests}
                  empty={d.feedback.noRatings}
                  data={r.satisfaction.distribution.map((x) => ({ key: String(x.star), label: `${fmt(d.feedback.stars, { n: x.star })} · ${d.feedback.labels[x.star - 1]}`, value: x.count, display: num(x.count, locale), detail: pct(r.satisfaction.count ? x.count / r.satisfaction.count : null, locale) }))}
                />
              </CardContent>
            </Card>
            {r.access.operations && (
              <Card>
                <CardContent className="py-5">
                  <h3 className="mb-3 text-sm font-semibold">{d.feedback.recent}</h3>
                  {r.satisfaction.recent.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-500">{d.feedback.noRatings}</p>
                  ) : (
                    <ul className="space-y-3">
                      {r.satisfaction.recent.map((x) => (
                        <li key={x.caseId} className="text-sm">
                          <p className="font-medium text-slate-800">
                            {fmt(d.feedback.stars, { n: x.rating })} ·{" "}
                            <a href={`/admin/cases/${x.caseId}`} className="text-brand-700 hover:underline" dir="ltr">
                              {x.caseNumber}
                            </a>
                          </p>
                          <p className="bidi-auto text-slate-600">{x.comment}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </section>

        {profit && (
          <section aria-labelledby="profit-title" className="space-y-4">
            <h2 id="profit-title" className="text-lg font-semibold">
              {d.time.reportTitle}
            </h2>
            <p className="text-sm text-slate-600">{d.time.reportHint}</p>
            {profit.money && (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  <StatTile label={d.time.revenue} value={money(profit.money.totals.revenueCents)} />
                  <StatTile label={d.time.labor} value={money(profit.money.totals.laborCents)} />
                  <StatTile label={d.time.expensesCost} value={money(profit.money.totals.expensesCents)} />
                  <StatTile label={d.time.profit} value={money(profit.money.totals.profitCents)} />
                  <StatTile label={d.time.margin} value={profit.money.totals.marginPct == null ? "—" : `${num(profit.money.totals.marginPct, locale, 1)}%`} />
                </div>
                {profit.money.unratedMembers.length > 0 && <p className="text-sm text-amber-800">{fmt(d.time.unratedMembers, { names: profit.money.unratedMembers.join(", ") })}</p>}
                {profit.money.byService.length > 0 && (
                  <div tabIndex={0} role="region" aria-label={d.time.byService} className="overflow-x-auto outline-offset-2 rounded-xl border border-slate-200 bg-white">
                    <table className="w-full min-w-[46rem] text-sm">
                      <caption className="px-4 pt-3 text-start text-sm font-semibold">{d.time.byService}</caption>
                      <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                        <tr>
                          <th scope="col" className="px-4 py-3 text-start font-medium">{d.time.serviceCol}</th>
                          <th scope="col" className="px-4 py-3 text-end font-medium">{d.time.casesCol}</th>
                          <th scope="col" className="px-4 py-3 text-end font-medium">{d.time.hoursCol}</th>
                          <th scope="col" className="px-4 py-3 text-end font-medium">{d.time.revenueCol}</th>
                          <th scope="col" className="px-4 py-3 text-end font-medium">{d.time.laborCol}</th>
                          <th scope="col" className="px-4 py-3 text-end font-medium">{d.time.expensesCol}</th>
                          <th scope="col" className="px-4 py-3 text-end font-medium">{d.time.profitCol}</th>
                          <th scope="col" className="px-4 py-3 text-end font-medium">{d.time.marginCol}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {profit.money.byService.map((x) => (
                          <tr key={x.category}>
                            <th scope="row" className="px-4 py-3 text-start font-medium">{catLabel(x.category)}</th>
                            <td className="px-4 py-3 text-end tabular-nums">{num(x.cases, locale)}</td>
                            <td className="px-4 py-3 text-end tabular-nums" dir="ltr">{hhmm(x.minutes)}</td>
                            <td className="px-4 py-3 text-end tabular-nums">{money(x.revenueCents)}</td>
                            <td className="px-4 py-3 text-end tabular-nums">{money(x.laborCents)}</td>
                            <td className="px-4 py-3 text-end tabular-nums">{money(x.expensesCents)}</td>
                            <td className={`px-4 py-3 text-end font-semibold tabular-nums ${x.profitCents < 0 ? "text-red-700" : ""}`}>{money(x.profitCents)}</td>
                            <td className="px-4 py-3 text-end tabular-nums">{x.marginPct == null ? "—" : `${num(x.marginPct, locale, 1)}%`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  {(["mostProfitable", "leastProfitable"] as const).map((k) => (
                    <Card key={k}>
                      <CardContent className="py-4">
                        <h3 className="mb-2 text-sm font-semibold">{d.time[k]}</h3>
                        {profit.money![k].length === 0 ? (
                          <p className="text-sm text-slate-500">—</p>
                        ) : (
                          <ul className="space-y-1.5 text-sm">
                            {profit.money![k].map((c) => (
                              <li key={c.id} className="flex items-baseline justify-between gap-3">
                                <a href={`/admin/cases/${c.id}?tab=time`} className="bidi-auto min-w-0 truncate text-slate-800 hover:text-brand-700 hover:underline">
                                  {c.title} <span className="font-mono text-xs text-slate-500" dir="ltr">{c.number}</span>
                                </a>
                                <span className={`shrink-0 font-semibold tabular-nums ${c.profitCents < 0 ? "text-red-700" : "text-emerald-700"}`}>{money(c.profitCents)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            )}
            {profit.byMember.length === 0 ? (
              <p className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600">{d.time.noTime}</p>
            ) : (
              <div tabIndex={0} role="region" aria-label={d.time.hoursByMember} className="overflow-x-auto outline-offset-2 rounded-xl border border-slate-200 bg-white">
                <table className="w-full min-w-[36rem] text-sm">
                  <caption className="px-4 pt-3 text-start text-sm font-semibold">{d.time.hoursByMember}</caption>
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-start font-medium">{d.time.member}</th>
                      <th scope="col" className="px-4 py-3 text-end font-medium">{d.time.hoursCol}</th>
                      <th scope="col" className="px-4 py-3 text-end font-medium">{d.time.billableCol}</th>
                      <th scope="col" className="px-4 py-3 text-end font-medium">{d.time.casesCol}</th>
                      {profit.money && <th scope="col" className="px-4 py-3 text-end font-medium">{d.time.laborCol}</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {profit.byMember.map((m) => (
                      <tr key={m.id}>
                        <th scope="row" className="px-4 py-3 text-start font-medium">{m.name}</th>
                        <td className="px-4 py-3 text-end tabular-nums" dir="ltr">{hhmm(m.minutes)}</td>
                        <td className="px-4 py-3 text-end tabular-nums" dir="ltr">{hhmm(m.billableMinutes)}</td>
                        <td className="px-4 py-3 text-end tabular-nums">{num(m.cases, locale)}</td>
                        {profit.money && <td className="px-4 py-3 text-end tabular-nums">{"laborCents" in m && m.laborCents != null ? money(m.laborCents) : "—"}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {r.team && (
          <section aria-labelledby="team-title" className="space-y-3">
            <h2 id="team-title" className="text-lg font-semibold">
              {t.team}
            </h2>
            <p className="text-sm text-slate-600">
              {t.teamHint}
              {r.unassigned ? ` ${fmt(t.unassigned, { n: r.unassigned })}` : ""}
            </p>
            <div tabIndex={0} role="region" aria-label={t.team} className="overflow-x-auto outline-offset-2 rounded-xl border border-slate-200 bg-white">
              <table className="w-full min-w-[50rem] text-sm">
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
                    <th scope="col" className="px-4 py-3 text-end font-medium">{d.feedback.memberRating}</th>
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
                      <td className="px-4 py-3 text-end tabular-nums">{m.averageRating === null ? "—" : `${num(m.averageRating, locale, 1)} (${m.ratings})`}</td>
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
