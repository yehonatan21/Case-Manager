import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { deleteDraftQuote, updateDraftQuote } from "@/lib/services/quotes";

const Body = z.object({
  serviceName: z.string().max(300),
  scope: z.string().max(10000),
  included: z.string().max(5000),
  excluded: z.string().max(5000),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  taxRate: z.number().min(0).max(100),
  pricesIncludeTax: z.boolean(),
  paymentTerms: z.string().max(2000),
  timeline: z.string().max(2000),
  terms: z.string().max(5000),
  validUntil: z.iso.date().nullable(),
  aiRunId: z.uuid().nullish(),
  items: z
    .array(
      z.object({
        description: z.string().min(1).max(500),
        quantity: z.number().positive().max(100000),
        unitPriceCents: z.number().int().min(0).max(1_000_000_000),
        priceListItemId: z.uuid().nullish(),
      }),
    )
    .max(50),
});

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  const body = await readJson(req, Body);
  const q = await updateDraftQuote(await getDb(), user, id, body);
  return ok({ id: q.id, totalCents: q.totalCents });
});

export const DELETE = route<{ id: string }>(async (_req, { id }) => {
  const user = await requireApiStaff();
  await deleteDraftQuote(await getDb(), user, id);
  return ok();
});
