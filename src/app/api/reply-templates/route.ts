import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { createReplyTemplate, listReplyTemplates } from "@/lib/services/conversations";

const Body = z.object({ title: z.string().trim().min(1).max(120), bodyHe: z.string().max(4000), bodyEn: z.string().max(4000) });

export const GET = route(async () => {
  await requireApiStaff();
  return ok(await listReplyTemplates(await getDb()));
});

export const POST = route(async (req) => {
  const user = await requireApiStaff();
  return ok(await createReplyTemplate(await getDb(), user, await readJson(req, Body)));
});
