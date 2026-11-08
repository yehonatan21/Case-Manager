/**
 * A team member's Google Calendar, for meetings: busy times are kept out of the bookable slots, and booked
 * meetings become events (with a Google Meet link for video meetings). Calendar problems never block a booking:
 * they're logged and recorded on the connection, and the meeting still works through the app and its .ics file.
 */
import { eq } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { calendarConnections, type User } from "../db/schema";
import { env } from "../env";
import { AppError } from "../errors";
import { decryptBuffer, encryptBuffer } from "../crypto";
import { audit } from "./audit";
import type { Interval } from "../meetings";

export const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const tokenCache = new Map<string, { token: string; until: number }>();

const seal = (v: object) => encryptBuffer(Buffer.from(JSON.stringify(v), "utf8")).toString("base64");
const open = (enc: string) => JSON.parse(decryptBuffer(Buffer.from(enc, "base64")).toString("utf8")) as { refreshToken: string };

export type CalendarStatus = { connected: boolean; email: string | null; connectedAt: Date | null; lastError: string | null };

export async function getCalendarStatus(db: DbOrTx, userId: string): Promise<CalendarStatus> {
  const [c] = await db.select().from(calendarConnections).where(eq(calendarConnections.userId, userId));
  return { connected: !!c, email: c?.accountEmail ?? null, connectedAt: c?.connectedAt ?? null, lastError: c?.lastError ?? null };
}

/** After Google's consent screen. Without a refresh token (access refused or not granted) nothing is saved. */
export async function saveCalendarConnection(db: DbOrTx, user: Pick<User, "id" | "role">, input: { refreshToken: string | null; email: string; scopesGranted: boolean }) {
  if (user.role === "customer") throw new AppError("forbidden");
  if (!input.refreshToken || !input.scopesGranted) throw new AppError("calendar_not_granted");
  const enc = seal({ refreshToken: input.refreshToken });
  await db
    .insert(calendarConnections)
    .values({ userId: user.id, provider: "google", enc, accountEmail: input.email, connectedAt: new Date(), lastError: null })
    .onConflictDoUpdate({ target: calendarConnections.userId, set: { enc, accountEmail: input.email, connectedAt: new Date(), lastError: null } });
  tokenCache.delete(user.id);
  await audit(db, { actorId: user.id, action: "calendar.connect", entityType: "user", entityId: user.id, details: { provider: "google" } });
}

export async function disconnectCalendar(db: DbOrTx, user: Pick<User, "id">) {
  const [c] = await db.select().from(calendarConnections).where(eq(calendarConnections.userId, user.id));
  if (!c) return;
  await db.delete(calendarConnections).where(eq(calendarConnections.userId, user.id));
  tokenCache.delete(user.id);
  // Best effort: also revoke the app's access at Google.
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(open(c.enc).refreshToken)}`, { method: "POST", signal: AbortSignal.timeout(5000) });
  } catch {}
  await audit(db, { actorId: user.id, action: "calendar.disconnect", entityType: "user", entityId: user.id });
}

async function recordError(db: DbOrTx, userId: string, message: string) {
  console.error("[calendar]", message);
  await db.update(calendarConnections).set({ lastError: message.slice(0, 300) }).where(eq(calendarConnections.userId, userId));
}

/** A fresh access token for the user's calendar, or null when not connected (or Google refused). */
async function accessToken(db: DbOrTx, userId: string): Promise<string | null> {
  const cached = tokenCache.get(userId);
  if (cached && cached.until > Date.now()) return cached.token;
  const [c] = await db.select().from(calendarConnections).where(eq(calendarConnections.userId, userId));
  if (!c) return null;
  let refreshToken: string;
  try {
    refreshToken = open(c.enc).refreshToken;
  } catch {
    await recordError(db, userId, "stored calendar token can't be decrypted (APP_SECRET changed?)");
    return null;
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.googleClientId, client_secret: env.googleClientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(10_000),
  }).catch((e: Error) => e);
  if (res instanceof Error || !res.ok) {
    const detail = res instanceof Error ? res.message : `${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`;
    await recordError(db, userId, `token refresh failed: ${detail}`);
    return null;
  }
  const t = (await res.json()) as { access_token: string; expires_in?: number };
  tokenCache.set(userId, { token: t.access_token, until: Date.now() + ((t.expires_in ?? 3600) - 60) * 1000 });
  if (c.lastError) await db.update(calendarConnections).set({ lastError: null }).where(eq(calendarConnections.userId, userId));
  return t.access_token;
}

async function call<T>(db: DbOrTx, userId: string, path: string, init: RequestInit = {}): Promise<T | null> {
  const token = await accessToken(db, userId);
  if (!token) return null;
  const res = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    signal: AbortSignal.timeout(10_000),
  }).catch((e: Error) => e);
  if (res instanceof Error) {
    await recordError(db, userId, `calendar unreachable: ${res.message}`);
    return null;
  }
  if (res.status === 204 || res.status === 410) return {} as T;
  if (!res.ok) {
    await recordError(db, userId, `calendar ${init.method ?? "GET"} ${path.split("?")[0]} failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
    return null;
  }
  return (await res.json()) as T;
}

/** Busy times in the user's primary calendar (empty when not connected or unavailable). */
export async function calendarBusy(db: DbOrTx, userId: string, from: Date, to: Date): Promise<Interval[]> {
  const r = await call<{ calendars?: Record<string, { busy?: { start: string; end: string }[] }> }>(db, userId, "/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }] }),
  });
  return (r?.calendars?.primary?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

export type GoogleEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  /** YYYY-MM-DD of an all-day event's first day, and of the day after its last. */
  startDay: string | null;
  endDay: string | null;
  htmlLink: string | null;
  meetUrl: string | null;
  /** Set on events the app created for its own meetings. */
  meetingId: string | null;
};

type RawEvent = {
  id: string;
  status?: string;
  summary?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: { caseManagerMeetingId?: string } };
};

/**
 * Events in the user's primary calendar between two instants (recurring events expanded), or null when the
 * calendar isn't connected or Google can't be reached. Cancelled events are left out.
 */
export async function listCalendarEvents(db: DbOrTx, userId: string, from: Date, to: Date): Promise<GoogleEvent[] | null> {
  const out: GoogleEvent[] = [];
  let pageToken: string | undefined;
  // A few pages at most (250 events each): a month of even a very busy calendar.
  for (let page = 0; page < 4; page++) {
    const q = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
      fields: "nextPageToken,items(id,status,summary,htmlLink,hangoutLink,start,end,extendedProperties/private)",
      ...(pageToken ? { pageToken } : {}),
    });
    const r = await call<{ items?: RawEvent[]; nextPageToken?: string }>(db, userId, `/calendars/primary/events?${q}`);
    if (!r) return page === 0 ? null : out;
    for (const e of r.items ?? []) {
      if (e.status === "cancelled" || !e.start || !e.end) continue;
      const allDay = !e.start.dateTime && !!e.start.date;
      const start = e.start.dateTime ?? e.start.date;
      const end = e.end.dateTime ?? e.end.date;
      if (!start || !end) continue;
      out.push({
        id: e.id,
        title: e.summary?.trim() ?? "",
        start,
        end,
        allDay,
        startDay: allDay ? e.start.date! : null,
        endDay: allDay ? (e.end.date ?? null) : null,
        htmlLink: e.htmlLink?.startsWith("https://") ? e.htmlLink : null,
        meetUrl: e.hangoutLink?.startsWith("https://") ? e.hangoutLink : null,
        meetingId: e.extendedProperties?.private?.caseManagerMeetingId ?? null,
      });
    }
    if (!r.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  return out;
}

export type CalendarEventInput ={ meetingId: string; title: string; description: string; start: Date; end: Date; location: string | null; video: boolean };

/** Adds the meeting to the user's calendar; returns the event id and Meet link, or null. */
export async function createCalendarEvent(db: DbOrTx, userId: string, e: CalendarEventInput): Promise<{ id: string; meetUrl: string | null } | null> {
  const body = {
    summary: e.title,
    description: e.description,
    start: { dateTime: e.start.toISOString() },
    end: { dateTime: e.end.toISOString() },
    ...(e.location ? { location: e.location } : {}),
    // The same id for retries, so a meeting never becomes two events.
    ...(e.video ? { conferenceData: { createRequest: { requestId: e.meetingId, conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
    extendedProperties: { private: { caseManagerMeetingId: e.meetingId } },
    reminders: { useDefault: true },
  };
  const r = await call<{ id: string; hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] } }>(
    db,
    userId,
    `/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none`,
    { method: "POST", body: JSON.stringify(body) },
  );
  if (!r?.id) return null;
  const meetUrl = r.hangoutLink ?? r.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? null;
  return { id: r.id, meetUrl };
}

export async function moveCalendarEvent(db: DbOrTx, userId: string, eventId: string, start: Date, end: Date) {
  await call(db, userId, `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=none`, {
    method: "PATCH",
    body: JSON.stringify({ start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } }),
  });
}

export async function deleteCalendarEvent(db: DbOrTx, userId: string, eventId: string) {
  await call(db, userId, `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=none`, { method: "DELETE" });
}

/** For tests: forget cached access tokens. */
export function _resetCalendarTokens() {
  tokenCache.clear();
}
