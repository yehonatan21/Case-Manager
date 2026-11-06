import { asc, eq } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { priceListItems, serviceTemplates, type ServiceTemplateDocument, type ServiceTemplateStage, type ServiceTemplateTask, type User } from "../db/schema";
import { AppError } from "../errors";
import { audit } from "./audit";
import { normalizeCategory } from "../domain";

const adminOnly = (u: User) => {
  if (u.role !== "admin") throw new AppError("forbidden");
};

export async function listTemplates(db: DbOrTx, activeOnly = false) {
  const rows = await db.select().from(serviceTemplates).orderBy(asc(serviceTemplates.name));
  return activeOnly ? rows.filter((r) => r.active) : rows;
}

export async function listPriceList(db: DbOrTx, activeOnly = false) {
  const rows = await db.select().from(priceListItems).orderBy(asc(priceListItems.code));
  return activeOnly ? rows.filter((r) => r.active) : rows;
}

export async function upsertTemplate(
  db: DbOrTx,
  actor: User,
  input: { id?: string; name: string; category: string; description?: string; tasks: ServiceTemplateTask[]; documents?: ServiceTemplateDocument[]; stages?: ServiceTemplateStage[]; active?: boolean },
) {
  adminOnly(actor);
  const values = {
    name: input.name.trim(),
    category: normalizeCategory(input.category),
    description: input.description?.trim() ?? "",
    tasks: input.tasks
      .filter((t) => t.title.trim())
      // A stage must exist, and a task may only wait for one listed before it.
      .map((t, i) => ({ ...t, stage: t.stage != null && t.stage < (input.stages?.length ?? 0) ? t.stage : undefined, after: t.after != null && t.after < i ? t.after : undefined })),
    ...(input.stages ? { stages: input.stages.map((s) => ({ title: s.title.trim(), dueInDays: s.dueInDays, clientVisible: s.clientVisible ?? true })).filter((s) => s.title) } : {}),
    // Keep the existing checklist when a caller doesn't send one.
    ...(input.documents ? { documents: input.documents.map((x) => ({ title: x.title.trim(), note: x.note?.trim() || undefined, required: x.required ?? true })).filter((x) => x.title) } : {}),
    active: input.active ?? true,
    updatedAt: new Date(),
  };
  const [row] = input.id
    ? await db.update(serviceTemplates).set(values).where(eq(serviceTemplates.id, input.id)).returning()
    : await db.insert(serviceTemplates).values(values).returning();
  if (!row) throw new AppError("not_found");
  await audit(db, { actorId: actor.id, action: input.id ? "template.update" : "template.create", entityType: "service_template", entityId: row.id });
  return row;
}

export async function deleteTemplate(db: DbOrTx, actor: User, id: string) {
  adminOnly(actor);
  await db.delete(serviceTemplates).where(eq(serviceTemplates.id, id));
  await audit(db, { actorId: actor.id, action: "template.delete", entityType: "service_template", entityId: id });
}

export async function upsertPriceItem(
  db: DbOrTx,
  actor: User,
  input: { id?: string; code: string; name: string; category: string; unitPriceCents: number; currency: string; active?: boolean },
) {
  adminOnly(actor);
  const values = {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    category: normalizeCategory(input.category),
    unitPriceCents: Math.max(0, Math.round(input.unitPriceCents)),
    currency: input.currency.toUpperCase(),
    active: input.active ?? true,
  };
  try {
    const [row] = input.id
      ? await db.update(priceListItems).set(values).where(eq(priceListItems.id, input.id)).returning()
      : await db.insert(priceListItems).values(values).returning();
    if (!row) throw new AppError("not_found");
    await audit(db, { actorId: actor.id, action: "price.upsert", entityType: "price_list_item", entityId: row.id, details: values });
    return row;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("conflict", "Duplicate code");
  }
}
