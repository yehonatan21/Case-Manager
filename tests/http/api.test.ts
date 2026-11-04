/**
 * HTTP-level tests against a running server (demo mode, so sign-in codes are returned).
 *   API_BASE=http://localhost:3000 npm run test:api
 * Skipped when API_BASE is not set. CI runs them against the production build.
 */
import { describe, expect, it } from "vitest";

const BASE = process.env.API_BASE;
const ORIGIN = BASE ? new URL(BASE).origin : "";

type Res = { status: number; json: { ok: boolean; data?: any; error?: { code: string } } | null; headers: Headers };

async function call(path: string, opts: { method?: string; body?: unknown; cookie?: string; origin?: string; raw?: string; headers?: Record<string, string> } = {}): Promise<Res> {
  const res = await fetch(BASE + path, {
    method: opts.method ?? (opts.body !== undefined || opts.raw !== undefined ? "POST" : "GET"),
    redirect: "manual",
    headers: {
      ...(opts.body !== undefined || opts.raw !== undefined ? { "Content-Type": "application/json", Origin: opts.origin ?? ORIGIN } : {}),
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      ...opts.headers,
    },
    body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json, headers: res.headers };
}

/** Signs in through the real OTP endpoints and returns the session cookie. */
async function signIn(email: string): Promise<{ cookie: string; setCookie: string }> {
  const r = await call("/api/auth/request-code", { body: { email, purpose: "login" } });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const code = r.json!.data.devCode;
  expect(code, "server must run with DEMO_MODE=true").toMatch(/^\d{6}$/);
  const v = await call("/api/auth/verify", { body: { email, code } });
  expect(v.status).toBe(200);
  const setCookie = v.headers.get("set-cookie") ?? "";
  const cookie = setCookie.match(/cm_session=[^;]+/)?.[0];
  expect(cookie).toBeTruthy();
  return { cookie: cookie!, setCookie };
}

describe.skipIf(!BASE)("HTTP API", () => {
  it("health check and security headers", async () => {
    const h = await call("/api/health");
    expect(h.status).toBe(200);
    expect(h.json).toMatchObject({ ok: true, db: true });
    const page = await fetch(BASE + "/");
    expect(page.status).toBe(200);
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect(page.headers.get("x-powered-by")).toBeNull();
  });

  it("public pages render in both languages", async () => {
    for (const p of ["/", "/login", "/register", "/intake/manual", "/privacy", "/terms"]) {
      const he = await fetch(BASE + p);
      expect(he.status, p).toBe(200);
      expect(await he.text()).toContain('dir="rtl"');
      const en = await fetch(BASE + p, { headers: { Cookie: "cm_locale=en" } });
      expect(await en.text()).toContain('dir="ltr"');
    }
  });

  it("protected endpoints require a session", async () => {
    expect((await call("/api/cases")).status).toBe(401);
    expect((await call("/api/notifications")).status).toBe(401);
    expect((await call("/api/profile", { method: "PATCH", body: { name: "x" } })).status).toBe(401);
    expect((await call("/api/ai/case-summary", { body: { caseId: "00000000-0000-0000-0000-000000000000" } })).status).toBe(401);
    expect((await call("/api/payments/checkout", { body: { quoteId: "00000000-0000-0000-0000-000000000000" } })).status).toBe(401);
    const page = await fetch(BASE + "/admin", { redirect: "manual" });
    expect([302, 303, 307, 308]).toContain(page.status);
    expect(page.headers.get("location")).toContain("/login");
  });

  it("blocks cross-site requests and validates input", async () => {
    const csrf = await call("/api/auth/request-code", { body: { email: "client@example.com" }, origin: "https://evil.example" });
    expect(csrf.status).toBe(403);
    const bad = await call("/api/auth/request-code", { body: { email: "not-an-email" } });
    expect(bad.status).toBe(400);
    expect(bad.json?.error?.code).toBe("validation");
    const notJson = await call("/api/auth/request-code", { raw: "{oops" });
    expect(notJson.status).toBe(400);
    const badCode = await call("/api/auth/verify", { body: { email: "client@example.com", code: "12" } });
    expect(badCode.status).toBe(400);
  });

  it("offers registration instead of sending a code to an unknown email", async () => {
    const r = await call("/api/auth/request-code", { body: { email: `nobody-${Date.now()}@example.com`, purpose: "login" } });
    expect(r.status).toBe(404);
    expect(r.json?.error?.code).toBe("no_account");
  });

  it("session cookie is httpOnly + SameSite, and logout ends it", async () => {
    const { cookie, setCookie } = await signIn("client@example.com");
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect((await call("/api/cases", { cookie })).status).toBe(200);
    expect((await call("/api/auth/logout", { body: {}, cookie })).status).toBe(200);
    expect((await call("/api/cases", { cookie })).status).toBe(401);
  });

  it("customers see only their own cases and can't use staff endpoints", async () => {
    const client = await signIn("client@example.com");
    const biz = await signIn("biz@example.com");
    const mine = (await call("/api/cases", { cookie: client.cookie })).json!.data as { id: string }[];
    const theirs = (await call("/api/cases", { cookie: biz.cookie })).json!.data as { id: string }[];
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);
    expect(mine.some((c) => theirs.some((t) => t.id === c.id))).toBe(false);
    expect((await call(`/api/cases/${theirs[0]!.id}`, { cookie: client.cookie })).status).toBe(404);
    expect((await call(`/api/cases/${mine[0]!.id}`, { cookie: client.cookie })).status).toBe(200);
    expect((await call(`/api/cases/${mine[0]!.id}/status`, { method: "PATCH", body: { status: "completed" }, cookie: client.cookie })).status).toBe(403);
    expect((await call("/api/admin/settings", { method: "PATCH", body: { vat_rate: 0 }, cookie: client.cookie })).status).toBe(403);
    expect((await call("/api/ai/case-summary", { body: { caseId: mine[0]!.id }, cookie: client.cookie })).status).toBe(403);
    const admin = await fetch(BASE + "/admin", { headers: { Cookie: client.cookie }, redirect: "manual" });
    expect(admin.headers.get("location") ?? "").toContain("/portal");
  });

  it("the admin sees every case and the staff area", async () => {
    const admin = await signIn("admin@example.com");
    const all = (await call("/api/cases?status=all", { cookie: admin.cookie })).json!.data as unknown[];
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect((await fetch(BASE + "/admin", { headers: { Cookie: admin.cookie } })).status).toBe(200);
    expect((await fetch(BASE + "/admin/cases?status=all", { headers: { Cookie: admin.cookie } })).status).toBe(200);
  });

  it("a case manager can open a request for a client; customers can't", async () => {
    const client = await signIn("client@example.com");
    const body = { customer: { email: `phone-${Date.now()}@example.com`, name: "Phone Client", customerType: "private", locale: "he" }, title: "From a call", description: "Details", serviceCategory: "other", urgency: "normal" };
    expect((await call("/api/admin/cases", { body, cookie: client.cookie })).status).toBe(403);
    expect((await call("/api/admin/cases", { body: { ...body, title: "" }, cookie: (await signIn("manager@example.com")).cookie })).status).toBe(400);
    const manager = await signIn("manager@example.com");
    const r = await call("/api/admin/cases", { body, cookie: manager.cookie });
    expect(r.status).toBe(200);
    expect(r.json!.data.customerCreated).toBe(true);
    expect((await call(`/api/cases/${r.json!.data.id}`, { cookie: manager.cookie })).status).toBe(200);
    expect((await fetch(BASE + "/admin/cases/new", { headers: { Cookie: manager.cookie } })).status).toBe(200);
  });

  it("finance can't read case messages or documents", async () => {
    const fin = await signIn("finance@example.com");
    const cases = (await call("/api/cases?status=all", { cookie: fin.cookie })).json!.data as { id: string }[];
    const b = (await call(`/api/cases/${cases[0]!.id}`, { cookie: fin.cookie })).json!.data;
    expect(b.messages).toHaveLength(0);
    expect(b.documents).toHaveLength(0);
    expect((await call(`/api/cases/${cases[0]!.id}/messages`, { body: { body: "x" }, cookie: fin.cookie })).status).toBe(403);
  });

  it("webhooks and cron reject unsigned or unauthorised calls", async () => {
    const body = JSON.stringify({ id: "evt_x", type: "payment.succeeded", data: { paymentId: "00000000-0000-0000-0000-000000000000", amountCents: 1, currency: "ILS" } });
    const mock = await fetch(BASE + "/api/webhooks/payments", { method: "POST", body, headers: { "x-mock-signature": "forged" } });
    expect(mock.status).toBe(403);
    expect((await fetch(BASE + "/api/jobs/run")).status).toBe(401);
    expect((await fetch(BASE + "/api/jobs/run", { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
  });

  it("files and intakes are not reachable by guessing ids", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    expect((await call(`/api/files/${id}`)).status).toBe(404);
    expect((await call(`/api/files/not-a-uuid`)).status).toBe(404);
    const start = await fetch(BASE + "/api/intake", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ message: "I need a visa" }) });
    const intake = (await start.json()).data;
    const owner = start.headers.get("set-cookie")?.match(/cm_intake_owner=[^;]+/)?.[0];
    expect((await call(`/api/intake/${intake.id}`, { cookie: owner })).status).toBe(200);
    expect((await call(`/api/intake/${intake.id}`)).status).toBe(404);
    expect((await call(`/api/intake/${intake.id}/message`, { body: { content: "hi" } })).status).toBe(404);
  });
});
