/**
 * A team member's own calendar events, made on the Meetings page: a title, a day, a time (or all day), notes,
 * optionally a Google Meet link. With Google Calendar connected each one is also created there, and editing or
 * deleting it here changes it there. A calendar problem never loses the event: it's kept in the app, and the
 * problem is recorded on the calendar connection.
 */
import { and, asc, eq, gt, lt } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { staffEvents, type StaffEvent, type User } from "../db/schema";
import { AppError } from "../errors";
import { isStaffRole } from "../domain";
import { DEFAULT_TZ, zonedToUtc } from "../meetings";
import { addDays } from "../calendar-view";
import { createOwnCalendarEvent, deleteCalendarEvent, getCalendarStatus, updateOwnCalendarEvent, type OwnEventInput } from "./calendar";
import { audit } from "./audit";

export type StaffEventInput = {
  title: string;
  notes?: string | null;
  /** YYYY-MM-DD in business time. */
  date: string;
  allDay: boolean;
  /** HH:MM, for events that aren't all day. */
  startTime?: string;
  endTime?: string;
  /** Add a Google Meet link (needs Google Calendar connected). */
  video?: boolean;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function clean(input: StaffEventInput, tz: string) {
  const title = input.title.trim().slice(0, 200);
  const notes = input.notes?.trim().slice(0, 2000) || null;
  if (!title || !DAY.test(input.date) || Number.isNaN(Date.parse(`${input.date}T12:00:00Z`))) throw new AppError("validation");
  if (input.allDay) {
    return {
      title,
      notes,
      allDay: true,
      startAt: zonedToUtc(input.date, "00:00", tz),
      endAt: zonedToUtc(addDays(input.date, 1), "00:00", tz),
      startDay: input.date,
      endDay: addDays(input.date, 1),
    };
  }
  if (!TIME.test(input.startTime ?? "") || !TIME.test(input.endTime ?? "") || input.endTime! <= input.startTime!) throw new AppError("validation", "The event must end after it starts");
  return {
    title,
    notes,
    allDay: false,
    startAt: zonedToUtc(input.date, input.startTime!, tz),
    endAt: zonedToUtc(input.date, input.endTime!, tz),
    startDay: input.date,
    endDay: addDays(input.date, 1),
  };
}

const google = (id: string, v: ReturnType<typeof clean>, video: boolean): OwnEventInput => ({
  eventId: id,
  title: v.title,
  notes: v.notes,
  start: v.startAt,
  end: v.endAt,
  allDay: v.allDay,
  startDay: v.startDay,
  endDay: v.endDay,
  video,
});

async function own(db: DbOrTx, actor: User, id: string): Promise<StaffEvent> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("not_found");
  const [e] = await db.select().from(staffEvents).where(eq(staffEvents.id, id));
  // Someone else's event is as good as not there.
  if (!e || e.userId !== actor.id) throw new AppError("not_found");
  return e;
}

export async function createStaffEvent(db: DbOrTx, actor: User, input: StaffEventInput, tz = DEFAULT_TZ): Promise<StaffEvent> {
  if (!isStaffRole(actor.role)) throw new AppError("forbidden");
  const v = clean(input, tz);
  const [e] = await db
    .insert(staffEvents)
    .values({
      userId: actor.id,
      title: v.title,
      notes: v.notes,
      startAt: v.startAt,
      endAt: v.endAt,
      allDay: v.allDay,
    })
    .returning();
  let row = e!;
  if ((await getCalendarStatus(db, actor.id)).connected) {
    const g = await createOwnCalendarEvent(db, actor.id, google(row.id, v, !!input.video));
    if (g) [row] = (await db.update(staffEvents).set({ externalEventId: g.id, meetUrl: g.meetUrl }).where(eq(staffEvents.id, row.id)).returning()) as [StaffEvent];
  }
  await audit(db, {
    actorId: actor.id,
    action: "event.create",
    entityType: "user",
    entityId: actor.id,
    details: { eventId: row.id, google: !!row.externalEventId },
  });
  return row;
}

export async function updateStaffEvent(db: DbOrTx, actor: User, id: string, input: StaffEventInput, tz = DEFAULT_TZ): Promise<StaffEvent> {
  const e = await own(db, actor, id);
  const v = clean(input, tz);
  const patch: Partial<StaffEvent> = {
    title: v.title,
    notes: v.notes,
    startAt: v.startAt,
    endAt: v.endAt,
    allDay: v.allDay,
    updatedAt: new Date(),
  };
  const connected = (await getCalendarStatus(db, actor.id)).connected;
  if (connected && e.externalEventId) {
    const conference = input.video ? (e.meetUrl ? "keep" : "add") : e.meetUrl ? "remove" : "keep";
    const g = await updateOwnCalendarEvent(db, actor.id, e.externalEventId, google(e.id, v, !!input.video), conference);
    if (g) patch.meetUrl = input.video ? (g.meetUrl ?? e.meetUrl) : null;
  } else if (connected) {
    // Made before the calendar was connected (or Google failed then): add it now.
    const g = await createOwnCalendarEvent(db, actor.id, google(e.id, v, !!input.video));
    if (g) Object.assign(patch, { externalEventId: g.id, meetUrl: g.meetUrl });
  }
  const [row] = await db.update(staffEvents).set(patch).where(eq(staffEvents.id, e.id)).returning();
  return row!;
}

export async function deleteStaffEvent(db: DbOrTx, actor: User, id: string) {
  const e = await own(db, actor, id);
  if (e.externalEventId && (await getCalendarStatus(db, actor.id)).connected) await deleteCalendarEvent(db, actor.id, e.externalEventId);
  await db.delete(staffEvents).where(eq(staffEvents.id, e.id));
  await audit(db, {
    actorId: actor.id,
    action: "event.delete",
    entityType: "user",
    entityId: actor.id,
    details: { eventId: e.id },
  });
}

/** The actor's own events in a period. */
export async function listStaffEvents(db: DbOrTx, actor: User, from: Date, to: Date): Promise<StaffEvent[]> {
  return db
    .select()
    .from(staffEvents)
    .where(and(eq(staffEvents.userId, actor.id), lt(staffEvents.startAt, to), gt(staffEvents.endAt, from)))
    .orderBy(asc(staffEvents.startAt))
    .limit(1000);
}
