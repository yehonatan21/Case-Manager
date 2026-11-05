import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { cancelMeeting, rescheduleMeeting } from "@/lib/services/meetings";
import { AppError } from "@/lib/errors";

/** Move a meeting to another free time. */
export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiUser();
  const body = await readJson(req, z.object({ start: z.iso.datetime({ offset: true }) }));
  const m = await rescheduleMeeting(await getDb(), user, id, body.start);
  return ok({ id: m.id, startAt: m.startAt });
});

/** Cancel a meeting (either side). */
export const DELETE = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiUser();
  // The reason is optional, and so is the body.
  const text = await req.text();
  let json: unknown = {};
  try {
    json = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new AppError("validation");
  }
  const parsed = z.object({ reason: z.string().max(500).nullish() }).safeParse(json);
  if (!parsed.success) throw new AppError("validation");
  await cancelMeeting(await getDb(), user, id, parsed.data.reason ?? null);
  return ok();
});
