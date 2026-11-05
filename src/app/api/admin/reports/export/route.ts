import { errorResponse } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { getDict } from "@/lib/i18n/server";
import { buildReport, resolvePeriod } from "@/lib/services/reports";
import { listServiceCategories } from "@/lib/services/categories";
import { buildXlsx, type Sheet } from "@/lib/xlsx";
import { monthLabel } from "@/lib/reports-format";
import { formatDateTime } from "@/lib/i18n/format";

/** The report as an Excel file (.xlsx), one sheet per section plus the requests behind the numbers. */
export async function GET(req: Request) {
  try {
    const user = await requireApiStaff();
    const q = new URL(req.url).searchParams;
    const period = resolvePeriod({ preset: q.get("preset"), from: q.get("from"), to: q.get("to") });
    const db = await getDb();
    const { d, locale } = await getDict();
    const t = d.reports;
    const r = await buildReport(db, user, period);
    const cats = await listServiceCategories(db, { includeInactive: true });
    const cat = (k: string) => {
      const c = cats.find((x) => x.key === k);
      return c ? (locale === "he" ? c.he : c.en) : k;
    };
    const status = (s: string) => (d.status.internal as Record<string, string>)[s] ?? s;
    const amount = (c: number | null) => (c === null ? null : c / 100);
    const h = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
    const rtl = locale === "he";
    const sheets: Sheet[] = [
      {
        name: t.sheetSummary,
        rtl,
        widths: [36, 20],
        rows: [
          [t.metric, t.value],
          [t.from, period.from],
          [t.to, period.to],
          ...(r.revenue ? ([[`${t.revenueTotal} (${r.revenue.currency})`, amount(r.revenue.totalCents)], [t.payments, r.revenue.count], [`${t.averagePayment} (${r.revenue.currency})`, amount(r.revenue.averageCents)]] as (string | number | null)[][]) : []),
          [t.requests, r.funnel.requests],
          [t.quoted, r.funnel.quoted],
          [t.approved, r.funnel.approved],
          [t.paid, r.funnel.paid],
          [`${t.firstResponse} (${t.hoursUnit})`, h(r.times.medianFirstResponseHours)],
          [t.withinSla.replace("{h}", String(r.times.slaHours)), r.times.withinSlaShare === null ? null : Math.round(r.times.withinSlaShare * 1000) / 10],
          [`${t.timeToQuote} (${t.hoursUnit})`, h(r.times.medianHoursToQuote)],
          [`${t.timeToComplete} (${t.daysUnit})`, h(r.times.medianDaysToComplete)],
        ],
      },
    ];
    if (r.revenue) {
      sheets.push({ name: t.revenueByMonth, rtl, widths: [14, 16, 12], rows: [[t.month, `${t.revenue} (${r.revenue.currency})`, t.payments], ...r.revenue.byMonth.map((m) => [monthLabel(m.month, locale), amount(m.totalCents), m.count])] });
      sheets.push({ name: t.revenueByService, rtl, widths: [28, 16, 12], rows: [[t.serviceType, `${t.revenue} (${r.revenue.currency})`, t.payments], ...r.revenue.byService.map((x) => [cat(x.category), amount(x.totalCents), x.count])] });
    }
    sheets.push({ name: t.byType, rtl, widths: [28, 12], rows: [[t.serviceType, t.requests], ...r.byType.map((x) => [cat(x.category), x.count])] });
    if (r.team) {
      sheets.push({
        name: t.team,
        rtl,
        widths: [24, 14, 12, 12, 12, 12, 12, 12, 16],
        rows: [
          [t.member, t.role, t.openCases, t.newCases, t.completed, t.openTasks, t.overdueTasks, t.meetings, `${t.firstResponse} (${t.hoursUnit})`],
          ...r.team.map((m) => [m.name, (d.roles as Record<string, string>)[m.role] ?? m.role, m.openCases, m.newCases, m.completed, m.openTasks, m.overdueTasks, m.meetings, h(m.medianFirstResponseHours)]),
        ],
      });
    }
    sheets.push({
      name: t.sheetRequests,
      rtl,
      widths: [16, 30, 20, 22, 16, 18, 18, 14, ...(r.revenue ? [14, 14] : []), 18],
      rows: [
        [t.number, t.titleCol, t.client, t.serviceType, t.status, t.assignee, t.created, `${t.firstResponse} (${t.hoursUnit})`, ...(r.revenue ? [`${t.quoteTotal} (${r.currency})`, `${t.paidAmount} (${r.currency})`] : []), t.completedAt],
        ...r.cases.map((c) => [
          c.number,
          c.title,
          c.client,
          cat(c.serviceCategory),
          status(c.status),
          c.assignee ?? "",
          formatDateTime(c.createdAt, locale),
          h(c.firstResponseHours),
          ...(r.revenue ? [amount(c.quoteTotalCents), amount(c.paidCents)] : []),
          c.completedAt ? formatDateTime(c.completedAt, locale) : "",
        ]),
      ],
    });
    const file = buildXlsx(sheets);
    return new Response(file as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="report-${period.from}-${period.to}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
