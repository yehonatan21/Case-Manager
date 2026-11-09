import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { connectEmail, disconnectEmail, getEmailStatus, sendTestEmail } from "@/lib/services/email";

/**
 * Admin: the email service (GET); connect — a test email is sent to the admin, then the details are stored
 * encrypted (PUT); send a test email (POST); disconnect (DELETE).
 */
export const GET = route(async () => {
  const user = await requireApiStaff();
  if (user.role !== "admin") throw new AppError("forbidden");
  return ok(await getEmailStatus(await getDb()));
});

export const PUT = route(async (req) => {
  const user = await requireApiStaff();
  const body = await readJson(
    req,
    z.object({
      provider: z.enum(["smtp", "resend"]),
      host: z.string().max(253).optional(),
      port: z.number().int().min(1).max(65535).optional(),
      secure: z.boolean().optional(),
      username: z.string().max(200).optional(),
      password: z.string().max(500).optional(),
      apiKey: z.string().max(300).optional(),
      fromAddress: z.string().max(254),
      fromName: z.string().max(120).nullable().optional(),
    }),
  );
  const db = await getDb();
  await connectEmail(db, user, body);
  return ok(await getEmailStatus(db));
});

export const POST = route(async () => {
  const user = await requireApiStaff();
  await sendTestEmail(await getDb(), user);
  return ok({ sent: true });
});

export const DELETE = route(async () => {
  const user = await requireApiStaff();
  const db = await getDb();
  await disconnectEmail(db, user);
  return ok(await getEmailStatus(db));
});
