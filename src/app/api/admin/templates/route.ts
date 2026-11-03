import { route, readJson, ok } from "@/lib/api";
import { TemplateBody } from "../_schemas";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { upsertTemplate } from "@/lib/services/catalog";


export const POST = route(async (req) => {
  const user = await requireApiStaff();
  const body = await readJson(req, TemplateBody);
  const t = await upsertTemplate(await getDb(), user, body);
  return ok({ id: t.id });
});
