import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { upsertPriceItem } from "@/lib/services/catalog";
import { PriceBody } from "../../_schemas";

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  const body = await readJson(req, PriceBody);
  await upsertPriceItem(await getDb(), user, { ...body, id });
  return ok();
});
