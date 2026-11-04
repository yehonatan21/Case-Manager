import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { inviteStaff, listStaff, listAssignableStaff, updateStaffUser } from "@/lib/services/users";
import { requestLoginCode, verifyLoginCode } from "@/lib/services/auth";
import { assignCase } from "@/lib/services/cases";
import { expectCode, getAdmin, makeCase, makeUser, setupDb } from "./helpers";

let db: Database;
let admin: s.User;
let n = 0;
const email = () => `team-${Date.now().toString(36)}-${++n}@example.com`;
const byEmail = async (e: string) => (await db.select().from(s.users).where(eq(s.users.email, e.toLowerCase())))[0];
const customerRow = async (userId: string) => (await db.select().from(s.customers).where(eq(s.customers.userId, userId)))[0];
const auditActions = async (id: string) => (await db.select().from(s.auditLogs).where(eq(s.auditLogs.entityId, id))).map((a) => a.action);

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
});

describe("adding a team member", () => {
  it("a new email: invited, listed, and becomes active on first sign-in", async () => {
    const e = email();
    const { user, outcome } = await inviteStaff(db, admin, { email: `  ${e.toUpperCase()} `, name: "  Shilo  ", role: "case_manager" });
    expect(outcome).toBe("invited");
    expect(user).toMatchObject({ email: e, name: "Shilo", role: "case_manager", status: "invited" });
    expect((await listStaff(db)).some((u) => u.id === user.id)).toBe(true);
    expect(await auditActions(user.id)).toContain("user.invite");
    const { devCode } = await requestLoginCode(db, { email: e, ip: null, locale: "he", purpose: "login" });
    const signed = await verifyLoginCode(db, { email: e, code: devCode!, ip: null, locale: "he" });
    expect(signed.user).toMatchObject({ role: "case_manager", status: "active" });
  });

  it("every team role can be added", async () => {
    for (const role of ["admin", "case_manager", "staff", "finance"] as const) {
      expect((await inviteStaff(db, admin, { email: email(), name: role, role })).user.role).toBe(role);
    }
  });

  it("a client account with no requests becomes a team account", async () => {
    // e.g. someone who registered on the site to try it out
    const client = await makeUser(db, "customer");
    expect(await customerRow(client.id)).toBeTruthy();
    const { user, outcome } = await inviteStaff(db, admin, { email: client.email, name: "Ignored name", role: "case_manager" });
    expect(outcome).toBe("converted");
    expect(user).toMatchObject({ id: client.id, role: "case_manager", status: "active", name: client.name });
    expect(await customerRow(client.id)).toBeUndefined();
    expect((await listAssignableStaff(db)).some((u) => u.id === client.id)).toBe(true);
    expect(await auditActions(client.id)).toContain("user.convert_to_staff");
    // They can now work on cases.
    const c = await makeCase(db, await makeUser(db, "customer"));
    await assignCase(db, admin, c.id, client.id);
  });

  it("a client who has requests is refused, and nothing changes", async () => {
    const client = await makeUser(db, "customer");
    await makeCase(db, client);
    await expectCode(inviteStaff(db, admin, { email: client.email, name: "x", role: "staff" }), "email_is_client");
    expect((await byEmail(client.email))!.role).toBe("customer");
    expect(await customerRow(client.id)).toBeTruthy();
  });

  it("a disabled team member is re-enabled with the chosen role", async () => {
    const former = await makeUser(db, "staff", { status: "disabled" });
    const { user, outcome } = await inviteStaff(db, admin, { email: former.email, name: "x", role: "finance" });
    expect(outcome).toBe("reactivated");
    expect(user).toMatchObject({ id: former.id, role: "finance", status: "active" });
    expect(await auditActions(former.id)).toContain("user.reactivate");
  });

  it("an active or invited team member is refused with a clear reason", async () => {
    for (const status of ["active", "invited"] as const) {
      const member = await makeUser(db, "case_manager", { status });
      await expectCode(inviteStaff(db, admin, { email: member.email.toUpperCase(), name: "x", role: "admin" }), "already_team_member");
      expect((await byEmail(member.email))!.role).toBe("case_manager");
    }
    await expectCode(inviteStaff(db, admin, { email: admin.email, name: "x", role: "staff" }), "already_team_member");
  });

  it("only admins can add team members, and never as customers", async () => {
    for (const role of ["case_manager", "staff", "finance", "customer"] as const) {
      await expectCode(inviteStaff(db, await makeUser(db, role), { email: email(), name: "x", role: "staff" }), "forbidden");
    }
    await expectCode(inviteStaff(db, admin, { email: email(), name: "x", role: "customer" }), "validation");
  });
});

describe("changing a team member's role or status", () => {
  it("changes the role, disables and re-enables", async () => {
    const m = (await inviteStaff(db, admin, { email: email(), name: "M", role: "staff" })).user;
    await updateStaffUser(db, admin, m.id, { role: "case_manager" });
    expect((await byEmail(m.email))!.role).toBe("case_manager");
    await updateStaffUser(db, admin, m.id, { status: "disabled" });
    expect((await byEmail(m.email))!.status).toBe("disabled");
    expect((await listStaff(db)).some((u) => u.id === m.id)).toBe(false);
    expect((await listStaff(db, { includeDisabled: true })).some((u) => u.id === m.id)).toBe(true);
    await expectCode(requestLoginCode(db, { email: m.email, ip: null, locale: "he", purpose: "login" }), "account_disabled");
    await updateStaffUser(db, admin, m.id, { status: "active" });
    expect((await byEmail(m.email))!.status).toBe("active");
  });

  it("can't touch client accounts, demote yourself, or be used by non-admins", async () => {
    const client = await makeUser(db, "customer");
    await expectCode(updateStaffUser(db, admin, client.id, { role: "staff" }), "not_found");
    await expectCode(updateStaffUser(db, admin, admin.id, { role: "case_manager" }), "validation");
    await expectCode(updateStaffUser(db, admin, admin.id, { status: "disabled" }), "validation");
    const m = await makeUser(db, "staff");
    await expectCode(updateStaffUser(db, await makeUser(db, "case_manager"), m.id, { role: "admin" }), "forbidden");
  });
});
