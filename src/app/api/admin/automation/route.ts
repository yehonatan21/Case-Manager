import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { createRule, listRules, type RuleInput } from "@/lib/services/automation";
import { RuleBody } from "./_schema";

export const GET = route(async () => {
  const user = await requireApiStaff();
  if (user.role !== "admin") throw new AppError("forbidden");
  return ok(await listRules(await getDb()));
});

export const POST = route(async (req) => {
  const user = await requireApiStaff();
  const body = (await readJson(req, RuleBody)) as RuleInput;
  return ok(await createRule(await getDb(), user, body));
});
