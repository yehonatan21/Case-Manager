import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { env } from "@/lib/env";
import { assignCase, changeStatus, getCaseBundle, listStaffCases } from "@/lib/services/cases";
import { listCustomers } from "@/lib/services/customers";
import { getSystemHealth, retryFailed } from "@/lib/services/health";
import { getSettings, updateSettings } from "@/lib/services/settings";
import { runJobs } from "@/lib/services/jobs";
import { expectCode, getAdmin, makeCase, makeUser, setupDb } from "./helpers";

let db: Database;
let admin: s.User;

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
});
afterEach(() => vi.unstubAllGlobals());

describe("starting work before payment", () => {
  it("needs an admin or case manager and a reason, kept for the team only", async () => {
    const client = await makeUser(db, "customer", { locale: "en" });
    const c = await makeCase(db, client);
    const manager = await makeUser(db, "case_manager");
    const staff = await makeUser(db, "staff");
    await assignCase(db, admin, c.id, staff.id);
    await db.update(s.cases).set({ status: "under_review" }).where(eq(s.cases.id, c.id));
    await expectCode(changeStatus(db, staff, c.id, "active", { activation: { reason: "paid_offline" } }), "forbidden");
    await assignCase(db, admin, c.id, manager.id);
    await expectCode(changeStatus(db, manager, c.id, "active"), "activation_reason_required");
    await expectCode(changeStatus(db, manager, c.id, "active", { activation: { reason: "other", note: "  " } }), "activation_reason_required");
    const updated = await changeStatus(db, manager, c.id, "active", { activation: { reason: "paid_offline", note: "Bank transfer 4471" } });
    expect(updated.status).toBe("active");
    const events = await db.select().from(s.caseEvents).where(eq(s.caseEvents.caseId, c.id));
    expect(events.find((e) => e.type === "activated_without_payment")).toMatchObject({ visibility: "internal", data: { reason: "paid_offline", note: "Bank transfer 4471" } });
    // The client sees the status change, never the reason.
    const clientView = await getCaseBundle(db, client, c.id);
    expect(JSON.stringify(clientView.events)).not.toContain("4471");
    expect(clientView.events.some((e) => e.type === "activated_without_payment")).toBe(false);
    const [log] = await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityId, c.id), eq(s.auditLogs.action, "case.status"))).orderBy(s.auditLogs.createdAt);
    expect(log).toBeTruthy();
  });

  it("reopening a completed case needs no reason", async () => {
    const client = await makeUser(db, "customer");
    const c = await makeCase(db, client);
    await db.update(s.cases).set({ status: "completed" }).where(eq(s.cases.id, c.id));
    expect((await changeStatus(db, admin, c.id, "active")).status).toBe("active");
  });
});

describe("finding clients and cases", () => {
  it("searches clients by name, email, organization and phone in any format, a page at a time", async () => {
    const [org] = await db.insert(s.organizations).values({ name: "Orbit Logistics" }).returning();
    const u = await makeUser(db, "customer");
    await db.update(s.users).set({ name: "Yael Ben-Ami", phone: "050-765 4321" }).where(eq(s.users.id, u.id));
    await db.update(s.customers).set({ organizationId: org!.id, type: "business" }).where(eq(s.customers.userId, u.id));
    for (const q of ["ben-ami", u.email.toUpperCase(), "orbit", "0507654321", "765-4321"]) {
      expect((await listCustomers(db, { q })).rows.map((r) => r.email), q).toEqual([u.email]);
    }
    expect((await listCustomers(db, { q: "ben-ami", type: "private" })).rows).toEqual([]);
    // "%" is searched literally, not as a wildcard.
    expect((await listCustomers(db, { q: "%" })).total).toBe(0);
    for (let i = 0; i < 3; i++) await makeUser(db, "customer");
    const all = await listCustomers(db, { pageSize: 2 });
    expect(all.total).toBeGreaterThanOrEqual(4);
    expect(all.pages).toBe(Math.ceil(all.total / 2));
    const second = await listCustomers(db, { pageSize: 2, page: 2 });
    expect(second.rows).toHaveLength(2);
    expect(second.rows.map((r) => r.id)).not.toContain(all.rows[0]!.id);
  });

  it("searches cases by description and phone too, with offset paging", async () => {
    const client = await makeUser(db, "customer");
    await db.update(s.users).set({ phone: "+972 54-111-2233" }).where(eq(s.users.id, client.id));
    const c = await makeCase(db, client, "Residency renewal");
    await db.update(s.cases).set({ description: "Needs an apostille for the marriage certificate" }).where(eq(s.cases.id, c.id));
    expect((await listStaffCases(db, admin, { status: "all", q: "apostille" })).map((r) => r.id)).toEqual([c.id]);
    expect((await listStaffCases(db, admin, { status: "all", q: "054-111-2233" })).map((r) => r.id)).toContain(c.id);
    const first = await listStaffCases(db, admin, { status: "all", limit: 1 });
    const next = await listStaffCases(db, admin, { status: "all", limit: 1, offset: 1 });
    expect(first[0]!.id).not.toBe(next[0]!.id);
  });
});

describe("accessibility contact", () => {
  it("is saved by admins with the other settings", async () => {
    expect((await getSettings(db)).accessibility_contact).toEqual({ name: "", phone: "", email: "", response_days: 0 });
    await expectCode(updateSettings(db, await makeUser(db, "case_manager"), { accessibility_contact: { name: "x", phone: "", email: "", response_days: 1 } }), "forbidden");
    await updateSettings(db, admin, { accessibility_contact: { name: "Noa Levi", phone: "03-5551234", email: "access@office.co.il", response_days: 5 } });
    expect((await getSettings(db)).accessibility_contact).toMatchObject({ name: "Noa Levi", response_days: 5 });
  });
});

describe("system health", () => {
  it("is for admins, and reports the AI privacy setting, the email service and the jobs", async () => {
    await expectCode(getSystemHealth(db, await makeUser(db, "finance")), "forbidden");
    const saved = { aiProvider: env.aiProvider, openrouterApiKey: env.openrouterApiKey, openrouterModel: env.openrouterModel, openrouterDataCollection: env.openrouterDataCollection, openrouterFallbackModels: env.openrouterFallbackModels };
    try {
      Object.assign(env, { aiProvider: "openrouter", openrouterApiKey: "sk-or-test", openrouterModel: "vendor/model:free", openrouterFallbackModels: [], openrouterDataCollection: "allow" });
      let ai = (await getSystemHealth(db, admin)).checks.find((c) => c.id === "ai")!;
      expect(ai).toMatchObject({ level: "warning", facts: { provider: "openrouter", dataCollection: "allow" } });
      // The texts then say the provider may keep the content.
      const { dictFor } = await import("@/lib/i18n/dictionaries");
      const { aiMayKeepData } = await import("@/lib/ai/providers");
      expect(aiMayKeepData()).toBe(true);
      expect(dictFor("he", { aiMayKeepData: true }).legal.privacy.join(" ")).not.toContain("אינו משמש לאימון");
      expect(dictFor("en", { aiMayKeepData: true }).account.aiText).toContain("may store the content");
      expect(dictFor("en").legal.privacy.join(" ")).toContain("not used to train");
      expect(ai.issues).toEqual(expect.arrayContaining(["ai_data_allowed", "ai_free_model"]));
      Object.assign(env, { openrouterModel: "vendor/model", openrouterDataCollection: "deny" });
      ai = (await getSystemHealth(db, admin)).checks.find((c) => c.id === "ai")!;
      expect(ai).toMatchObject({ level: "ok", issues: [] });
    } finally {
      Object.assign(env, saved);
    }
    // No secrets on the page.
    const h = await getSystemHealth(db, admin);
    expect(JSON.stringify(h)).not.toContain("sk-or-test");
    expect(h.checks.find((c) => c.id === "jobs")!.issues).toEqual(["jobs_never"]);
    await runJobs(db);
    const jobs = (await getSystemHealth(db, admin)).checks.find((c) => c.id === "jobs")!;
    expect(jobs).toMatchObject({ level: "ok", issues: [] });
    expect(jobs.facts.lastRunAt).toEqual(expect.any(String));
  });

  it("counts failed deliveries and puts the recent ones back in the queue", async () => {
    const user = await makeUser(db, "customer");
    const old = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    await db.insert(s.notifications).values([
      { userId: user.id, type: "status_changed", channel: "push", title: "t", status: "failed", attempts: 5, error: "410 gone" },
      { userId: user.id, type: "status_changed", channel: "push", title: "old", status: "failed", attempts: 5, error: "410 gone", createdAt: old },
    ]);
    const push = (await getSystemHealth(db, admin)).checks.find((c) => c.id === "push")!;
    expect(push.stats).toMatchObject({ failed7d: 1, lastError: "410 gone" });
    expect(push.level).toBe("error");
    await expectCode(retryFailed(db, await makeUser(db, "case_manager"), "push"), "forbidden");
    const r = await retryFailed(db, admin, "push");
    expect(r.requeued).toBe(1);
    const rows = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, user.id), eq(s.notifications.channel, "push")));
    // Tried again at once (this test user has no device, so it fails again); the week-old one is left alone.
    expect(rows.find((x) => x.title === "t")).toMatchObject({ attempts: 1, error: "no_devices" });
    expect(rows.find((x) => x.title === "old")).toMatchObject({ status: "failed", attempts: 5 });
  });
});
