import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { globalSearch } from "@/lib/services/global-search";

/** The staff search (Ctrl/⌘+K): GET ?q= → { hits }, only what the user may see. */
export const GET = route(async (req) => {
  const user = await requireApiStaff();
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return ok({ hits: await globalSearch(await getDb(), user, q) });
});
