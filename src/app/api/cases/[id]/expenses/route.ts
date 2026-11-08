import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { addExpense } from "@/lib/services/time";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  const body = await readJson(req, z.object({ description: z.string().trim().min(1).max(300), amountCents: z.number().int().min(1).max(100_000_000), date: z.iso.date(), currency: z.string().regex(/^[A-Z]{3}$/).optional() }));
  return ok(await addExpense(await getDb(), user, id, body));
});
