/**
 * Service types: the built-in ones (SERVICE_CATEGORIES, labelled in the dictionaries) plus custom ones stored in
 * `service_categories` — added by an admin, or created by the intake AI when no existing type fits a request.
 */
import { asc, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { serviceCategories, type User } from "../db/schema";
import { SERVICE_CATEGORIES } from "../domain";
import { dictionaries } from "../i18n/dictionaries";
import { AppError } from "../errors";
import { audit } from "./audit";

export type CategoryInfo = { key: string; he: string; en: string; builtIn: boolean; active: boolean; createdByAi: boolean };

/** Custom types kept at most (protects the list from a runaway assistant). */
export const MAX_CUSTOM_CATEGORIES = 60;

const builtIns = (): CategoryInfo[] =>
  SERVICE_CATEGORIES.map((key) => ({ key, he: dictionaries.he.categories[key], en: dictionaries.en.categories[key], builtIn: true, active: true, createdByAi: false }));

export async function listServiceCategories(db: DbOrTx, opts: { includeInactive?: boolean } = {}): Promise<CategoryInfo[]> {
  const rows = await db.select().from(serviceCategories).orderBy(asc(serviceCategories.createdAt));
  const custom = rows
    .filter((r) => opts.includeInactive || r.active)
    .map((r) => ({ key: r.key, he: r.nameHe, en: r.nameEn, builtIn: false, active: r.active, createdByAi: r.createdByAi }));
  // "other" stays last.
  const b = builtIns();
  return [...b.filter((c) => c.key !== "other"), ...custom, ...b.filter((c) => c.key === "other")];
}

/** A known, active type's key; anything else becomes "other". */
export async function resolveCategory(db: DbOrTx, key: string | null | undefined): Promise<string> {
  if (!key) return "other";
  if ((SERVICE_CATEGORIES as readonly string[]).includes(key)) return key;
  const [row] = await db.select({ key: serviceCategories.key, active: serviceCategories.active }).from(serviceCategories).where(eq(serviceCategories.key, key));
  return row?.active ? row.key : "other";
}

export async function isKnownCategory(db: DbOrTx, key: string | null | undefined) {
  return !!key && key !== "other" && (await resolveCategory(db, key)) === key;
}

/** Lowercase, no punctuation or Hebrew prefixes like "ה", so "Insurance claims" / "תביעות ביטוח" compare equal to near-duplicates. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .map((w) => (w.length > 3 && w.startsWith("ה") ? w.slice(1) : w))
    .map((w) => (w.length > 3 && /s$/.test(w) ? w.slice(0, -1) : w))
    .join(" ");

const slug = (en: string) =>
  en
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

function cleanName(s: string | null | undefined, max = 60) {
  const t = (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return t.length >= 2 && /\p{L}/u.test(t) ? t : null;
}

/** An existing type with the same name (in either language), active or not. */
async function findByName(db: DbOrTx, he: string | null, en: string | null) {
  const all = await listServiceCategories(db, { includeInactive: true });
  const names = [he, en].filter(Boolean).map((x) => norm(x!));
  return all.find((c) => names.includes(norm(c.he)) || names.includes(norm(c.en))) ?? null;
}

async function insertCategory(db: DbOrTx, he: string, en: string, createdByAi: boolean, createdById: string | null) {
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(serviceCategories);
  if (n >= MAX_CUSTOM_CATEGORIES) return null;
  const base = slug(en) || "service";
  let key = /^[a-z]/.test(base) ? base : `service_${base}`;
  for (let i = 2; (SERVICE_CATEGORIES as readonly string[]).includes(key) || (await db.select({ k: serviceCategories.key }).from(serviceCategories).where(eq(serviceCategories.key, key))).length; i++) {
    key = `${base}_${i}`;
  }
  const [row] = await db.insert(serviceCategories).values({ key, nameHe: he, nameEn: en, createdByAi, createdById }).onConflictDoNothing().returning();
  return row ?? null;
}

/**
 * The intake assistant found no fitting type and proposed one: reuse a type with the same name if there is one
 * (reactivating nothing an admin hid), otherwise create it. Returns the key to use, or "other".
 */
export async function categoryFromProposal(db: DbOrTx, proposal: { name_he?: string | null; name_en?: string | null } | null | undefined): Promise<string> {
  if (!proposal) return "other";
  const he = cleanName(proposal.name_he);
  const en = cleanName(proposal.name_en);
  if (!he && !en) return "other";
  const existing = await findByName(db, he, en);
  if (existing) return existing.active ? existing.key : "other";
  const row = await insertCategory(db, he ?? en!, en ?? he!, true, null);
  return row?.key ?? "other";
}

/** Admin: add a service type. */
export async function createCategory(db: DbOrTx, actor: User, input: { nameHe: string; nameEn: string }) {
  if (actor.role !== "admin") throw new AppError("forbidden");
  const he = cleanName(input.nameHe);
  const en = cleanName(input.nameEn);
  if (!he || !en) throw new AppError("validation");
  if (await findByName(db, he, en)) throw new AppError("category_exists");
  const row = await insertCategory(db, he, en, false, actor.id);
  if (!row) throw new AppError("validation", "Too many service types");
  await audit(db, { actorId: actor.id, action: "category.create", entityType: "service_category", details: { key: row.key } });
  return row;
}

/** Admin: rename or hide/show a custom service type (built-in ones are fixed). */
export async function updateCategory(db: DbOrTx, actor: User, key: string, patch: { nameHe?: string; nameEn?: string; active?: boolean }) {
  if (actor.role !== "admin") throw new AppError("forbidden");
  const [row] = await db.select().from(serviceCategories).where(eq(serviceCategories.key, key));
  if (!row) throw new AppError("not_found");
  const set: Partial<typeof serviceCategories.$inferInsert> = {};
  if (patch.nameHe !== undefined) {
    const v = cleanName(patch.nameHe);
    if (!v) throw new AppError("validation");
    set.nameHe = v;
  }
  if (patch.nameEn !== undefined) {
    const v = cleanName(patch.nameEn);
    if (!v) throw new AppError("validation");
    set.nameEn = v;
  }
  if (patch.active !== undefined) set.active = patch.active;
  if (Object.keys(set).length === 0) return row;
  const [updated] = await db.update(serviceCategories).set(set).where(eq(serviceCategories.key, key)).returning();
  await audit(db, { actorId: actor.id, action: "category.update", entityType: "service_category", details: { key, ...patch } });
  return updated!;
}

/** For prompts: "key — English / Hebrew" lines of the active types. */
export async function categoriesForPrompt(db: DbOrTx) {
  return (await listServiceCategories(db)).map((c) => `${c.key} — ${c.en} / ${c.he}`).join("\n");
}
