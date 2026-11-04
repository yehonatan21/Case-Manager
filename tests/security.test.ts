import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { env } from "@/lib/env";
import { requestLoginCode, verifyLoginCode } from "@/lib/services/auth";
import { createIntake, getIntake, postIntakeMessage } from "@/lib/services/intake";
import { uploadIntakeAttachment, authorizeDownload } from "@/lib/services/documents";
import { submitIntakeAsCase } from "@/lib/services/cases";
import { DatabaseStorage, LocalStorage } from "@/lib/storage";
import { expectCode, getAdmin, makeUser, setupDb } from "./helpers";

let db: Database;
let n = 0;
const fresh = (p = "u") => `${p}${Date.now().toString(36)}${++n}@Example.com`;
const signup = { name: "New Person", customerType: "private" as const, acceptTerms: true, aiConsent: true };

beforeAll(async () => {
  db = await setupDb();
});

describe("one-time sign-in codes", () => {
  it("limits code requests per email", async () => {
    const email = fresh();
    for (let i = 0; i < 5; i++) await requestLoginCode(db, { email, ip: null, locale: "en" });
    await expectCode(requestLoginCode(db, { email, ip: null, locale: "en" }), "rate_limited");
  });

  it("locks a code after 5 wrong attempts, even if the right code follows", async () => {
    const email = fresh();
    const { devCode } = await requestLoginCode(db, { email, ip: null, locale: "en" });
    const wrong = devCode === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) await expectCode(verifyLoginCode(db, { email, code: wrong, ip: null, locale: "en", signup }), "invalid_code");
    await expectCode(verifyLoginCode(db, { email, code: wrong, ip: null, locale: "en", signup }), "too_many_attempts");
    await expectCode(verifyLoginCode(db, { email, code: devCode!, ip: null, locale: "en", signup }), "too_many_attempts");
  });

  it("codes are single-use and expire", async () => {
    const email = fresh();
    const { devCode } = await requestLoginCode(db, { email, ip: null, locale: "en" });
    await verifyLoginCode(db, { email, code: devCode!, ip: null, locale: "en", signup });
    await expectCode(verifyLoginCode(db, { email, code: devCode!, ip: null, locale: "en" }), "code_expired");
    const r2 = await requestLoginCode(db, { email, ip: null, locale: "en" });
    await db.update(s.authCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.authCodes.email, email.toLowerCase()));
    await expectCode(verifyLoginCode(db, { email, code: r2.devCode!, ip: null, locale: "en" }), "code_expired");
  });

  it("treats email addresses case-insensitively", async () => {
    const email = fresh("Mixed");
    const { devCode } = await requestLoginCode(db, { email, ip: null, locale: "en" });
    const { user } = await verifyLoginCode(db, { email: email.toUpperCase(), code: devCode!, ip: null, locale: "en", signup });
    expect(user.email).toBe(email.toLowerCase());
  });

  it("requires accepted terms to create an account, and stores the organisation", async () => {
    const email = fresh();
    const { devCode } = await requestLoginCode(db, { email, ip: null, locale: "en" });
    await expectCode(verifyLoginCode(db, { email, code: devCode!, ip: null, locale: "en", signup: { ...signup, acceptTerms: false } }), "terms_required");
    const { user, created } = await verifyLoginCode(db, {
      email,
      code: devCode!,
      ip: null,
      locale: "en",
      signup: { ...signup, customerType: "company", organizationName: "Acme Ltd", organizationNumber: "515" },
    });
    expect(created).toBe(true);
    const [cust] = await db.select({ c: s.customers, o: s.organizations }).from(s.customers).leftJoin(s.organizations, eq(s.organizations.id, s.customers.organizationId)).where(eq(s.customers.userId, user.id));
    expect(cust?.c.type).toBe("company");
    expect(cust?.o?.name).toBe("Acme Ltd");
  });

  it("blocks disabled accounts and activates invited staff on first sign-in", async () => {
    const disabled = await makeUser(db, "staff", { status: "disabled" });
    await expectCode(requestLoginCode(db, { email: disabled.email, ip: null, locale: "en" }), "account_disabled");
    const invited = await makeUser(db, "case_manager", { status: "invited" });
    const { devCode } = await requestLoginCode(db, { email: invited.email, ip: null, locale: "en", purpose: "login" });
    const { user } = await verifyLoginCode(db, { email: invited.email, code: devCode!, ip: null, locale: "en" });
    expect(user.status).toBe("active");
    expect(user.role).toBe("case_manager");
  });

  it("never stores codes in plain text", async () => {
    const email = fresh();
    const { devCode } = await requestLoginCode(db, { email, ip: null, locale: "en" });
    const [row] = await db.select().from(s.authCodes).where(eq(s.authCodes.email, email.toLowerCase()));
    expect(row?.codeHash).not.toContain(devCode!);
    expect(row?.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("intake ownership", () => {
  it("only the browser (or user) that started a request can read or continue it", async () => {
    const s1 = await createIntake(db, { message: "I need a visa for Canada", locale: "en", user: null, ownerToken: "browser-A", ip: null, mode: "chat" });
    expect((await getIntake(db, s1.id, null, "browser-A")).id).toBe(s1.id);
    await expectCode(getIntake(db, s1.id, null, "browser-B"), "not_found");
    await expectCode(getIntake(db, s1.id, null, null), "not_found");
    await expectCode(getIntake(db, "not-a-uuid", null, "browser-A"), "not_found");
    const other = await makeUser(db, "customer");
    await expectCode(getIntake(db, s1.id, other, null), "not_found");
  });

  it("can't be continued after it was submitted", async () => {
    const customer = await makeUser(db, "customer");
    const sess = await createIntake(db, { message: "Help with a contract", locale: "en", user: customer, ownerToken: "browser-C", ip: null, mode: "chat" });
    await submitIntakeAsCase(db, {
      user: customer,
      session: sess,
      edits: { request_title: "T", request_description: "D", customer_goal: "", service_category: "legal_consulting", urgency: "normal", known_facts: [], constraints: [], missing_information: [] },
    });
    const after = await getIntake(db, sess.id, customer, null);
    await expectCode(postIntakeMessage(db, after, { content: "more" }), "conflict");
    await expectCode(submitIntakeAsCase(db, { user: customer, session: after, edits: { request_title: "T", request_description: "D", customer_goal: "", service_category: "other", urgency: "normal", known_facts: [], constraints: [], missing_information: [] } }), "conflict");
  });

  it("staff accounts can't submit customer requests", async () => {
    const admin = await getAdmin(db);
    const sess = await createIntake(db, { message: null, locale: "en", user: admin, ownerToken: "browser-D", ip: null, mode: "manual" });
    await expectCode(
      submitIntakeAsCase(db, { user: admin, session: sess, edits: { request_title: "T", request_description: "D", customer_goal: "", service_category: "other", urgency: "normal", known_facts: [], constraints: [], missing_information: [] } }),
      "forbidden",
    );
  });

  it("intake attachments are private to the owner and limited in number", async () => {
    const sess = await createIntake(db, { message: null, locale: "en", user: null, ownerToken: "browser-E", ip: null, mode: "manual" });
    const pdf = { name: "doc.pdf", data: Buffer.from("%PDF-1.4 attach") };
    const up = await uploadIntakeAttachment(db, { sessionId: sess.id, user: null, ownerToken: "browser-E", file: pdf });
    await expectCode(uploadIntakeAttachment(db, { sessionId: sess.id, user: null, ownerToken: "browser-F", file: pdf }), "not_found");
    expect((await authorizeDownload(db, null, "browser-E", up.file.id)).id).toBe(up.file.id);
    await expectCode(authorizeDownload(db, null, "browser-F", up.file.id), "not_found");
    for (let i = 0; i < 9; i++) await uploadIntakeAttachment(db, { sessionId: sess.id, user: null, ownerToken: "browser-E", file: pdf });
    await expectCode(uploadIntakeAttachment(db, { sessionId: sess.id, user: null, ownerToken: "browser-E", file: pdf }), "rate_limited");
  });
});

describe("file storage", () => {
  it("local disk: files are encrypted at rest and keys can't escape the storage folder", async () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), ".data", "test-store-"));
    const saved = env.storageDir;
    Object.assign(env, { storageDir: path.relative(process.cwd(), dir) });
    try {
      const store = new LocalStorage();
      await store.put("cases/abc/file1", Buffer.from("top secret passport"));
      const onDisk = fs.readFileSync(path.join(dir, "cases/abc/file1"));
      expect(onDisk.includes(Buffer.from("top secret"))).toBe(false);
      expect((await store.get("cases/abc/file1")).toString()).toBe("top secret passport");
      await expect(store.put("../../etc/evil", Buffer.from("x"))).rejects.toThrow(/Invalid storage key/);
      await expect(store.get("../outside")).rejects.toThrow(/Invalid storage key/);
    } finally {
      Object.assign(env, { storageDir: saved });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("database storage: encrypted round trip", async () => {
    const store = new DatabaseStorage();
    await store.put("k1", Buffer.from("hello file"));
    const [row] = await db.select().from(s.fileBlobs).where(eq(s.fileBlobs.key, "k1"));
    expect(row!.data.includes(Buffer.from("hello file"))).toBe(false);
    expect((await store.get("k1")).toString()).toBe("hello file");
    await expect(store.get("missing")).rejects.toThrow();
  });
});
