/**
 * HTTP-level tests against a running server (demo mode, so sign-in codes are returned).
 *   API_BASE=http://localhost:3000 npm run test:api
 * Skipped when API_BASE is not set. CI runs them against the production build.
 */
import { beforeAll, describe, expect, it } from "vitest";

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

/** One session per account for the whole file, so the suite stays under the per-email sign-in code limit (5 per 15 min). */
const sessions = new Map<string, Promise<{ cookie: string; setCookie: string }>>();
function session(email: string) {
  if (!sessions.has(email)) sessions.set(email, signIn(email));
  return sessions.get(email)!;
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
    const client = await session("client@example.com");
    const biz = await session("biz@example.com");
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
    const admin = await session("admin@example.com");
    const all = (await call("/api/cases?status=all", { cookie: admin.cookie })).json!.data as unknown[];
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect((await fetch(BASE + "/admin", { headers: { Cookie: admin.cookie } })).status).toBe(200);
    expect((await fetch(BASE + "/admin/cases?status=all", { headers: { Cookie: admin.cookie } })).status).toBe(200);
  });

  describe("opening a request for a client (POST /api/admin/cases)", () => {
    const newClient = () => ({ email: `phone-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`, name: "Phone Client", customerType: "private", locale: "he" });
    const request = { title: "From a call", description: "Details", serviceCategory: "other", urgency: "normal" };
    let manager: { cookie: string };
    beforeAll(async () => {
      manager = await session("manager@example.com");
    });

    it("requires a session and a manager or admin role", async () => {
      const body = { customer: newClient(), ...request };
      expect((await call("/api/admin/cases", { body })).status).toBe(401);
      for (const email of ["client@example.com", "staff@example.com", "finance@example.com"]) {
        expect((await call("/api/admin/cases", { body, cookie: (await session(email)).cookie })).status, email).toBe(403);
      }
    });

    it("blocks cross-site requests", async () => {
      expect((await call("/api/admin/cases", { body: { customer: newClient(), ...request }, cookie: manager.cookie, origin: "https://evil.example" })).status).toBe(403);
    });

    it("validates the input", async () => {
      const bad = [
        { customer: newClient(), ...request, title: "" },
        { customer: newClient(), ...request, description: "   " },
        { customer: newClient(), ...request, urgency: "whenever" },
        { customer: { ...newClient(), email: "not-an-email" }, ...request },
        { customer: { ...newClient(), customerType: "vip" }, ...request },
        { customer: { ...newClient(), locale: "fr" }, ...request },
        { customer: { id: "not-a-uuid" }, ...request },
        { customer: {}, ...request },
        { ...request },
      ];
      for (const body of bad) {
        const r = await call("/api/admin/cases", { body, cookie: manager.cookie });
        expect(r.status, JSON.stringify(body)).toBe(400);
        expect(r.json?.error?.code).toBe("validation");
      }
    });

    it("creates a request for a new client, who can then sign in and see it", async () => {
      const client = newClient();
      const r = await call("/api/admin/cases", { body: { customer: client, ...request }, cookie: manager.cookie });
      expect(r.status).toBe(200);
      expect(r.json!.data).toMatchObject({ customerCreated: true, number: expect.stringMatching(/^CASE-/) });
      expect((await call(`/api/cases/${r.json!.data.id}`, { cookie: manager.cookie })).status).toBe(200);
      const signedIn = await session(client.email);
      const mine = (await call("/api/cases", { cookie: signedIn.cookie })).json!.data as { id: string }[];
      expect(mine.map((c) => c.id)).toEqual([r.json!.data.id]);
      // The same email again is attached to the same client.
      const again = await call("/api/admin/cases", { body: { customer: client, ...request }, cookie: manager.cookie });
      expect(again.json!.data.customerCreated).toBe(false);
    });

    it("creates a request for an existing client by id; unknown ids and staff emails are refused", async () => {
      const admin = await session("admin@example.com");
      const r = await call("/api/admin/cases", { body: { customer: newClient(), ...request }, cookie: admin.cookie });
      const created = (await call(`/api/cases/${r.json!.data.id}`, { cookie: admin.cookie })).json!.data;
      const customerId = created.case.customerId as string;
      const byId = await call("/api/admin/cases", { body: { customer: { id: customerId }, ...request, assignToMe: false }, cookie: manager.cookie });
      expect(byId.status).toBe(200);
      expect(byId.json!.data.customerCreated).toBe(false);
      expect((await call("/api/admin/cases", { body: { customer: { id: "00000000-0000-0000-0000-000000000000" }, ...request }, cookie: manager.cookie })).status).toBe(404);
      expect((await call("/api/admin/cases", { body: { customer: { ...newClient(), email: "staff@example.com" }, ...request }, cookie: manager.cookie })).json?.error?.code).toBe("staff_email");
    });

    it("the page is for managers and admins only", async () => {
      expect((await fetch(BASE + "/admin/cases/new", { headers: { Cookie: manager.cookie } })).status).toBe(200);
      const anon = await fetch(BASE + "/admin/cases/new", { redirect: "manual" });
      expect(anon.headers.get("location") ?? "").toContain("/login");
      const client = await fetch(BASE + "/admin/cases/new", { headers: { Cookie: (await session("client@example.com")).cookie }, redirect: "manual" });
      expect(client.headers.get("location") ?? "").toContain("/portal");
      const finance = (await session("finance@example.com")).cookie;
      const fin = await fetch(BASE + "/admin/cases/new", { headers: { Cookie: finance }, redirect: "manual" });
      expect(fin.headers.get("location") ?? "").toContain("/admin/cases");
      // The "New request" button is shown to managers, not to finance.
      expect(await (await fetch(BASE + "/admin/cases", { headers: { Cookie: manager.cookie } })).text()).toContain('href="/admin/cases/new"');
      expect(await (await fetch(BASE + "/admin/cases", { headers: { Cookie: finance } })).text()).not.toContain('href="/admin/cases/new"');
    });
  });

  describe("adding team members (POST /api/admin/users)", () => {
    const unique = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
    let admin: { cookie: string };
    beforeAll(async () => {
      admin = await session("admin@example.com");
    });

    it("admins only", async () => {
      const body = { email: unique("t"), name: "T", role: "staff" };
      expect((await call("/api/admin/users", { body })).status).toBe(401);
      expect((await call("/api/admin/users", { body, cookie: (await session("manager@example.com")).cookie })).status).toBe(403);
      expect((await call("/api/admin/users", { body: { ...body, role: "customer" }, cookie: admin.cookie })).status).toBe(400);
    });

    it("invites a new email, then refuses it the second time with a clear reason", async () => {
      const body = { email: unique("new"), name: "New Member", role: "case_manager" };
      const r = await call("/api/admin/users", { body, cookie: admin.cookie });
      expect(r.status).toBe(200);
      expect(r.json!.data.outcome).toBe("invited");
      const again = await call("/api/admin/users", { body, cookie: admin.cookie });
      expect(again.status).toBe(409);
      expect(again.json?.error?.code).toBe("already_team_member");
    });

    it("someone who registered as a client (no requests) can be added to the team and reach the staff area", async () => {
      const e = unique("registered");
      const code = (await call("/api/auth/request-code", { body: { email: e, purpose: "signup" } })).json!.data.devCode;
      const reg = await call("/api/auth/verify", { body: { email: e, code, signup: { name: "Shilo", customerType: "private", acceptTerms: true, aiConsent: true } } });
      expect(reg.status).toBe(200);
      const r = await call("/api/admin/users", { body: { email: e, name: "Shilo", role: "case_manager" }, cookie: admin.cookie });
      expect(r.status).toBe(200);
      expect(r.json!.data.outcome).toBe("converted");
      const member = await signIn(e);
      expect((await fetch(BASE + "/admin", { headers: { Cookie: member.cookie } })).status).toBe(200);
    });

    it("a client with requests is refused", async () => {
      const r = await call("/api/admin/users", { body: { email: "client@example.com", name: "x", role: "staff" }, cookie: admin.cookie });
      expect(r.status).toBe(409);
      expect(r.json?.error?.code).toBe("email_is_client");
    });
  });

  describe("Grow payments", () => {
    const id = "00000000-0000-0000-0000-000000000000";

    it("server updates need the right token for the payment", async () => {
      const body = new URLSearchParams({ "data[transactionId]": "1", "data[transactionToken]": "abcdefgh12" });
      const forged = await fetch(`${BASE}/api/webhooks/grow/${id}/${"0".repeat(64)}`, { method: "POST", body });
      expect(forged.status).toBe(403);
      const notUuid = await fetch(`${BASE}/api/webhooks/grow/nope/${"0".repeat(64)}`, { method: "POST", body });
      expect(notUuid.status).toBe(403);
    });

    it("the return address only redirects into the portal", async () => {
      const r = await fetch(`${BASE}/pay/return/${id}/success`, { redirect: "manual" });
      expect(r.status).toBe(303);
      expect(new URL(r.headers.get("location")!, BASE).pathname).toBe("/portal");
      const evil = await fetch(`${BASE}/pay/return/not-a-uuid/https%3A%2F%2Fevil.example`, { redirect: "manual" });
      expect(new URL(evil.headers.get("location")!, BASE).origin).toBe(new URL(BASE!).origin);
    });

    it("only admins can connect Grow; identifiers are validated", async () => {
      const body = { userId: "4ec1d595ae764243", pageCode: "0b7a16e03b25", sandbox: true };
      expect((await call("/api/admin/payments/grow", { method: "PUT", body })).status).toBe(401);
      for (const email of ["manager@example.com", "finance@example.com", "client@example.com"]) {
        expect((await call("/api/admin/payments/grow", { method: "PUT", body, cookie: (await session(email)).cookie })).status, email).toBe(403);
      }
      const admin = await session("admin@example.com");
      expect((await call("/api/admin/payments/grow", { method: "PUT", body: { ...body, pageCode: "bad code!" }, cookie: admin.cookie })).status).toBe(400);
      expect((await call("/api/admin/payments/grow", { method: "PUT", body: { ...body, sandbox: "yes" }, cookie: admin.cookie })).status).toBe(400);
    });

    it("connecting switches checkout to Grow and disconnecting switches back; identifiers are never returned", async () => {
      const admin = await session("admin@example.com");
      try {
        const r = await call("/api/admin/payments/grow", { method: "PUT", body: { userId: "4ec1d595ae764243", pageCode: "0b7a16e03b25", sandbox: true }, cookie: admin.cookie });
        expect(r.status).toBe(200);
        expect(r.json!.data).toMatchObject({ active: "grow", grow: { connected: true, sandbox: true, userIdHint: "••••4243" } });
        expect(JSON.stringify(r.json)).not.toContain("4ec1d595ae764243");
        expect(((await call("/api/health")).json as unknown as { payments: string }).payments).toBe("grow");
        const page = await (await fetch(BASE + "/admin/payments", { headers: { Cookie: admin.cookie } })).text();
        expect(page).not.toContain("4ec1d595ae764243");
        expect(page).not.toContain("0b7a16e03b25");
      } finally {
        const d = await call("/api/admin/payments/grow", { method: "DELETE", cookie: admin.cookie });
        expect(d.status).toBe(200);
      }
      expect(((await call("/api/health")).json as unknown as { payments: string }).payments).not.toBe("grow");
    });
  });

  describe("push notifications", () => {
    const sub = () => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${Date.now()}${Math.random().toString(36).slice(2)}`, keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } });

    it("serves the service worker, manifest, icons and public key", async () => {
      const sw = await fetch(BASE + "/sw.js");
      expect(sw.status).toBe(200);
      expect(sw.headers.get("content-type")).toContain("javascript");
      expect(sw.headers.get("cache-control")).toContain("no-cache");
      expect(sw.headers.get("content-security-policy")).toContain("script-src 'self'");
      expect(await sw.text()).toContain("showNotification");
      const m = await (await fetch(BASE + "/manifest.webmanifest")).json();
      expect(m).toMatchObject({ display: "standalone", start_url: "/portal" });
      for (const icon of m.icons as { src: string }[]) expect((await fetch(BASE + icon.src)).status, icon.src).toBe(200);
      expect(await (await fetch(BASE + "/")).text()).toContain("apple-touch-icon");
      const key = (await call("/api/push/key")).json!.data.publicKey;
      expect(key).toMatch(/^[A-Za-z0-9_-]{80,90}$/);
      expect((await call("/api/push/key")).json!.data.publicKey).toBe(key); // stable
    });

    it("subscribing needs a session and a valid subscription", async () => {
      expect((await call("/api/push/subscription", { body: sub() })).status).toBe(401);
      expect((await call("/api/push/test", { body: {} })).status).toBe(401);
      const client = await session("biz@example.com");
      for (const bad of [{}, { endpoint: "not a url", keys: sub().keys }, { endpoint: sub().endpoint, keys: { p256dh: "x", auth: "y" } }, { endpoint: "https://169.254.169.254/latest", keys: sub().keys }]) {
        expect((await call("/api/push/subscription", { body: bad, cookie: client.cookie })).status, JSON.stringify(bad)).toBe(400);
      }
      expect((await call("/api/push/subscription", { body: sub(), cookie: client.cookie, origin: "https://evil.example" })).status).toBe(403);
    });

    it("turns a device on and off; the test needs a device", async () => {
      const client = await session("biz@example.com");
      expect((await call("/api/push/test", { body: {}, cookie: client.cookie })).status).toBe(400);
      const s1 = sub();
      const on = await call("/api/push/subscription", { body: s1, cookie: client.cookie });
      expect(on.status).toBe(200);
      expect(on.json!.data.devices).toBeGreaterThanOrEqual(1);
      const off = await call("/api/push/subscription", { method: "DELETE", body: { endpoint: s1.endpoint }, cookie: client.cookie });
      expect(off.json!.data.devices).toBe(on.json!.data.devices - 1);
    });
  });

  it("finance can't read case messages or documents", async () => {
    const fin = await session("finance@example.com");
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
