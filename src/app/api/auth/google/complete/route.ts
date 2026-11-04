import { cookies } from "next/headers";
import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/server";
import { GOOGLE_SIGNUP_COOKIE, completeGoogleSignup } from "@/lib/services/google";

/** Creates the customer account for a new Google sign-in once terms are accepted. */
export const POST = route(async (req) => {
  const body = await readJson(
    req,
    z.object({
      name: z.string().max(120),
      phone: z.string().max(40).nullish(),
      customerType: z.enum(["private", "business", "company", "other"]),
      organizationName: z.string().max(200).nullish(),
      organizationNumber: z.string().max(40).nullish(),
      acceptTerms: z.boolean(),
      aiConsent: z.boolean(),
    }),
  );
  const jar = await cookies();
  const user = await completeGoogleSignup(await getDb(), jar.get(GOOGLE_SIGNUP_COOKIE)?.value, { ...body, locale: await getLocale() });
  jar.delete(GOOGLE_SIGNUP_COOKIE);
  await createSession(user.id);
  return ok({ home: "/portal" });
});
