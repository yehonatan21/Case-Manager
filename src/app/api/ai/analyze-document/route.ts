import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { copilotAnalyzeDocument } from "@/lib/services/copilot";
import { getLocale } from "@/lib/i18n/server";

export const POST = route(async (req) => {
  const user = await requireApiStaff();
  const { documentId } = await readJson(req, z.object({ documentId: z.uuid() }));
  return ok(await copilotAnalyzeDocument(await getDb(), user, documentId, await getLocale()));
});

/** AI calls can take a while; allow up to a minute on serverless hosts. */
export const maxDuration = 60;
