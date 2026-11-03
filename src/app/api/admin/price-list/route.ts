import { route, readJson, ok } from "@/lib/api";
import { PriceBody } from "../_schemas";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { upsertPriceItem } from "@/lib/services/catalog";


export const POST = route(async (req) => {
  const user = await requireApiStaff();
  const body = await readJson(req, PriceBody);
  const p = await upsertPriceItem(await getDb(), user, body);
  return ok({ id: p.id });
});
