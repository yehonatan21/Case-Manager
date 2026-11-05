import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { bookMeeting, listCaseMeetings, MEETING_MODES } from "@/lib/services/meetings";

/** Meetings of a case (client or staff with access). */
export const GET = route<{ id: string }>(async (_req, { id }) => {
  const user = await requireApiUser();
  return ok(await listCaseMeetings(await getDb(), user, id));
});

/** Book a meeting: clients in a free slot; staff at any free time for themselves or a colleague. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiUser();
  const body = await readJson(
    req,
    z.object({
      start: z.iso.datetime({ offset: true }),
      durationMinutes: z.number().int().min(15).max(240),
      mode: z.enum(MEETING_MODES as [string, ...string[]]),
      notes: z.string().max(1000).nullish(),
      staffId: z.uuid().nullish(),
    }),
  );
  const m = await bookMeeting(await getDb(), user, id, { ...body, mode: body.mode as "video" | "phone" | "office" });
  return ok({ id: m.id });
});
