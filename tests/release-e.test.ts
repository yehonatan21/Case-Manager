import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { base32Decode, base32Encode, currentStep, totpAt, verifyTotp } from "@/lib/totp";
import { checkSecondStep, confirmTwoFactorSetup, disableTwoFactor, needsSecondStep, regenerateRecoveryCodes, resetTwoFactor, startTwoFactorSetup } from "@/lib/services/two-factor";
import { updateSettings } from "@/lib/services/settings";
import { audit } from "@/lib/services/audit";
import { activityCsv, activityFilters, listActivity } from "@/lib/services/activity";
import { fingerprint, listErrors, recordError, resolveErrors, scrub } from "@/lib/services/error-tracking";
import { getSystemHealth } from "@/lib/services/health";
import { expectCode, getAdmin, makeUser, setupDb } from "./helpers";

let db: Database;
let admin: s.User;
beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
});
const fresh = async (id: string) => (await db.select().from(s.users).where(eq(s.users.id, id)))[0]!;

describe("authenticator codes (RFC 6238)", () => {
  it("matches the RFC's test vector and base32", () => {
    // RFC 6238 appendix B, SHA-1 secret "12345678901234567890": at 59 s the 8-digit code is 94287082 → 287082.
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
    expect(totpAt(secret, Math.floor(59 / 30))).toBe("287082");
    expect(totpAt(secret, Math.floor(1111111109 / 30))).toBe("081804");
  });

  it("accepts one step either side, refuses used steps and wrong codes", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    const now = Date.now();
    const step = currentStep(now);
    expect(verifyTotp(secret, totpAt(secret, step), { now })).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, step - 1), { now })).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step - 3), { now })).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, step), { now, lastUsedStep: step })).toBeNull();
    expect(verifyTotp(secret, "12345", { now })).toBeNull();
  });
});

describe("two-step sign-in for staff", () => {
  it("is set up with a QR code and a first code, then asked for at sign-in; recovery codes work once", async () => {
    const m = await makeUser(db, "case_manager");
    expect(needsSecondStep(m)).toBe(false);
    const { secret, qrSvg } = await startTwoFactorSetup(db, m);
    expect(qrSvg).toContain("<svg");
    // The secret is stored encrypted, not as is.
    expect((await fresh(m.id)).totpSecretEnc).not.toContain(secret);
    await expectCode(confirmTwoFactorSetup(db, await fresh(m.id), "000000"), "invalid_code");
    const step = currentStep();
    const codes = await confirmTwoFactorSetup(db, await fresh(m.id), totpAt(secret, step));
    expect(codes).toHaveLength(10);
    let u = await fresh(m.id);
    expect(needsSecondStep(u)).toBe(true);
    expect(u.totpRecoveryHashes).toHaveLength(10);
    expect(JSON.stringify(u.totpRecoveryHashes)).not.toContain(codes[0]);

    // The code used to confirm can't be used again; the next one can.
    await expectCode(checkSecondStep(db, u, totpAt(secret, step)), "invalid_code");
    expect(await checkSecondStep(db, u, totpAt(secret, step + 1))).toBe("app");
    // A recovery code works once.
    u = await fresh(m.id);
    expect(await checkSecondStep(db, u, codes[0]!.toUpperCase())).toBe("recovery");
    u = await fresh(m.id);
    expect(u.totpRecoveryHashes).toHaveLength(9);
    await expectCode(checkSecondStep(db, u, codes[0]!), "invalid_code");

    // New recovery codes replace the old ones.
    const again = await regenerateRecoveryCodes(db, u, codes[1]!);
    u = await fresh(m.id);
    await expectCode(checkSecondStep(db, u, codes[2]!), "invalid_code");
    expect(await checkSecondStep(db, u, again[0]!)).toBe("recovery");

    // While the office requires it, it can't be turned off; otherwise it can, with a code.
    await updateSettings(db, admin, { require_staff_2fa: true });
    await expectCode(disableTwoFactor(db, await fresh(m.id), again[1]!), "mfa_required");
    await updateSettings(db, admin, { require_staff_2fa: false });
    await disableTwoFactor(db, await fresh(m.id), again[1]!);
    expect(needsSecondStep(await fresh(m.id))).toBe(false);
    // Clients don't have it.
    await expectCode(startTwoFactorSetup(db, await makeUser(db, "customer")), "forbidden");
  });

  it("an admin resets it for someone who lost their phone (not their own, and only admins)", async () => {
    const m = await makeUser(db, "staff");
    const { secret } = await startTwoFactorSetup(db, m);
    await confirmTwoFactorSetup(db, await fresh(m.id), totpAt(secret, currentStep()));
    await expectCode(resetTwoFactor(db, await makeUser(db, "case_manager"), m.id), "forbidden");
    await expectCode(resetTwoFactor(db, admin, admin.id), "validation");
    await resetTwoFactor(db, admin, m.id);
    const u = await fresh(m.id);
    expect([u.totpEnabledAt, u.totpSecretEnc, u.totpRecoveryHashes.length]).toEqual([null, null, 0]);
    const [log] = await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.action, "auth.2fa_reset"), eq(s.auditLogs.entityId, m.id)));
    expect(log?.actorId).toBe(admin.id);
  });

  it("too many wrong codes are stopped", async () => {
    const m = await makeUser(db, "staff");
    const { secret } = await startTwoFactorSetup(db, m);
    await confirmTwoFactorSetup(db, await fresh(m.id), totpAt(secret, currentStep()));
    const u = await fresh(m.id);
    for (let i = 0; i < 9; i++) await expectCode(checkSecondStep(db, u, "000000"), "invalid_code");
    await expectCode(checkSecondStep(db, u, "000000"), "rate_limited");
  });
});

describe("activity log", () => {
  it("lists, filters and exports what happened, for admins only", async () => {
    const m = await makeUser(db, "case_manager");
    await db.update(s.users).set({ name: "Activity Tester" }).where(eq(s.users.id, m.id));
    await audit(db, { actorId: m.id, action: "case.status", entityType: "case", entityId: "c-123", details: { from: "submitted", to: "under_review" }, ip: "10.0.0.7" });
    await audit(db, { actorId: m.id, action: "quote.send", entityType: "quote", entityId: "=1+1", details: { total: 590 } });
    const mine = await listActivity(db, admin, { actor: m.id });
    expect(mine.total).toBe(2);
    // Both entries are written within the same millisecond, so their order isn't fixed; check both are there.
    expect(mine.rows.map((r) => r.action).sort()).toEqual(["case.status", "quote.send"]);
    expect(mine.rows.every((r) => r.actorName === "Activity Tester")).toBe(true);
    expect((await listActivity(db, admin, { actor: m.id, group: "case" })).rows.map((r) => r.action)).toEqual(["case.status"]);
    expect((await listActivity(db, admin, { q: "under_review" })).rows.some((r) => r.entityId === "c-123")).toBe(true);
    expect((await listActivity(db, admin, { q: "10.0.0.7" })).total).toBe(1);
    expect((await listActivity(db, admin, { actor: m.id, from: "2000-01-01", to: "2000-01-02" })).total).toBe(0);
    const f = await activityFilters(db, admin);
    expect(f.groups).toEqual(expect.arrayContaining(["case", "quote"]));
    expect(f.people.map((p) => p.id)).toContain(m.id);
    const csv = await activityCsv(db, admin, { actor: m.id }, (a) => (a === "case.status" ? "Changed a case's status" : a));
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Changed a case's status");
    // A value that looks like a spreadsheet formula is kept as text.
    expect(csv).toContain("'=1+1");
    await expectCode(listActivity(db, m, {}), "forbidden");
  });
});

describe("error tracking", () => {
  it("groups the same error, hides personal data, tells the admins once, and comes back after being fixed", async () => {
    expect(scrub("Failed for dana@example.com with id 123e4567-e89b-12d3-a456-426614174000 and 0501234567")).toBe("Failed for [email] with id [id] and [number]");
    const stack = "TypeError: x is undefined\n    at load (/app/src/lib/services/cases.ts:10:5)\n    at node:internal/process";
    expect(fingerprint({ source: "server", message: "TypeError: x is undefined", stack })).toBe(fingerprint({ source: "server", message: "TypeError: x is undefined", stack: stack.replace(":10:5", ":11:9") }));

    const count = async () =>
      (await db.select().from(s.notifications).where(and(eq(s.notifications.type, "error_new"), eq(s.notifications.userId, admin.id), eq(s.notifications.channel, "in_app")))).length;
    const before = await count();
    await recordError(db, { source: "server", message: "TypeError: x is undefined (user dana@example.com)", stack, path: "/api/cases?id=1" });
    await recordError(db, { source: "server", message: "TypeError: x is undefined (user dana@example.com)", stack, path: "/api/cases" });
    let open = await listErrors(db, admin);
    const e = open.find((x) => x.message.includes("x is undefined"))!;
    expect(e).toMatchObject({ count: 2, path: "/api/cases", source: "server" });
    expect(e.message).not.toContain("dana@example.com");
    expect(await count()).toBe(before + 1);

    let card = (await getSystemHealth(db, admin)).checks.find((c) => c.id === "errors")!;
    expect(card).toMatchObject({ level: "error", issues: ["errors_recent"] });
    expect(await resolveErrors(db, admin, "all")).toBeGreaterThan(0);
    card = (await getSystemHealth(db, admin)).checks.find((c) => c.id === "errors")!;
    expect(card).toMatchObject({ level: "ok", issues: [] });

    // After being fixed it comes back as a new entry (no second alert within the hour).
    await recordError(db, { source: "server", message: "TypeError: x is undefined (user dana@example.com)", stack, path: "/api/cases" });
    open = await listErrors(db, admin);
    expect(open.filter((x) => x.message.includes("x is undefined"))).toHaveLength(1);
    expect(await count()).toBe(before + 1);
    await expectCode(listErrors(db, await makeUser(db, "case_manager")), "forbidden");
  });
});
