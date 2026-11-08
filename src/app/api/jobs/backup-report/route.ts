import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { safeEqual } from "@/lib/crypto";
import { recordBackup } from "@/lib/services/health";

/** The nightly backup workflow reports here (Authorization: Bearer $CRON_SECRET), so System health shows it. */
export const POST = route(async (req) => {
  const auth = req.headers.get("authorization") ?? "";
  if (!env.cronSecret || !safeEqual(auth, `Bearer ${env.cronSecret}`)) throw new AppError("unauthorized");
  const body = await readJson(req, z.object({ createdAt: z.iso.datetime(), bytes: z.number().int().min(0), tables: z.number().int().min(0), rows: z.number().int().min(0), restoreTested: z.boolean() }));
  await recordBackup(await getDb(), body);
  return ok();
});
