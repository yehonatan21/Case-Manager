import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { setDbOverride, type Database } from "@/lib/db";
import { seedBase } from "@/lib/db/seed";
import * as s from "@/lib/db/schema";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { completeGoogleSignup, finishGoogleSignIn, resolveGoogleUser, startGoogleSignIn } from "@/lib/services/google";
import { createTestDatabase } from "./db";

let db: Database;
const isCode = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;

beforeAll(async () => {
  db = await createTestDatabase();
  await seedBase(db);
  setDbOverride(db);
  Object.assign(env, { googleClientId: "client-id", googleClientSecret: "client-secret" });
});
afterEach(() => vi.unstubAllGlobals());

describe("Google sign-in", () => {
  it("builds a consent URL with state and PKCE, and only same-site return paths", () => {
    const { url, cookie } = startGoogleSignIn("//evil.com");
    const u = new URL(url);
    expect(u.hostname).toBe("accounts.google.com");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("redirect_uri")).toBe(`${env.appUrl}/api/auth/google/callback`);
    expect(cookie).toBeTruthy();
  });

  it("rejects a callback whose state does not match", async () => {
    const { cookie } = startGoogleSignIn("/portal");
    await expect(finishGoogleSignIn({ code: "c", state: "forged", cookie })).rejects.toSatisfy(isCode("forbidden"));
    await expect(finishGoogleSignIn({ code: "c", state: "x", cookie: undefined })).rejects.toSatisfy(isCode("forbidden"));
  });

  it("exchanges the code and reads the verified profile", async () => {
    const { url, cookie } = startGoogleSignIn("/portal/cases");
    const state = new URL(url).searchParams.get("state")!;
    const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) =>
      String(input).includes("token")
        ? Response.json({ access_token: "at" })
        : Response.json({ sub: "123", email: "New.Person@Gmail.com", email_verified: true, name: "New Person" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await finishGoogleSignIn({ code: "auth-code", state, cookie });
    expect(r.next).toBe("/portal/cases");
    expect(r.profile).toMatchObject({ email: "new.person@gmail.com", emailVerified: true, name: "New Person" });
    const body = String((fetchMock.mock.calls[0]![1] as RequestInit).body);
    expect(body).toContain("code_verifier=");
  });

  it("signs existing users in and activates invited staff", async () => {
    const [admin] = await db.select().from(s.users).where(eq(s.users.role, "admin"));
    const res = await resolveGoogleUser(db, { email: admin!.email, emailVerified: true, name: "x", sub: "1" });
    expect("user" in res && res.user.id).toBe(admin!.id);
    await db.insert(s.users).values({ email: "invited@example.com", name: "Inv", role: "staff", status: "invited" });
    const inv = await resolveGoogleUser(db, { email: "invited@example.com", emailVerified: true, name: "", sub: "2" });
    expect("user" in inv && inv.user.status).toBe("active");
  });

  it("refuses unverified Google emails", async () => {
    await expect(resolveGoogleUser(db, { email: "x@example.com", emailVerified: false, name: "", sub: "3" })).rejects.toSatisfy(isCode("unauthorized"));
  });

  it("creates a new customer only after terms are accepted", async () => {
    const res = await resolveGoogleUser(db, { email: "fresh@gmail.com", emailVerified: true, name: "Fresh User", sub: "4" });
    expect("pendingToken" in res).toBe(true);
    const token = (res as { pendingToken: string }).pendingToken;
    const base = { name: "Fresh User", customerType: "private" as const, aiConsent: false, locale: "en" as const };
    await expect(completeGoogleSignup(db, token, { ...base, acceptTerms: false })).rejects.toSatisfy(isCode("terms_required"));
    await expect(completeGoogleSignup(db, "tampered", { ...base, acceptTerms: true })).rejects.toSatisfy(isCode("code_expired"));
    const user = await completeGoogleSignup(db, token, { ...base, acceptTerms: true });
    expect(user).toMatchObject({ email: "fresh@gmail.com", role: "customer" });
    const [cust] = await db.select().from(s.customers).where(eq(s.customers.userId, user.id));
    expect(cust?.type).toBe("private");
    await expect(completeGoogleSignup(db, token, { ...base, acceptTerms: true })).rejects.toSatisfy(isCode("conflict"));
  });
});
