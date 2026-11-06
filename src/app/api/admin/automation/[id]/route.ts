import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { deleteRule, updateRule, type RuleInput } from "@/lib/services/automation";
import { RuleBody } from "../_schema";

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  const body = (await readJson(req, RuleBody)) as RuleInput;
  return ok(await updateRule(await getDb(), user, id, body));
});

export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  const user = await requireApiStaff();
  await deleteRule(await getDb(), user, id);
  return ok();
});
