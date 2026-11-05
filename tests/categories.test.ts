import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { env } from "@/lib/env";
import { categoryFromProposal, createCategory, listServiceCategories, resolveCategory, updateCategory, MAX_CUSTOM_CATEGORIES } from "@/lib/services/categories";
import { createIntake } from "@/lib/services/intake";
import { submitIntakeAsCase, updateCaseFields, getCaseRow } from "@/lib/services/cases";
import { createCustomerAccount, updateProfile } from "@/lib/services/users";
import { expectCode, getAdmin, makeCase, makeUser, setupDb } from "./helpers";

let db: Database;
let admin: s.User;

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
});

describe("service types", () => {
  it("lists the built-in types with 'other' last; unknown and hidden types resolve to 'other'", async () => {
    const list = await listServiceCategories(db);
    expect(list.at(-1)!.key).toBe("other");
    expect(list.find((c) => c.key === "immigration_visa")).toMatchObject({ builtIn: true, he: expect.any(String), en: expect.any(String) });
    expect(await resolveCategory(db, "immigration_visa")).toBe("immigration_visa");
    expect(await resolveCategory(db, "made_up")).toBe("other");
    expect(await resolveCategory(db, null)).toBe("other");
  });

  it("the assistant's proposal creates a type once; the same name in either language, or a near variant, reuses it", async () => {
    const key = await categoryFromProposal(db, { name_he: "תביעות ביטוח", name_en: "Insurance claims" });
    expect(key).toBe("insurance_claims");
    const [row] = await db.select().from(s.serviceCategories).where(eq(s.serviceCategories.key, key));
    expect(row).toMatchObject({ nameHe: "תביעות ביטוח", nameEn: "Insurance claims", createdByAi: true, active: true });
    expect(await categoryFromProposal(db, { name_he: "התביעות ביטוח", name_en: "" })).toBe(key);
    expect(await categoryFromProposal(db, { name_he: "", name_en: "insurance claim" })).toBe(key);
    expect(await categoryFromProposal(db, { name_he: "x", name_en: "!" })).toBe("other");
    expect(await categoryFromProposal(db, null)).toBe("other");
    // A proposal matching a built-in type uses it.
    expect(await categoryFromProposal(db, { name_he: "", name_en: "Real estate" })).toBe("real_estate");
    expect((await listServiceCategories(db)).map((c) => c.key)).toContain(key);
  });

  it("only admins add, rename or hide types; a hidden type isn't offered or reused", async () => {
    const manager = await makeUser(db, "case_manager");
    await expectCode(createCategory(db, manager, { nameHe: "תביעות משפטיות", nameEn: "Lawsuits" }), "forbidden");
    const row = await createCategory(db, admin, { nameHe: "תביעות משפטיות", nameEn: "Lawsuits" });
    expect(row).toMatchObject({ key: "lawsuits", createdByAi: false, createdById: admin.id });
    await expectCode(createCategory(db, admin, { nameHe: "אחר", nameEn: "Lawsuit" }), "category_exists");
    await expectCode(createCategory(db, admin, { nameHe: "", nameEn: "X" }), "validation");

    await expectCode(updateCategory(db, manager, "lawsuits", { active: false }), "forbidden");
    await expectCode(updateCategory(db, admin, "immigration_visa", { active: false }), "not_found");
    await updateCategory(db, admin, "lawsuits", { nameEn: "Lawsuits & claims" });
    await updateCategory(db, admin, "lawsuits", { active: false });
    expect((await listServiceCategories(db)).map((c) => c.key)).not.toContain("lawsuits");
    expect((await listServiceCategories(db, { includeInactive: true })).find((c) => c.key === "lawsuits")).toMatchObject({ active: false, en: "Lawsuits & claims" });
    expect(await resolveCategory(db, "lawsuits")).toBe("other");
    expect(await categoryFromProposal(db, { name_he: "תביעות משפטיות", name_en: "Lawsuits" })).toBe("other");
    await updateCategory(db, admin, "lawsuits", { active: true });
  });

  it("cases accept custom types (and fall back to 'other' for unknown ones)", async () => {
    const client = await makeUser(db, "customer");
    const c = await makeCase(db, client);
    await updateCaseFields(db, admin, c.id, { serviceCategory: "insurance_claims" });
    expect((await getCaseRow(db, c.id)).serviceCategory).toBe("insurance_claims");
    await updateCaseFields(db, admin, c.id, { serviceCategory: "not_a_type" });
    expect((await getCaseRow(db, c.id)).serviceCategory).toBe("other");
  });

  it("stops creating types at the limit", async () => {
    const existing = (await listServiceCategories(db, { includeInactive: true })).filter((c) => !c.builtIn).length;
    for (let i = existing; i < MAX_CUSTOM_CATEGORIES; i++) await db.insert(s.serviceCategories).values({ key: `filler_${i}`, nameHe: `סוג ${i}`, nameEn: `Filler ${i}` });
    expect(await categoryFromProposal(db, { name_he: "פנסיה", name_en: "Pensions" })).toBe("other");
    await db.delete(s.serviceCategories).where(eq(s.serviceCategories.nameHe, `סוג ${MAX_CUSTOM_CATEGORIES - 1}`));
  });
});

describe("the intake assistant proposes a new type", () => {
  const saved = { aiProvider: env.aiProvider, openrouterApiKey: env.openrouterApiKey, anthropicApiKey: env.anthropicApiKey };
  afterAll(() => {
    Object.assign(env, saved);
    vi.unstubAllGlobals();
  });

  it("a request no existing type fits is filed under the new type, and the prompt lists the types", async () => {
    Object.assign(env, { aiProvider: "openrouter", openrouterApiKey: "sk-or-test", anthropicApiKey: "" });
    const sent: string[] = [];
    const summary = { request_title: "תביעת ביטוח דירה", request_description: "נזק מים בדירה", service_category: "new", new_service_type: { name_he: "ביטוח דירה", name_en: "Home insurance" }, customer_goal: "לקבל פיצוי", known_facts: [], constraints: [], missing_information: [], suggested_next_questions: [], urgency: "normal", needs_human_review: true, assumptions: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: RequestInit) => {
        sent.push(String(init!.body));
        return Response.json({ model: "m", choices: [{ message: { content: JSON.stringify({ reply: "מה קרה?", quick_replies: [], ready_for_review: false, summary }) }, finish_reason: "stop" }], usage: {} });
      }),
    );
    const session = await createIntake(db, { message: "אני רוצה להגיש תביעת ביטוח דירה", locale: "he", user: null, ownerToken: "owner-x", ip: null, mode: "chat" });
    expect(session.summary!.service_category).toBe("home_insurance");
    expect(JSON.parse(sent[0]!).messages[0].content).toContain("insurance_claims — Insurance claims / תביעות ביטוח");
    const [row] = await db.select().from(s.serviceCategories).where(eq(s.serviceCategories.key, "home_insurance"));
    expect(row!.createdByAi).toBe(true);

    // The client submits; the case keeps the new type.
    const client = await makeUser(db, "customer");
    const c = await submitIntakeAsCase(db, {
      user: client,
      session,
      edits: { request_title: "t", request_description: "d", customer_goal: "g", service_category: "home_insurance", urgency: "normal", known_facts: [], constraints: [], missing_information: [] },
    });
    expect(c.serviceCategory).toBe("home_insurance");
  });
});

describe("AI consent for accounts the team opened", () => {
  it("self-registration records the answer either way; the profile can give or withdraw consent", async () => {
    const yes = await createCustomerAccount(db, { email: "ai-yes@example.com", name: "Yes", locale: "en", customerType: "private", aiConsent: true });
    const no = await createCustomerAccount(db, { email: "ai-no@example.com", name: "No", locale: "en", customerType: "private", aiConsent: false });
    expect(yes.aiConsentAt).toBeInstanceOf(Date);
    expect(yes.aiConsentDeclinedAt).toBeNull();
    expect(no.aiConsentAt).toBeNull();
    expect(no.aiConsentDeclinedAt).toBeInstanceOf(Date);

    await updateProfile(db, no, { aiConsent: true });
    let [r] = await db.select().from(s.users).where(eq(s.users.id, no.id));
    expect(r!.aiConsentAt).toBeInstanceOf(Date);
    expect(r!.aiConsentDeclinedAt).toBeNull();
    const audits = await db.select().from(s.auditLogs).where(eq(s.auditLogs.entityId, no.id));
    expect(audits.map((a) => a.action)).toContain("user.ai_consent_given");

    await updateProfile(db, r!, { aiConsent: false });
    [r] = await db.select().from(s.users).where(eq(s.users.id, no.id));
    expect(r!.aiConsentAt).toBeNull();
    expect(r!.aiConsentDeclinedAt).toBeInstanceOf(Date);
  });

  it("an account the team opened has no answer yet (so the portal asks), and answering 'no' is remembered", async () => {
    const u = await makeUser(db, "customer", { aiConsent: false });
    expect(u.aiConsentAt).toBeNull();
    expect(u.aiConsentDeclinedAt).toBeNull();
    await updateProfile(db, u, { aiConsent: false });
    const [r] = await db.select().from(s.users).where(eq(s.users.id, u.id));
    expect(r!.aiConsentDeclinedAt).toBeInstanceOf(Date);
  });
});
