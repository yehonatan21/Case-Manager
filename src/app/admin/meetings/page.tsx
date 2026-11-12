import Link from "next/link";
import { getDict } from "@/lib/i18n/server";
import { formatDateTime } from "@/lib/i18n/format";
import { requireStaffPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { calendarItems, getAvailability, listUpcomingMeetings } from "@/lib/services/meetings";
import { calendarRange, parseDay, parseMode } from "@/lib/calendar-view";
import { TIME_ZONE } from "@/lib/i18n/format";
import { getCalendarStatus } from "@/lib/services/calendar";
import { googleEnabled } from "@/lib/services/google";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { AvailabilityEditor } from "@/components/admin/meetings/availability-editor";
import { CalendarConnect } from "@/components/admin/meetings/calendar-connect";
import { CalendarView } from "@/components/admin/meetings/calendar-view";
import { CalendarClock } from "lucide-react";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.meetings.pageTitle };
}

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    all?: string;
    calendar?: string;
    view?: string;
    date?: string;
    new?: string;
  }>;
}) {
  const user = await requireStaffPage("/admin/meetings", "meetings");
  const { all, calendar, view, date, new: startNew } = await searchParams;
  const { d, locale } = await getDict();
  const t = d.meetings;
  const db = await getDb();
  const showAll = all === "1" && user.role === "admin";
  const range = calendarRange(parseMode(view), parseDay(date, TIME_ZONE), TIME_ZONE);
  const [rows, availability, cal, shown] = await Promise.all([
    listUpcomingMeetings(db, user, { all: showAll }),
    getAvailability(db, user.id),
    getCalendarStatus(db, user.id),
    calendarItems(db, user, { from: range.from, to: range.to, all: showAll }, TIME_ZONE),
  ]);
  return (
    <>
      <PageHeader title={t.pageTitle} subtitle={t.pageSub} />
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-8">
          <CalendarView range={range} items={shown.items} google={shown.google} connected={cal.connected} locale={locale} t={t.cal} all={showAll} openNew={startNew === "event"} />
          <section aria-labelledby="upcoming-title" className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 id="upcoming-title" className="text-lg font-semibold">
                {t.upcoming}
              </h2>
              {user.role === "admin" && (
                <nav className="flex gap-1 text-sm" aria-label={t.upcoming}>
                  <Link
                    href={`/admin/meetings?view=${range.mode}&date=${range.anchor}`}
                    aria-current={!showAll ? "page" : undefined}
                    className={!showAll ? "rounded-md bg-brand-50 px-2.5 py-1 font-medium text-brand-800" : "rounded-md px-2.5 py-1 text-slate-600 hover:bg-slate-100"}
                  >
                    {t.onlyMine}
                  </Link>
                  <Link
                    href={`/admin/meetings?all=1&view=${range.mode}&date=${range.anchor}`}
                    aria-current={showAll ? "page" : undefined}
                    className={showAll ? "rounded-md bg-brand-50 px-2.5 py-1 font-medium text-brand-800" : "rounded-md px-2.5 py-1 text-slate-600 hover:bg-slate-100"}
                  >
                    {t.allTeam}
                  </Link>
                </nav>
              )}
            </div>
            {rows.length === 0 ? (
              <EmptyState icon={<CalendarClock className="size-10" />} title={t.none} />
            ) : (
              <ul className="space-y-2">
                {rows.map((r) => (
                  <li key={r.m.id}>
                    <Link href={`/admin/cases/${r.m.caseId}?tab=meetings`} className="block rounded-card bg-card shadow-card px-4 py-3 hover:border-brand-200">
                      <p className="font-medium text-slate-900">
                        {formatDateTime(r.m.startAt, locale)} · {t.modes[r.m.mode]}
                        {showAll && <span className="text-slate-500"> · {r.staffName}</span>}
                      </p>
                      <p className="bidi-auto text-sm text-slate-600">
                        {r.clientName} · <span dir="ltr">{r.caseNumber}</span> · {r.caseTitle}
                      </p>
                      {r.m.notes && <p className="bidi-auto mt-0.5 line-clamp-1 text-sm text-slate-500">{r.m.notes}</p>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="grid content-start gap-6 lg:grid-cols-2 2xl:grid-cols-1">
          <CalendarConnect status={cal} available={googleEnabled()} result={calendar} />
          <AvailabilityEditor initial={availability} />
        </div>
      </div>
    </>
  );
}
