import { cookies } from "next/headers";
import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { updateProfile } from "@/lib/services/users";
import { setWhatsAppOptIn } from "@/lib/services/whatsapp";
import { LOCALE_COOKIE } from "@/lib/i18n/config";

export const PATCH = route(async (req) => {
  const user = await requireApiUser();
  const body = await readJson(
    req,
    z.object({
      name: z.string().min(1).max(120).optional(),
      phone: z.string().max(40).nullable().optional(),
      locale: z.enum(["he", "en"]).optional(),
      emailNotifications: z.boolean().optional(),
      whatsapp: z.boolean().optional(),
      aiConsent: z.boolean().optional(),
    }),
  );
  const db = await getDb();
  // WhatsApp first: a refused opt-in (no valid mobile number) saves nothing.
  if (body.whatsapp !== undefined || (body.phone !== undefined && user.whatsappOptInAt)) {
    await setWhatsAppOptIn(db, user, { optIn: body.whatsapp ?? true, phone: body.phone !== undefined ? body.phone : user.phone });
  }
  await updateProfile(db, user, body);
  if (body.locale) (await cookies()).set(LOCALE_COOKIE, body.locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return ok();
});
