import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { verifyLoginCode } from "@/lib/services/auth";
import { clientIp, createSession } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/server";
import { isStaffRole } from "@/lib/domain";
import { needsSecondStep } from "@/lib/services/two-factor";

const Body = z.object({
  email: z.email().max(200),
  code: z.string().regex(/^\d{6}$/),
  signup: z
    .object({
      name: z.string().min(1).max(120),
      phone: z.string().max(40).nullish(),
      customerType: z.enum(["private", "business", "company", "other"]),
      organizationName: z.string().max(200).nullish(),
      organizationNumber: z.string().max(40).nullish(),
      acceptTerms: z.boolean(),
      aiConsent: z.boolean(),
    })
    .nullish(),
});

export const POST = route(async (req) => {
  const body = await readJson(req, Body);
  const { user, created } = await verifyLoginCode(await getDb(), { ...body, ip: await clientIp(), locale: await getLocale() });
  // Staff with two-step sign-in on: the session waits for the code from their authenticator app.
  const second = needsSecondStep(user);
  await createSession(user.id, { mfaPending: second });
  return ok({ created, role: user.role, home: isStaffRole(user.role) ? "/admin" : "/portal", secondStep: second });
});
