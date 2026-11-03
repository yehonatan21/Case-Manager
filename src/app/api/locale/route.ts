import { cookies } from "next/headers";
import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { LOCALE_COOKIE } from "@/lib/i18n/config";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { updateProfile } from "@/lib/services/users";

export const POST = route(async (req) => {
  const { locale } = await readJson(req, z.object({ locale: z.enum(["he", "en"]) }));
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  const user = await getCurrentUser();
  if (user) await updateProfile(await getDb(), user, { locale });
  return ok({ locale });
});
