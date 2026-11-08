/**
 * Meetings: clients book a consultation with the team member handling their case, in a free slot of that person's
 * working hours (minus their other meetings and, when connected, their Google Calendar's busy times). Staff can
 * book any time that's free for them. Both sides get notifications, reminders and an .ics file; with Google
 * Calendar connected the meeting is added there too, with a Meet link for video meetings.
 */
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import type { Database, DbOrTx } from "../db";
import { meetings, staffAvailability, users, type Case, type Meeting, type User, type WeeklyHours } from "../db/schema";
import { AppError } from "../errors";
import { env } from "../env";
import { isStaffRole } from "../domain";
import { cleanWeeklyHours, DEFAULT_TZ, defaultWeeklyHours, freeSlots, meetingIcs, zonedToUtc, type Interval } from "../meetings";
import type { CalendarItem } from "../calendar-view";
import { dictionaries } from "../i18n/dictionaries";
import { fmt, type Locale } from "../i18n/config";
import { formatDateTime } from "../i18n/format";
import { adminCaseLink, caseWithAccess, getCaseRow, portalCaseLink } from "./cases";
import { addEvent } from "./events";
import { notify } from "./notifications";
import { audit } from "./audit";
import { getSettings } from "./settings";
import { calendarBusy, createCalendarEvent, deleteCalendarEvent, getCalendarStatus, listCalendarEvents, moveCalendarEvent } from "./calendar";

export type MeetingMode = "video" | "phone" | "office";
export const MEETING_MODES: MeetingMode[] = ["video", "phone", "office"];
/** Upcoming meetings a client can have on one case at a time. */
export const MAX_CLIENT_UPCOMING = 3;
const MIN = 60_000;
/** Roles that take meetings by default. */
const BOOKABLE_ROLES = ["admin", "case_manager", "staff"];

// ---------- Availability ----------

export async function getAvailability(db: DbOrTx, userId: string): Promise<{ bookable: boolean; weekly: WeeklyHours }> {
  const [row] = await db.select().from(staffAvailability).where(eq(staffAvailability.userId, userId));
  if (row) return { bookable: row.bookable, weekly: row.weekly };
  const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
  return { bookable: !!u && BOOKABLE_ROLES.includes(u.role), weekly: defaultWeeklyHours() };
}

/** A team member sets their own hours (an admin can set anyone's). */
export async function setAvailability(db: DbOrTx, actor: User, userId: string, input: { bookable: boolean; weekly: unknown }) {
  if (!isStaffRole(actor.role) || (actor.id !== userId && actor.role !== "admin")) throw new AppError("forbidden");
  const weekly = cleanWeeklyHours(input.weekly);
  if (!weekly) throw new AppError("validation", "Invalid working hours");
  await db
    .insert(staffAvailability)
    .values({ userId, bookable: input.bookable, weekly, updatedAt: new Date() })
    .onConflictDoUpdate({ target: staffAvailability.userId, set: { bookable: input.bookable, weekly, updatedAt: new Date() } });
}

/** Who a client can meet on this case: the assignee if they take meetings, else every bookable admin / case manager. */
async function bookableStaff(db: DbOrTx, c: Pick<Case, "assigneeId">) {
  const candidates = c.assigneeId
    ? await db.select().from(users).where(and(eq(users.id, c.assigneeId), eq(users.status, "active")))
    : await db.select().from(users).where(and(inArray(users.role, ["admin", "case_manager"]), eq(users.status, "active")));
  const out: { user: User; weekly: WeeklyHours }[] = [];
  for (const u of candidates) {
    const a = await getAvailability(db, u.id);
    if (a.bookable && isStaffRole(u.role)) out.push({ user: u, weekly: a.weekly });
  }
  // Nobody assigned takes meetings: fall back to the whole team.
  if (out.length === 0 && c.assigneeId) return bookableStaff(db, { assigneeId: null });
  return out;
}

async function staffBusy(db: DbOrTx, staffId: string, from: Date, to: Date, exceptMeetingId?: string): Promise<Interval[]> {
  const rows = await db
    .select({ start: meetings.startAt, end: meetings.endAt })
    .from(meetings)
    .where(and(eq(meetings.staffId, staffId), eq(meetings.status, "scheduled"), lt(meetings.startAt, to), gt(meetings.endAt, from), ...(exceptMeetingId ? [ne(meetings.id, exceptMeetingId)] : [])));
  return rows;
}

export type Slot = { start: string; end: string; staffId: string; staffName: string };

/** Free slots for this case's client, over the booking window. */
export async function availableSlots(db: DbOrTx, actor: User, caseId: string, durationMinutes: number, opts: { exceptMeetingId?: string; now?: Date } = {}): Promise<Slot[]> {
  const { c, access } = await caseWithAccess(db, actor, caseId);
  if (!access.view) throw new AppError("forbidden");
  const s = await getSettings(db);
  if (!s.meeting_durations.includes(durationMinutes)) throw new AppError("validation", "Unsupported meeting length");
  const now = opts.now ?? new Date();
  const earliest = new Date(now.getTime() + s.meeting_min_notice_hours * 3600_000);
  const latest = new Date(now.getTime() + s.meeting_horizon_days * 86_400_000);
  const out: Slot[] = [];
  for (const { user, weekly } of await bookableStaff(db, c)) {
    const busy = [...(await staffBusy(db, user.id, earliest, latest, opts.exceptMeetingId)), ...(await calendarBusy(db, user.id, earliest, latest))];
    for (const start of freeSlots({ weekly, durationMinutes, bufferMinutes: s.meeting_buffer_minutes, earliest, latest, busy })) {
      out.push({ start: start.toISOString(), end: new Date(start.getTime() + durationMinutes * MIN).toISOString(), staffId: user.id, staffName: user.name });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

// ---------- Booking ----------

export type BookInput = { start: string | Date; durationMinutes: number; mode: MeetingMode; notes?: string | null; staffId?: string | null };

function meetingTitle(locale: Locale, c: Pick<Case, "number" | "title">) {
  return fmt(dictionaries[locale].meetings.eventTitle, { number: c.number, title: c.title });
}

async function locationText(db: DbOrTx, m: Pick<Meeting, "mode" | "meetUrl">, locale: Locale) {
  const d = dictionaries[locale].meetings;
  if (m.mode === "video") return m.meetUrl ?? d.modes.video;
  if (m.mode === "office") return (await getSettings(db)).meeting_office_address || d.modes.office;
  return d.modes.phone;
}

/** Locks the staff member's schedule for the rest of the transaction, so two bookings can't take the same time. */
async function lockSchedule(tx: DbOrTx, staffId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"meetings:" + staffId}))`);
}

export async function bookMeeting(db: Database, actor: User, caseId: string, input: BookInput): Promise<Meeting> {
  const { c, access, customerUserId } = await caseWithAccess(db, actor, caseId);
  if (access.isClient ? !access.view : !access.edit) throw new AppError("forbidden");
  if (!MEETING_MODES.includes(input.mode)) throw new AppError("validation");
  const s = await getSettings(db);
  const start = new Date(input.start);
  if (isNaN(start.getTime())) throw new AppError("validation");
  const end = new Date(start.getTime() + input.durationMinutes * MIN);

  let staffId: string;
  if (access.isClient) {
    // Clients pick from the free slots shown to them; the slot is checked again here.
    const slots = await availableSlots(db, actor, caseId, input.durationMinutes);
    const slot = slots.find((x) => x.start === start.toISOString() && (!input.staffId || x.staffId === input.staffId));
    if (!slot) throw new AppError("meeting_slot_taken");
    staffId = slot.staffId;
    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(meetings)
      .where(and(eq(meetings.caseId, c.id), eq(meetings.status, "scheduled"), gt(meetings.startAt, new Date())));
    if (n >= MAX_CLIENT_UPCOMING) throw new AppError("meeting_limit");
  } else {
    // Staff book for themselves or a colleague, at any future time that's free for that person.
    if (input.durationMinutes < 15 || input.durationMinutes > 240) throw new AppError("validation");
    if (start.getTime() < Date.now()) throw new AppError("meeting_in_past");
    staffId = input.staffId || actor.id;
    const [u] = await db.select().from(users).where(eq(users.id, staffId));
    if (!u || !isStaffRole(u.role) || u.status === "disabled") throw new AppError("validation");
    const busy = await calendarBusy(db, staffId, start, end);
    if (busy.some((b) => b.start < end && start < b.end)) throw new AppError("meeting_slot_taken");
  }

  const m = await db.transaction(async (tx) => {
    await lockSchedule(tx, staffId);
    const pad = s.meeting_buffer_minutes * MIN;
    const clash = await staffBusy(tx, staffId, new Date(start.getTime() - pad), new Date(end.getTime() + pad));
    if (clash.length) throw new AppError("meeting_slot_taken");
    const [row] = await tx
      .insert(meetings)
      .values({ caseId: c.id, staffId, clientUserId: customerUserId, startAt: start, endAt: end, mode: input.mode, notes: input.notes?.trim().slice(0, 1000) || null, createdById: actor.id })
      .returning();
    await addEvent(tx, { caseId: c.id, type: "meeting_booked", actor, visibility: "client", data: { start: start.toISOString(), mode: input.mode } });
    await audit(tx, { actorId: actor.id, action: "meeting.book", entityType: "meeting", entityId: row!.id, details: { staffId, start: start.toISOString() } });
    return row!;
  });

  await syncCalendarOnBook(db, m, c);
  const saved = (await db.select().from(meetings).where(eq(meetings.id, m.id)))[0]!;
  await notifyMeeting(db, saved, c, access.isClient ? "meeting_booked" : "meeting_booked_for_you", actor);
  return saved;
}

async function syncCalendarOnBook(db: Database, m: Meeting, c: Pick<Case, "id" | "number" | "title">) {
  const [staff] = await db.select({ locale: users.locale }).from(users).where(eq(users.id, m.staffId));
  const locale = (staff?.locale as Locale) ?? "he";
  const ev = await createCalendarEvent(db, m.staffId, {
    meetingId: m.id,
    title: meetingTitle(locale, { number: c.number, title: c.title }),
    description: `${new URL(adminCaseLink(c.id), env.appUrl)}${m.notes ? `\n\n${m.notes}` : ""}`,
    start: m.startAt,
    end: m.endAt,
    location: m.mode === "office" ? (await getSettings(db)).meeting_office_address || null : null,
    video: m.mode === "video",
  });
  if (ev) await db.update(meetings).set({ externalEventId: ev.id, meetUrl: ev.meetUrl }).where(eq(meetings.id, m.id));
}

/** Tells the other side (and, for staff bookings, the client). */
async function notifyMeeting(db: Database, m: Meeting, c: Pick<Case, "id" | "number">, type: "meeting_booked" | "meeting_booked_for_you" | "meeting_cancelled" | "meeting_moved", actor: User) {
  const recipients = isStaffRole(actor.role) ? [m.clientUserId] : [m.staffId];
  const [staff] = await db.select({ name: users.name }).from(users).where(eq(users.id, m.staffId));
  for (const id of recipients.filter(Boolean) as string[]) {
    const [u] = await db.select({ role: users.role, locale: users.locale }).from(users).where(eq(users.id, id));
    if (!u) continue;
    const locale = (u.locale as Locale) ?? "he";
    await notify(db, {
      userIds: [id],
      type,
      caseId: c.id,
      vars: { number: c.number, date: formatDateTime(m.startAt, locale), name: isStaffRole(u.role) ? actor.name : staff?.name ?? "", mode: dictionaries[locale].meetings.modes[m.mode] },
      link: isStaffRole(u.role) ? `${adminCaseLink(c.id)}?tab=meetings` : `${portalCaseLink(c.id)}?tab=meetings`,
    });
  }
}

async function meetingWithAccess(db: DbOrTx, actor: User, meetingId: string) {
  const [m] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!m) throw new AppError("not_found");
  const { c, access } = await caseWithAccess(db, actor, m.caseId);
  const allowed = access.isClient ? access.view : access.edit || m.staffId === actor.id;
  if (!allowed) throw new AppError("forbidden");
  return { m, c, access };
}

export async function cancelMeeting(db: Database, actor: User, meetingId: string, reason?: string | null) {
  const { m, c } = await meetingWithAccess(db, actor, meetingId);
  if (m.status !== "scheduled") throw new AppError("conflict");
  const [done] = await db
    .update(meetings)
    .set({ status: "cancelled", cancelledById: actor.id, cancelledAt: new Date(), cancelReason: reason?.trim().slice(0, 500) || null, sequence: m.sequence + 1, updatedAt: new Date() })
    .where(and(eq(meetings.id, m.id), eq(meetings.status, "scheduled")))
    .returning();
  if (!done) throw new AppError("conflict");
  await addEvent(db, { caseId: c.id, type: "meeting_cancelled", actor, visibility: "client", data: { start: m.startAt.toISOString() } });
  await audit(db, { actorId: actor.id, action: "meeting.cancel", entityType: "meeting", entityId: m.id });
  if (m.externalEventId) await deleteCalendarEvent(db, m.staffId, m.externalEventId);
  await notifyMeeting(db, done, c, "meeting_cancelled", actor);
  return done;
}

/** Moves a meeting to another free time (same rules as booking), keeping its calendar event and .ics UID. */
export async function rescheduleMeeting(db: Database, actor: User, meetingId: string, newStart: string | Date) {
  const { m, c, access } = await meetingWithAccess(db, actor, meetingId);
  if (m.status !== "scheduled") throw new AppError("conflict");
  const minutes = Math.round((m.endAt.getTime() - m.startAt.getTime()) / MIN);
  const start = new Date(newStart);
  if (isNaN(start.getTime())) throw new AppError("validation");
  const end = new Date(start.getTime() + minutes * MIN);
  if (access.isClient) {
    const slots = await availableSlots(db, actor, c.id, minutes, { exceptMeetingId: m.id });
    if (!slots.some((x) => x.start === start.toISOString() && x.staffId === m.staffId)) throw new AppError("meeting_slot_taken");
  } else if (start.getTime() < Date.now()) throw new AppError("meeting_in_past");
  const s = await getSettings(db);
  const moved = await db.transaction(async (tx) => {
    await lockSchedule(tx, m.staffId);
    const pad = s.meeting_buffer_minutes * MIN;
    if ((await staffBusy(tx, m.staffId, new Date(start.getTime() - pad), new Date(end.getTime() + pad), m.id)).length) throw new AppError("meeting_slot_taken");
    const [row] = await tx
      .update(meetings)
      .set({ startAt: start, endAt: end, sequence: m.sequence + 1, remindedDayAt: null, remindedHourAt: null, updatedAt: new Date() })
      .where(and(eq(meetings.id, m.id), eq(meetings.status, "scheduled")))
      .returning();
    if (!row) throw new AppError("conflict");
    await addEvent(tx, { caseId: c.id, type: "meeting_moved", actor, visibility: "client", data: { from: m.startAt.toISOString(), start: start.toISOString() } });
    await audit(tx, { actorId: actor.id, action: "meeting.reschedule", entityType: "meeting", entityId: m.id, details: { start: start.toISOString() } });
    return row;
  });
  if (m.externalEventId) await moveCalendarEvent(db, m.staffId, m.externalEventId, start, end);
  await notifyMeeting(db, moved, c, "meeting_moved", actor);
  return moved;
}

// ---------- Reading ----------

export type MeetingView = {
  id: string;
  startAt: Date;
  endAt: Date;
  mode: MeetingMode;
  status: "scheduled" | "cancelled";
  notes: string | null;
  staffId: string;
  staffName: string;
  meetUrl: string | null;
  location: string | null;
  cancelReason: string | null;
};

export async function listCaseMeetings(db: DbOrTx, actor: User, caseId: string): Promise<MeetingView[]> {
  const { access } = await caseWithAccess(db, actor, caseId);
  if (!access.view) throw new AppError("forbidden");
  const rows = await db
    .select({ m: meetings, staffName: users.name })
    .from(meetings)
    .innerJoin(users, eq(users.id, meetings.staffId))
    .where(eq(meetings.caseId, caseId))
    .orderBy(desc(meetings.startAt));
  const office = (await getSettings(db)).meeting_office_address || null;
  return rows.map(({ m, staffName }) => ({
    id: m.id,
    startAt: m.startAt,
    endAt: m.endAt,
    mode: m.mode,
    status: m.status,
    notes: m.notes,
    staffId: m.staffId,
    staffName,
    meetUrl: m.meetUrl,
    location: m.mode === "office" ? office : null,
    cancelReason: m.cancelReason,
  }));
}

/** Staff: upcoming meetings (their own, or everyone's for admins). */
export async function listUpcomingMeetings(db: DbOrTx, actor: User, opts: { all?: boolean; from?: Date } = {}) {
  if (!isStaffRole(actor.role)) throw new AppError("forbidden");
  const from = opts.from ?? new Date(Date.now() - 2 * 3600_000);
  const { cases } = await import("../db/schema");
  return db
    .select({ m: meetings, staffName: users.name, caseNumber: cases.number, caseTitle: cases.title, clientName: sql<string>`(select name from users u where u.id = ${meetings.clientUserId})` })
    .from(meetings)
    .innerJoin(users, eq(users.id, meetings.staffId))
    .innerJoin(cases, eq(cases.id, meetings.caseId))
    .where(and(eq(meetings.status, "scheduled"), gt(meetings.endAt, from), ...(opts.all && actor.role === "admin" ? [] : [eq(meetings.staffId, actor.id)])))
    .orderBy(asc(meetings.startAt))
    .limit(200);
}

/**
 * The Meetings page calendar for a period: the app's scheduled meetings (the actor's, or everyone's for an
 * admin who asks), and the events in the actor's own Google Calendar. Events the app created for its meetings
 * appear once, as the meeting. `google` says whether the calendar was read: "off" when not connected.
 */
export async function calendarItems(db: DbOrTx, actor: User, range: { from: Date; to: Date; all?: boolean }, tz = DEFAULT_TZ) {
  if (!isStaffRole(actor.role)) throw new AppError("forbidden");
  const { cases } = await import("../db/schema");
  const all = !!range.all && actor.role === "admin";
  const rows = await db
    .select({ m: meetings, staffName: users.name, caseNumber: cases.number, clientName: sql<string>`(select name from users u where u.id = ${meetings.clientUserId})` })
    .from(meetings)
    .innerJoin(users, eq(users.id, meetings.staffId))
    .innerJoin(cases, eq(cases.id, meetings.caseId))
    .where(and(eq(meetings.status, "scheduled"), lt(meetings.startAt, range.to), gt(meetings.endAt, range.from), ...(all ? [] : [eq(meetings.staffId, actor.id)])))
    .orderBy(asc(meetings.startAt))
    .limit(1000);
  const items: CalendarItem[] = rows.map(({ m, staffName, caseNumber, clientName }) => ({
    id: `m:${m.id}`,
    source: "app",
    title: `${clientName} · ${caseNumber}`,
    start: m.startAt.toISOString(),
    end: m.endAt.toISOString(),
    allDay: false,
    href: `/admin/cases/${m.caseId}?tab=meetings`,
    meetUrl: m.meetUrl,
    staffName: all ? staffName : null,
  }));
  const status = await getCalendarStatus(db, actor.id);
  let google: "ok" | "off" | "error" = "off";
  if (status.connected) {
    const events = await listCalendarEvents(db, actor.id, range.from, range.to);
    google = events ? "ok" : "error";
    for (const e of events ?? []) {
      // The app's own meetings are already in the list (they're always the actor's own).
      if (e.meetingId) continue;
      items.push({
        id: `g:${e.id}`,
        source: "google",
        title: e.title,
        start: e.allDay ? zonedToUtc(e.startDay!, "00:00", tz).toISOString() : new Date(e.start).toISOString(),
        end: e.allDay ? zonedToUtc(e.endDay ?? e.startDay!, "00:00", tz).toISOString() : new Date(e.end).toISOString(),
        allDay: e.allDay,
        href: e.htmlLink,
        meetUrl: e.meetUrl,
        staffName: null,
      });
    }
  }
  return { items, google };
}

/** The .ics file for a meeting the actor can see. */
export async function meetingIcsFile(db: DbOrTx, actor: User, meetingId: string) {
  const { m, c } = await meetingWithAccessForView(db, actor, meetingId);
  const locale = (actor.locale as Locale) ?? "he";
  const [staff] = await db.select({ name: users.name }).from(users).where(eq(users.id, m.staffId));
  const link = new URL(isStaffRole(actor.role) ? adminCaseLink(c.id) : portalCaseLink(c.id), env.appUrl).toString();
  const s = await getSettings(db);
  return meetingIcs({
    id: m.id,
    startAt: m.startAt,
    endAt: m.endAt,
    title: meetingTitle(locale, c),
    description: [fmt(dictionaries[locale].meetings.withName, { name: staff?.name ?? "" }), m.meetUrl ?? "", link, m.notes ?? ""].filter(Boolean).join("\n"),
    location: await locationText(db, m, locale),
    url: link,
    sequence: m.sequence,
    cancelled: m.status === "cancelled",
    organizerName: s.company.name || env.appName,
    host: new URL(env.appUrl).hostname,
  });
}

async function meetingWithAccessForView(db: DbOrTx, actor: User, meetingId: string) {
  const [m] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!m) throw new AppError("not_found");
  const { c, access } = await caseWithAccess(db, actor, m.caseId);
  if (!access.view) throw new AppError("not_found");
  return { m, c };
}

// ---------- Reminders ----------

/**
 * Reminders to both sides: "tomorrow" for meetings starting within 30 hours, and "starting soon" within 90
 * minutes. Each is sent once per meeting time (moving a meeting resets them).
 */
export async function sendMeetingReminders(db: Database, now = new Date()) {
  let sent = 0;
  const due = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.status, "scheduled"), gt(meetings.startAt, now), lt(meetings.startAt, new Date(now.getTime() + 30 * 3600_000))));
  for (const m of due) {
    const minutes = (m.startAt.getTime() - now.getTime()) / MIN;
    // Any meeting gets the earlier reminder once (even when jobs run only daily), and "starting soon" when close.
    const kind = minutes <= 90 && !m.remindedHourAt ? "hour" : minutes > 90 && !m.remindedDayAt ? "day" : null;
    if (!kind) continue;
    const [done] = await db
      .update(meetings)
      .set(kind === "hour" ? { remindedHourAt: now, remindedDayAt: m.remindedDayAt ?? now } : { remindedDayAt: now })
      .where(and(eq(meetings.id, m.id), kind === "hour" ? isNull(meetings.remindedHourAt) : isNull(meetings.remindedDayAt)))
      .returning();
    if (!done) continue;
    const c = await getCaseRow(db, m.caseId);
    const [staff] = await db.select({ name: users.name }).from(users).where(eq(users.id, m.staffId));
    for (const id of [m.staffId, m.clientUserId].filter(Boolean) as string[]) {
      const [u] = await db.select({ role: users.role, locale: users.locale }).from(users).where(eq(users.id, id));
      if (!u) continue;
      const locale = (u.locale as Locale) ?? "he";
      const staffSide = isStaffRole(u.role);
      await notify(db, {
        userIds: [id],
        type: kind === "hour" ? "meeting_soon" : "meeting_reminder",
        caseId: c.id,
        vars: { number: c.number, date: formatDateTime(m.startAt, locale), name: staffSide ? c.title : staff?.name ?? "", mode: dictionaries[locale].meetings.modes[m.mode] },
        link: staffSide ? `${adminCaseLink(c.id)}?tab=meetings` : `${portalCaseLink(c.id)}?tab=meetings`,
      });
    }
    sent++;
  }
  return sent;
}
