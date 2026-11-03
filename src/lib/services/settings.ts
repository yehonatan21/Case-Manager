import { eq } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { settings, type User } from "../db/schema";
import { DEFAULT_SETTINGS } from "../db/seed";
import { audit } from "./audit";
import { AppError } from "../errors";

export type AppSettings = {
  company: { name: string; email: string; phone: string };
  vat_rate: number;
  currency: string;
  quote_validity_days: number;
  first_response_sla_hours: number;
  intake_question_limit: number;
};

export async function getSettings(db: DbOrTx): Promise<AppSettings> {
  const rows = await db.select().from(settings);
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) merged[r.key] = r.value;
  return merged as AppSettings;
}

export async function updateSettings(db: DbOrTx, actor: User, patch: Partial<AppSettings>) {
  if (actor.role !== "admin") throw new AppError("forbidden");
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    await db
      .insert(settings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  }
  await audit(db, { actorId: actor.id, action: "settings.update", entityType: "settings", details: patch as Record<string, unknown> });
}

export async function getSetting<K extends keyof AppSettings>(db: DbOrTx, key: K): Promise<AppSettings[K]> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return (row?.value ?? DEFAULT_SETTINGS[key]) as AppSettings[K];
}
