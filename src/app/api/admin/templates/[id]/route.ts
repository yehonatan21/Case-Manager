import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { deleteTemplate, upsertTemplate } from "@/lib/services/catalog";
import { TemplateBody } from "../../_schemas";

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  const body = await readJson(req, TemplateBody);
  await upsertTemplate(await getDb(), user, { ...body, id });
  return ok();
});

export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  const user = await requireApiStaff();
  await deleteTemplate(await getDb(), user, id);
  return ok();
});
