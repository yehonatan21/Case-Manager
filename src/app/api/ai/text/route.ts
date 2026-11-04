import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { copilotText } from "@/lib/services/copilot";
import { getLocale } from "@/lib/i18n/server";

export const POST = route(async (req) => {
  const user = await requireApiStaff();
  const body = await readJson(
    req,
    z.object({
      caseId: z.uuid(),
      tool: z.enum(["clarify_questions", "professional", "shorten", "translate", "summarize_thread", "status_update"]),
      input: z.string().max(10000).default(""),
      targetLang: z.enum(["he", "en"]).optional(),
    }),
  );
  return ok(await copilotText(await getDb(), user, body.caseId, body.tool, body.input, await getLocale(), body.targetLang));
});

/** AI calls can take a while; allow up to a minute on serverless hosts. */
export const maxDuration = 60;
