import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requestLoginCode } from "@/lib/services/auth";
import { clientIp } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/server";

export const POST = route(async (req) => {
  const { email, purpose } = await readJson(req, z.object({ email: z.email().max(200), purpose: z.enum(["login", "signup"]).default("signup") }));
  const res = await requestLoginCode(await getDb(), { email, purpose, ip: await clientIp(), locale: await getLocale() });
  return ok(res);
});
