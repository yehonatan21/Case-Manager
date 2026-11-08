import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { cleanWeeklyHours, defaultWeeklyHours, freeSlots, meetingIcs, tzOffsetMinutes, zonedDay, zonedToUtc } from "@/lib/meetings";
import { availableSlots, bookMeeting, cancelMeeting, getAvailability, listCaseMeetings, listUpcomingMeetings, meetingIcsFile, rescheduleMeeting, sendMeetingReminders, setAvailability, MAX_CLIENT_UPCOMING } from "@/lib/services/meetings";
import { _resetCalendarTokens, disconnectCalendar, getCalendarStatus, saveCalendarConnection } from "@/lib/services/calendar";
import { assignCase } from "@/lib/services/cases";
import { expectCode, getAdmin, makeCase, makeUser, setupDb } from "./helpers";

let db: Database;
let admin: s.User;
const H = 3600_000;

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
});
afterEach(() => {
  vi.unstubAllGlobals();
  _resetCalendarTokens();
});

/** A case of a fresh client, assigned to a fresh case manager (default hours: Sun–Thu 09–17). */
async function setup() {
  const manager = await makeUser(db, "case_manager");
  const client = await makeUser(db, "customer", { locale: "he" });
  const c = await makeCase(db, client, "Consultation");
  await assignCase(db, admin, c.id, manager.id);
  return { manager, client, c };
}
const notes = (userId: string, type: string) => db.select().from(s.notifications).where(and(eq(s.notifications.userId, userId), eq(s.notifications.type, type), eq(s.notifications.channel, "in_app")));

describe("time zone and free slots", () => {
  it("converts Israel wall-clock times to UTC across daylight saving", () => {
    expect(zonedToUtc("2026-11-05", "09:00").toISOString()).toBe("2026-11-05T07:00:00.000Z");
    expect(zonedToUtc("2026-07-05", "09:00").toISOString()).toBe("2026-07-05T06:00:00.000Z");
    // Clocks go forward on 27 March 2026 at 02:00.
    expect(zonedToUtc("2026-03-27", "03:00").toISOString()).toBe("2026-03-27T00:00:00.000Z");
    expect(tzOffsetMinutes(new Date("2026-01-01T12:00:00Z"))).toBe(120);
    expect(zonedDay(new Date("2026-11-05T22:30:00Z"))).toEqual({ day: "2026-11-06", weekday: 5, time: "00:30" });
  });

  it("offers times inside working hours, after the notice, clear of busy times plus the buffer", () => {
    const slots = freeSlots({
      weekly: defaultWeeklyHours(),
      durationMinutes: 60,
      bufferMinutes: 10,
      earliest: new Date("2026-11-05T08:00:00Z"), // Thu 10:00 Israel
      latest: new Date("2026-11-09T00:00:00Z"),
      busy: [{ start: new Date("2026-11-05T09:00:00Z"), end: new Date("2026-11-05T10:00:00Z") }], // 11:00–12:00
    });
    const local = slots.map((d) => `${zonedDay(d).day} ${zonedDay(d).time}`);
    expect(local[0]).toBe("2026-11-05 12:30");
    expect(local).not.toContain("2026-11-05 10:00");
    expect(local.at(-1)).toBe("2026-11-08 16:00"); // Sunday; nothing on Friday/Saturday
    expect(local.filter((x) => x.startsWith("2026-11-06") || x.startsWith("2026-11-07"))).toEqual([]);
  });

  it("validates working hours", () => {
    expect(cleanWeeklyHours({ "0": [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }] })!["1"]).toEqual([]);
    expect(cleanWeeklyHours({ "0": [{ start: "12:00", end: "09:00" }] })).toBeNull();
    expect(cleanWeeklyHours({ "0": [{ start: "09:00", end: "12:00" }, { start: "11:00", end: "13:00" }] })).toBeNull();
    expect(cleanWeeklyHours({ "0": [{ start: "9am", end: "5pm" }] })).toBeNull();
    expect(cleanWeeklyHours("nope")).toBeNull();
  });

  it("builds an .ics event that updates in place", () => {
    const ics = meetingIcs({ id: "m1", startAt: new Date("2026-11-05T07:00:00Z"), endAt: new Date("2026-11-05T07:30:00Z"), title: "Meeting; with, commas", description: "line1\nline2", location: "Office", url: "https://x/y", sequence: 2, cancelled: false, organizerName: "Acme", host: "example.com" });
    expect(ics).toContain("UID:m1@example.com");
    expect(ics).toContain("DTSTART:20261105T070000Z");
    expect(ics).toContain("SEQUENCE:2");
    expect(ics).toContain("SUMMARY:Meeting\\; with\\, commas");
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });
});

describe("availability", () => {
  it("defaults to bookable working hours for case managers, not for finance; people set their own", async () => {
    const m = await makeUser(db, "case_manager");
    const f = await makeUser(db, "finance");
    expect((await getAvailability(db, m.id)).bookable).toBe(true);
    expect((await getAvailability(db, f.id)).bookable).toBe(false);
    await expectCode(setAvailability(db, m, f.id, { bookable: true, weekly: defaultWeeklyHours() }), "forbidden");
    await expectCode(setAvailability(db, m, m.id, { bookable: true, weekly: { "0": [{ start: "10", end: "11" }] } }), "validation");
    await setAvailability(db, m, m.id, { bookable: false, weekly: defaultWeeklyHours() });
    expect((await getAvailability(db, m.id)).bookable).toBe(false);
  });
});

describe("booking", () => {
  it("the client books a free slot with the case's team member, who is told; the slot is then taken", async () => {
    const { manager, client, c } = await setup();
    const slots = await availableSlots(db, client, c.id, 30);
    expect(slots.length).toBeGreaterThan(10);
    expect(new Set(slots.map((x) => x.staffId))).toEqual(new Set([manager.id]));
    expect(new Date(slots[0]!.start).getTime()).toBeGreaterThan(Date.now() + 11 * H);
    await expectCode(availableSlots(db, client, c.id, 45), "validation");

    const m = await bookMeeting(db, client, c.id, { start: slots[0]!.start, durationMinutes: 30, mode: "video", notes: "Visa options" });
    expect(m).toMatchObject({ staffId: manager.id, clientUserId: client.id, status: "scheduled", mode: "video" });
    expect((await notes(manager.id, "meeting_booked")).length).toBe(1);
    expect((await availableSlots(db, client, c.id, 30)).map((x) => x.start)).not.toContain(slots[0]!.start);
    await expectCode(bookMeeting(db, client, c.id, { start: slots[0]!.start, durationMinutes: 30, mode: "video" }), "meeting_slot_taken");
    // A time that was never offered (e.g. 3am) is refused.
    const night = new Date(new Date(slots[0]!.start).getTime() + 18 * H);
    if (zonedDay(night).time < "09:00" || zonedDay(night).time >= "17:00") await expectCode(bookMeeting(db, client, c.id, { start: night.toISOString(), durationMinutes: 30, mode: "phone" }), "meeting_slot_taken");
    // The client sees it, without internal details.
    const list = await listCaseMeetings(db, client, c.id);
    expect(list[0]).toMatchObject({ id: m.id, staffName: manager.name, notes: "Visa options" });
    // Staff see it on their schedule.
    expect((await listUpcomingMeetings(db, manager)).map((r) => r.m.id)).toContain(m.id);
  });

  it("a client can have a few upcoming meetings per case, not more", async () => {
    const { client, c } = await setup();
    const slots = await availableSlots(db, client, c.id, 30);
    for (let i = 0; i < MAX_CLIENT_UPCOMING; i++) await bookMeeting(db, client, c.id, { start: slots[i * 4]!.start, durationMinutes: 30, mode: "phone" });
    await expectCode(bookMeeting(db, client, c.id, { start: slots[20]!.start, durationMinutes: 30, mode: "phone" }), "meeting_limit");
  });

  it("staff book any free future time, also outside working hours, but not over another meeting", async () => {
    const { manager, client, c } = await setup();
    const evening = zonedToUtc(zonedDay(new Date(Date.now() + 3 * 24 * H)).day, "19:00");
    const m = await bookMeeting(db, manager, c.id, { start: evening.toISOString(), durationMinutes: 45, mode: "office" });
    expect((await notes(client.id, "meeting_booked_for_you")).length).toBe(1);
    await expectCode(bookMeeting(db, manager, c.id, { start: new Date(evening.getTime() + 20 * 60_000).toISOString(), durationMinutes: 30, mode: "phone" }), "meeting_slot_taken");
    await expectCode(bookMeeting(db, manager, c.id, { start: new Date(Date.now() - H).toISOString(), durationMinutes: 30, mode: "phone" }), "meeting_in_past");
    await expectCode(bookMeeting(db, client, c.id, { start: evening.toISOString(), durationMinutes: 30, mode: "phone" }), "meeting_slot_taken");
    // The .ics file is available to both, not to a stranger.
    expect(await meetingIcsFile(db, client, m.id)).toContain("BEGIN:VEVENT");
    await expectCode(meetingIcsFile(db, await makeUser(db, "customer"), m.id), "not_found");
  });

  it("cancelling and moving notify the other side; a cancelled meeting can't be changed", async () => {
    const { manager, client, c } = await setup();
    const slots = await availableSlots(db, client, c.id, 30);
    const m = await bookMeeting(db, client, c.id, { start: slots[0]!.start, durationMinutes: 30, mode: "video" });
    const moved = await rescheduleMeeting(db, client, m.id, slots[6]!.start);
    expect(moved.startAt.toISOString()).toBe(slots[6]!.start);
    expect(moved.sequence).toBe(1);
    expect((await notes(manager.id, "meeting_moved")).length).toBe(1);
    // The old time is free again.
    expect((await availableSlots(db, client, c.id, 30)).map((x) => x.start)).toContain(slots[0]!.start);

    await expectCode(cancelMeeting(db, await makeUser(db, "customer"), m.id), "not_found");
    const done = await cancelMeeting(db, manager, m.id, "Out sick");
    expect(done).toMatchObject({ status: "cancelled", cancelReason: "Out sick", sequence: 2 });
    expect((await notes(client.id, "meeting_cancelled")).length).toBe(1);
    await expectCode(cancelMeeting(db, client, m.id), "conflict");
    await expectCode(rescheduleMeeting(db, client, m.id, slots[8]!.start), "conflict");
    expect(await meetingIcsFile(db, client, m.id)).toContain("METHOD:CANCEL");
  });

  it("reminds both sides the day before and shortly before, once each", async () => {
    const { manager, client, c } = await setup();
    const slots = await availableSlots(db, client, c.id, 30);
    const m = await bookMeeting(db, client, c.id, { start: slots[0]!.start, durationMinutes: 30, mode: "phone" });
    const start = m.startAt.getTime();
    // Other tests' meetings are in the database too, so count this client's and manager's reminders.
    const count = async () => [(await notes(client.id, "meeting_reminder")).length, (await notes(client.id, "meeting_soon")).length, (await notes(manager.id, "meeting_reminder")).length, (await notes(manager.id, "meeting_soon")).length];
    await sendMeetingReminders(db, new Date(start - 40 * H));
    expect(await count()).toEqual([0, 0, 0, 0]);
    await sendMeetingReminders(db, new Date(start - 20 * H));
    expect(await count()).toEqual([1, 0, 1, 0]);
    await sendMeetingReminders(db, new Date(start - 19 * H));
    expect(await count()).toEqual([1, 0, 1, 0]);
    await sendMeetingReminders(db, new Date(start - 60 * 60_000));
    expect(await count()).toEqual([1, 1, 1, 1]);
    await sendMeetingReminders(db, new Date(start - 30 * 60_000));
    expect(await count()).toEqual([1, 1, 1, 1]);
  });
});

describe("Google Calendar", () => {
  /** A stand-in for Google: token refresh, free/busy and events. */
  function fakeGoogle(opts: { busy?: { start: string; end: string }[]; fail?: boolean } = {}) {
    const calls: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        const body = init?.body && typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : String(init?.body ?? "");
        calls.push({ url, method: init?.method ?? "GET", body });
        if (url.includes("oauth2.googleapis.com/token")) return opts.fail ? new Response("invalid_grant", { status: 400 }) : Response.json({ access_token: "at", expires_in: 3600 });
        if (url.endsWith("/freeBusy")) return Response.json({ calendars: { primary: { busy: opts.busy ?? [] } } });
        if (url.includes("/events") && init?.method === "POST") return Response.json({ id: "evt1", hangoutLink: "https://meet.google.com/abc-defg-hij" });
        if (url.includes("/events/") && init?.method === "DELETE") return new Response(null, { status: 204 });
        if (url.includes("/events/") && init?.method === "PATCH") return Response.json({ id: "evt1" });
        if (url.includes("/revoke")) return new Response(null, { status: 200 });
        return new Response("not found", { status: 404 });
      }),
    );
    return calls;
  }

  it("only staff connect, and only with calendar access granted", async () => {
    const client = await makeUser(db, "customer");
    await expectCode(saveCalendarConnection(db, client, { refreshToken: "rt", email: "x@gmail.com", scopesGranted: true }), "forbidden");
    const m = await makeUser(db, "case_manager");
    await expectCode(saveCalendarConnection(db, m, { refreshToken: null, email: "x@gmail.com", scopesGranted: true }), "calendar_not_granted");
    await expectCode(saveCalendarConnection(db, m, { refreshToken: "rt", email: "x@gmail.com", scopesGranted: false }), "calendar_not_granted");
    await saveCalendarConnection(db, m, { refreshToken: "rt-secret", email: "m@gmail.com", scopesGranted: true });
    expect(await getCalendarStatus(db, m.id)).toMatchObject({ connected: true, email: "m@gmail.com" });
    const [row] = await db.select().from(s.calendarConnections).where(eq(s.calendarConnections.userId, m.id));
    expect(row!.enc).not.toContain("rt-secret");
    fakeGoogle();
    await disconnectCalendar(db, m);
    expect((await getCalendarStatus(db, m.id)).connected).toBe(false);
  });

  it("busy times in the calendar aren't offered; a booked video meeting gets an event with a Meet link; cancelling removes it", async () => {
    const { manager, client, c } = await setup();
    await saveCalendarConnection(db, manager, { refreshToken: "rt", email: "m@gmail.com", scopesGranted: true });
    const free = await availableSlots(db, client, c.id, 30);
    const blocked = free[0]!;
    const calls = fakeGoogle({ busy: [{ start: blocked.start, end: blocked.end }] });
    const slots = await availableSlots(db, client, c.id, 30);
    expect(slots.map((x) => x.start)).not.toContain(blocked.start);

    const m = await bookMeeting(db, client, c.id, { start: slots[0]!.start, durationMinutes: 30, mode: "video" });
    expect(m).toMatchObject({ externalEventId: "evt1", meetUrl: "https://meet.google.com/abc-defg-hij" });
    const insert = calls.find((x) => x.method === "POST" && x.url.includes("/events"))!;
    expect(insert.url).toContain("conferenceDataVersion=1");
    expect(insert.body).toMatchObject({ conferenceData: { createRequest: { requestId: m.id } } });
    expect((await listCaseMeetings(db, client, c.id))[0]!.meetUrl).toBe("https://meet.google.com/abc-defg-hij");

    await rescheduleMeeting(db, manager, m.id, slots[5]!.start);
    expect(calls.some((x) => x.method === "PATCH" && x.url.includes("/events/evt1"))).toBe(true);
    await cancelMeeting(db, client, m.id);
    expect(calls.some((x) => x.method === "DELETE" && x.url.includes("/events/evt1"))).toBe(true);
  });

  it("when Google fails, booking still works and the problem is recorded", async () => {
    const { manager, client, c } = await setup();
    await saveCalendarConnection(db, manager, { refreshToken: "rt", email: "m@gmail.com", scopesGranted: true });
    fakeGoogle({ fail: true });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const slots = await availableSlots(db, client, c.id, 30);
    const m = await bookMeeting(db, client, c.id, { start: slots[0]!.start, durationMinutes: 30, mode: "video" });
    spy.mockRestore();
    expect(m.externalEventId).toBeNull();
    expect((await getCalendarStatus(db, manager.id)).lastError).toMatch(/token refresh failed/);
  });
});

describe("the Meetings page calendar", () => {
  it("day, week (from Sunday) and month (whole weeks) ranges, in Israel time", async () => {
    const { calendarRange, parseDay, parseMode } = await import("@/lib/calendar-view");
    expect(parseMode("month")).toBe("month");
    expect(parseMode("year")).toBe("week");
    expect(parseDay("2026-02-30")).not.toBe("2026-02-30");
    const day = calendarRange("day", "2026-11-11");
    expect(day.days).toEqual(["2026-11-11"]);
    expect(day.from.toISOString()).toBe("2026-11-10T22:00:00.000Z");
    expect([day.prev, day.next]).toEqual(["2026-11-10", "2026-11-12"]);
    const week = calendarRange("week", "2026-11-11");
    expect([week.days[0], week.days[6], week.days.length]).toEqual(["2026-11-08", "2026-11-14", 7]);
    const month = calendarRange("month", "2026-11-11");
    // November 2026 starts on a Sunday and ends on a Monday: five weeks.
    expect([month.days[0], month.days.at(-1), month.days.length]).toEqual(["2026-11-01", "2026-12-05", 35]);
    expect([month.prev, month.next]).toEqual(["2026-10-01", "2026-12-01"]);
  });

  it("overlapping items sit side by side; the grid widens to fit early and late items", async () => {
    const { placeDay, gridHours } = await import("@/lib/calendar-view");
    const item = (id: string, start: string, end: string) => ({ id, source: "app" as const, title: id, start, end, allDay: false, href: null, meetUrl: null, staffName: null });
    const placed = placeDay(
      [item("a", "2026-11-11T07:00:00Z", "2026-11-11T08:00:00Z"), item("b", "2026-11-11T07:30:00Z", "2026-11-11T08:30:00Z"), item("c", "2026-11-11T10:00:00Z", "2026-11-11T10:10:00Z"), item("early", "2026-11-11T04:00:00Z", "2026-11-11T04:30:00Z")],
      "2026-11-11",
    );
    const by = Object.fromEntries(placed.map((p) => [p.item.id, p]));
    expect([by.a!.lane, by.b!.lane, by.a!.lanes, by.b!.lanes]).toEqual([0, 1, 2, 2]);
    expect([by.c!.lanes, by.c!.endMin - by.c!.startMin]).toEqual([1, 20]);
    expect(by.a!.startMin).toBe(9 * 60);
    expect(gridHours([placed])).toEqual({ first: 6, last: 20 });
  });

  it("shows the app's meetings and the Google Calendar's other events, each once", async () => {
    const { manager, client, c } = await setup();
    const { calendarItems } = await import("@/lib/services/meetings");
    const slots = await availableSlots(db, client, c.id, 30);
    const m = await bookMeeting(db, client, c.id, { start: slots[0]!.start, durationMinutes: 30, mode: "office" });
    const range = { from: new Date(Date.parse(slots[0]!.start) - 24 * H), to: new Date(Date.parse(slots[0]!.start) + 24 * H) };
    // Not connected: only the meeting.
    let r = await calendarItems(db, manager, range);
    expect(r.google).toBe("off");
    expect(r.items.map((i) => i.source)).toEqual(["app"]);
    expect(r.items[0]).toMatchObject({ id: `m:${m.id}`, href: `/admin/cases/${c.id}?tab=meetings` });

    await saveCalendarConnection(db, manager, { refreshToken: "rt", email: "m@gmail.com", scopesGranted: true });
    const listed: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "at", expires_in: 3600 });
        if (url.includes("/calendars/primary/events?")) {
          listed.push(url);
          return Response.json({
            items: [
              { id: "dentist", summary: "Dentist", htmlLink: "https://calendar.google.com/event?eid=1", start: { dateTime: "2026-11-11T09:00:00+02:00" }, end: { dateTime: "2026-11-11T10:00:00+02:00" } },
              { id: "holiday", summary: "Holiday", start: { date: "2026-11-12" }, end: { date: "2026-11-13" } },
              { id: "ours", summary: "Meeting", start: { dateTime: m.startAt.toISOString() }, end: { dateTime: m.endAt.toISOString() }, extendedProperties: { private: { caseManagerMeetingId: m.id } } },
              { id: "gone", status: "cancelled", start: { dateTime: "2026-11-11T11:00:00Z" }, end: { dateTime: "2026-11-11T12:00:00Z" } },
            ],
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );
    r = await calendarItems(db, manager, range);
    expect(r.google).toBe("ok");
    expect(listed[0]).toContain("singleEvents=true");
    expect(r.items.map((i) => i.id).sort()).toEqual([`m:${m.id}`, "g:dentist", "g:holiday"].sort());
    expect(r.items.find((i) => i.id === "g:holiday")).toMatchObject({ allDay: true, start: "2026-11-11T22:00:00.000Z", end: "2026-11-12T22:00:00.000Z" });
    // Another team member sees neither this manager's meeting nor their calendar.
    const other = await makeUser(db, "case_manager");
    expect((await calendarItems(db, other, range)).items).toEqual([]);
    // Admins asking for the whole team see the meeting, with who it's with.
    expect((await calendarItems(db, admin, { ...range, all: true })).items.find((i) => i.id === `m:${m.id}`)?.staffName).toBe(manager.name);
    await expectCode(calendarItems(db, client, range), "forbidden");

    // When Google fails, the meetings still show.
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => (String(input).includes("token") ? Response.json({ access_token: "at2", expires_in: 3600 }) : new Response("boom", { status: 500 }))));
    _resetCalendarTokens();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    r = await calendarItems(db, manager, range);
    spy.mockRestore();
    expect(r.google).toBe("error");
    expect(r.items.map((i) => i.source)).toEqual(["app"]);
  });
});
