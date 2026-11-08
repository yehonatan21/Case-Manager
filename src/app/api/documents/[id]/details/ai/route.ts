import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/server";
import { fillDocumentDetailsFromAi } from "@/lib/services/copilot";

/** AI suggests the details (for a person to confirm); null when it couldn't read them. */
export const POST = route<{ id: string }>(async (_req, { id }) => {
  const user = await requireApiStaff();
  return ok({ details: await fillDocumentDetailsFromAi(await getDb(), user, id, await getLocale()) });
});
