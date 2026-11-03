import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { copilotQuoteDraft } from "@/lib/services/copilot";
import { getLocale } from "@/lib/i18n/server";

export const POST = route(async (req) => {
  const user = await requireApiStaff();
  const { caseId } = await readJson(req, z.object({ caseId: z.uuid() }));
  return ok(await copilotQuoteDraft(await getDb(), user, caseId, await getLocale()));
});
