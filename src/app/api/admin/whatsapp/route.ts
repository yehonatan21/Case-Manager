import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { connectWhatsApp, disconnectWhatsApp, getWhatsAppStatus } from "@/lib/services/whatsapp";

const Lang = z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/);
const Body = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/),
  accessToken: z.string().trim().min(20).max(1000),
  appSecret: z.string().trim().regex(/^[A-Za-z0-9]{16,64}$/),
  template: z.string().trim().regex(/^[a-z0-9_]{1,512}$/),
  templateLanguages: z.object({ he: Lang, en: Lang }),
});

/** Admin: WhatsApp connection status (GET), connect — credentials are checked, then stored encrypted (PUT), disconnect (DELETE). */
export const GET = route(async () => {
  const user = await requireApiStaff();
  if (user.role !== "admin") throw new AppError("forbidden");
  return ok(await getWhatsAppStatus(await getDb()));
});

export const PUT = route(async (req) => {
  const user = await requireApiStaff();
  const body = await readJson(req, Body);
  const db = await getDb();
  await connectWhatsApp(db, user, body);
  return ok(await getWhatsAppStatus(db));
});

export const DELETE = route(async () => {
  const user = await requireApiStaff();
  const db = await getDb();
  await disconnectWhatsApp(db, user);
  return ok(await getWhatsAppStatus(db));
});
