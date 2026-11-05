import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { env } from "@/lib/env";
import { normalizePhone, templateParam, whatsappProvider } from "@/lib/whatsapp";
import {
  SERVICE_WINDOW_MS,
  connectWhatsApp,
  disconnectWhatsApp,
  dispatchPendingWhatsApp,
  getWhatsAppConfig,
  getWhatsAppStatus,
  handleWhatsAppWebhook,
  queueWhatsAppTest,
  setWhatsAppOptIn,
  whatsappContent,
} from "@/lib/services/whatsapp";
import { notify } from "@/lib/services/notifications";
import { postMessage } from "@/lib/services/messages";
import { assignCase, changeStatus, getCaseRow } from "@/lib/services/cases";
import { runJobs } from "@/lib/services/jobs";
import { expectCode, getAdmin, makeCase, makeUser, setupDb } from "./helpers";

let db: Database;
let admin: s.User, manager: s.User;

// ---------- A local stand-in for Meta's Graph API ----------
const PHONE_ID = "1234567890123";
const TOKEN = "EAAtest-access-token-0123456789";
const SECRET = "appsecret0123456789abcdef";
type Sent = { to: string; type: string; template?: { name: string; language: { code: string }; components: { parameters: { text: string }[] }[] }; text?: { body: string } };
let sent: Sent[] = [];
let respond: (body: Sent) => { status: number; json: unknown } = () => ({ status: 200, json: null });
let nextId = 0;
let server: http.Server;
let base = "";
const PDF = Buffer.from("%PDF-1.4 from whatsapp");

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
  manager = await makeUser(db, "case_manager");
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url!, base);
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
      };
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: { message: "Invalid OAuth access token", code: 190 } });
      if (req.method === "GET" && url.pathname === `/${PHONE_ID}`) return send(200, { display_phone_number: "+972 3-555-0100", verified_name: "Test Office", id: PHONE_ID });
      if (req.method === "POST" && url.pathname === `/${PHONE_ID}/messages`) {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Sent;
        sent.push(body);
        const r = respond(body);
        if (r.json) return send(r.status, r.json);
        return send(200, { messaging_product: "whatsapp", contacts: [{ wa_id: body.to }], messages: [{ id: `wamid.${++nextId}` }] });
      }
      if (req.method === "GET" && url.pathname === "/media-pdf") return send(200, { url: `${base}/files/pdf`, mime_type: "application/pdf" });
      if (req.method === "GET" && url.pathname === "/media-voice") return send(200, { url: `${base}/files/voice`, mime_type: "audio/ogg" });
      if (req.method === "GET" && url.pathname === "/media-evil") return send(200, { url: "http://169.254.169.254/latest/meta-data", mime_type: "application/pdf" });
      if (req.method === "GET" && url.pathname === "/files/pdf") {
        res.writeHead(200, { "content-type": "application/pdf" });
        return res.end(PDF);
      }
      if (req.method === "GET" && url.pathname === "/files/voice") {
        res.writeHead(200, { "content-type": "audio/ogg" });
        return res.end(Buffer.from("OggS fake voice"));
      }
      send(404, { error: { message: "Unknown path", code: 100 } });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  Object.assign(env, { whatsappApiUrl: base });
});
afterAll(() => server.close());
beforeEach(() => {
  sent = [];
  respond = () => ({ status: 200, json: null });
});

const connect = () => connectWhatsApp(db, admin, { phoneNumberId: PHONE_ID, accessToken: TOKEN, appSecret: SECRET, template: "case_update", templateLanguages: { he: "he", en: "en_US" } });
const rows = (userId: string) => db.select().from(s.notifications).where(and(eq(s.notifications.userId, userId), eq(s.notifications.channel, "whatsapp")));
let phoneSeq = 0;
/** A customer who opted in with a fresh Israeli mobile number. */
async function optedInCustomer(locale: "he" | "en" = "he") {
  const customer = await makeUser(db, "customer", { locale });
  const local = `052-${String(1000000 + ++phoneSeq).slice(-7)}`;
  await setWhatsAppOptIn(db, customer, { optIn: true, phone: local });
  const [u] = await db.select().from(s.users).where(eq(s.users.id, customer.id));
  return u!;
}
async function cfg() {
  return (await getWhatsAppConfig(db))!;
}
/** What Meta posts to our webhook for one incoming message. */
const inbound = (from: string, message: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: PHONE_ID }, contacts: [{ wa_id: from }], messages: [{ from, id: `wamid.in.${crypto.randomUUID()}`, timestamp: "1700000000", ...message }] } }] }],
});

describe("phone numbers and template parameters", () => {
  it("normalizes Israeli and international numbers to digits", () => {
    expect(normalizePhone("050-123-4567")).toBe("972501234567");
    expect(normalizePhone("+972 50 123 4567")).toBe("972501234567");
    expect(normalizePhone("+972 050 123 4567")).toBe("972501234567");
    expect(normalizePhone("00972501234567")).toBe("972501234567");
    expect(normalizePhone("+1 (415) 555-0100")).toBe("14155550100");
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("not a phone")).toBeNull();
  });

  it("keeps template parameters on one line, non-empty and short", () => {
    expect(templateParam("a\nb\t c     d")).toBe("a b  c   d");
    expect(templateParam("   ")).toBe("-");
    expect(templateParam("x".repeat(2000)).length).toBe(900);
  });
});

describe("connecting WhatsApp", () => {
  it("only an admin can connect, and WhatsApp must accept the credentials", async () => {
    await expectCode(connectWhatsApp(db, manager, { phoneNumberId: PHONE_ID, accessToken: TOKEN, appSecret: SECRET, template: "case_update", templateLanguages: { he: "he", en: "en" } }), "forbidden");
    await expectCode(connectWhatsApp(db, admin, { phoneNumberId: PHONE_ID, accessToken: "EAA-wrong-token-000000000", appSecret: SECRET, template: "case_update", templateLanguages: { he: "he", en: "en" } }), "whatsapp_refused");
    await expectCode(connectWhatsApp(db, admin, { phoneNumberId: "abc", accessToken: TOKEN, appSecret: SECRET, template: "case_update", templateLanguages: { he: "he", en: "en" } }), "validation");
    await expectCode(connectWhatsApp(db, admin, { phoneNumberId: PHONE_ID, accessToken: TOKEN, appSecret: SECRET, template: "Bad Name!", templateLanguages: { he: "he", en: "en" } }), "validation");
    expect((await getWhatsAppStatus(db)).connected).toBe(false);
  });

  it("stores the credentials encrypted and shows only hints, the number and the webhook details", async () => {
    await connect();
    const st = await getWhatsAppStatus(db);
    expect(st).toMatchObject({ connected: true, source: "settings", displayPhone: "+972 3-555-0100", name: "Test Office", phoneNumberIdHint: "••••0123", template: "case_update", templateLanguages: { he: "he", en: "en_US" } });
    expect(st.webhookUrl).toMatch(/\/api\/webhooks\/whatsapp$/);
    expect(st.verifyToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const json = JSON.stringify(st);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain(SECRET);
    const [row] = await db.select().from(s.settings).where(eq(s.settings.key, "integrations.whatsapp"));
    expect(JSON.stringify(row!.value)).not.toContain(TOKEN);
    // Reconnecting (e.g. a new token) keeps the verify token already pasted into Meta.
    await connect();
    expect((await getWhatsAppStatus(db)).verifyToken).toBe(st.verifyToken);
  });
});

describe("opting in", () => {
  it("needs a valid mobile number, normalizes it, and can be turned off", async () => {
    const u = await makeUser(db, "customer");
    await expectCode(setWhatsAppOptIn(db, u, { optIn: true, phone: "123" }), "whatsapp_phone_invalid");
    await expectCode(setWhatsAppOptIn(db, u, { optIn: true, phone: null }), "whatsapp_phone_invalid");
    await setWhatsAppOptIn(db, u, { optIn: true, phone: "054-7654321" });
    let [r] = await db.select().from(s.users).where(eq(s.users.id, u.id));
    expect(r!.whatsappPhone).toBe("972547654321");
    expect(r!.whatsappOptInAt).toBeInstanceOf(Date);
    await setWhatsAppOptIn(db, r!, { optIn: false });
    [r] = await db.select().from(s.users).where(eq(s.users.id, u.id));
    expect(r!.whatsappPhone).toBeNull();
    expect(r!.whatsappOptInAt).toBeNull();
  });

  it("notifications go to WhatsApp only for users who opted in", async () => {
    const yes = await optedInCustomer();
    const no = await makeUser(db, "customer");
    await notify(db, { userIds: [yes.id, no.id], type: "quote_ready", vars: { number: "C-1" }, link: "/portal/cases/x" });
    const [row] = await rows(yes.id);
    expect(row).toMatchObject({ toPhone: yes.whatsappPhone, status: "pending", link: "/portal/cases/x" });
    expect(await rows(no.id)).toHaveLength(0);
  });
});

describe("sending", () => {
  it("uses the approved template outside the 24-hour window, in the user's language", async () => {
    const u = await optedInCustomer("en");
    await notify(db, { userIds: [u.id], type: "quote_ready", vars: { number: "C-7" }, link: "/portal/cases/abc" });
    expect(await dispatchPendingWhatsApp(db)).toBeGreaterThanOrEqual(1);
    const msg = sent.find((m) => m.to === u.whatsappPhone)!;
    expect(msg.type).toBe("template");
    expect(msg.template!.name).toBe("case_update");
    expect(msg.template!.language.code).toBe("en_US");
    const params = msg.template!.components[0]!.parameters.map((p) => p.text);
    expect(params).toHaveLength(4);
    expect(params[3]).toMatch(/^https?:\/\/.+\/portal\/cases\/abc$/);
    for (const p of params) expect(p).not.toMatch(/[\n\t]/);
    const [row] = await rows(u.id);
    expect(row).toMatchObject({ status: "sent", externalId: expect.stringMatching(/^wamid\./) });
  });

  it("sends plain text within 24 hours of the user's last message", async () => {
    const u = await optedInCustomer("he");
    await db.update(s.users).set({ whatsappLastInboundAt: new Date(Date.now() - SERVICE_WINDOW_MS / 2) }).where(eq(s.users.id, u.id));
    await notify(db, { userIds: [u.id], type: "new_message", vars: { number: "C-8", preview: "שלום" }, link: "/portal/cases/def" });
    await dispatchPendingWhatsApp(db);
    const msg = sent.find((m) => m.to === u.whatsappPhone)!;
    expect(msg.type).toBe("text");
    expect(msg.text!.body).toContain("שלום");
    expect(msg.text!.body).toContain("/portal/cases/def");
  });

  it("retries temporary failures and gives up on permanent ones", async () => {
    const u = await optedInCustomer();
    respond = () => ({ status: 503, json: { error: { message: "Service unavailable", code: 131000 } } });
    await notify(db, { userIds: [u.id], type: "quote_ready", vars: { number: "C-9" } });
    await dispatchPendingWhatsApp(db);
    expect((await rows(u.id))[0]).toMatchObject({ status: "pending", attempts: 1 });
    respond = () => ({ status: 400, json: { error: { message: "Template name does not exist in the translation", code: 132001 } } });
    await dispatchPendingWhatsApp(db);
    const [row] = await rows(u.id);
    expect(row!.status).toBe("failed");
    expect(row!.error).toContain("Template name does not exist");
  });

  it("doesn't send to a user who opted out after the update was queued", async () => {
    const u = await optedInCustomer();
    await notify(db, { userIds: [u.id], type: "quote_ready", vars: { number: "C-10" } });
    await setWhatsAppOptIn(db, u, { optIn: false });
    await dispatchPendingWhatsApp(db);
    expect(sent.filter((m) => m.to === u.whatsappPhone)).toHaveLength(0);
    expect((await rows(u.id))[0]).toMatchObject({ status: "failed", error: "opted_out" });
  });

  it("the message text includes the title, the body and the link", () => {
    const c = whatsappContent("en", "Acme", { title: "New quote", body: "Quote C-1 is ready", link: "/portal/cases/1" });
    expect(c.text).toContain("*New quote*");
    expect(c.text).toMatch(/View your request: https?:\/\/.+\/portal\/cases\/1/);
    expect(c.params[0]).toBe("Acme");
  });

  it("a test message goes to the admin's own number, once they opted in", async () => {
    await expectCode(queueWhatsAppTest(db, manager), "forbidden");
    await expectCode(queueWhatsAppTest(db, admin), "whatsapp_needs_opt_in");
    await setWhatsAppOptIn(db, admin, { optIn: true, phone: "053-0000001" });
    const [a] = await db.select().from(s.users).where(eq(s.users.id, admin.id));
    await queueWhatsAppTest(db, a!);
    const res = await runJobs(db);
    expect(res.whatsappSent).toBeGreaterThanOrEqual(1);
    expect(sent.some((m) => m.to === "972530000001")).toBe(true);
    await setWhatsAppOptIn(db, a!, { optIn: false });
  });
});

describe("incoming messages (webhook)", () => {
  it("accepts only bodies signed with the app secret", async () => {
    const p = whatsappProvider(await cfg());
    const raw = JSON.stringify({ entry: [] });
    const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
    expect(p.verifySignature(raw, new Headers({ "x-hub-signature-256": sig }))).toBe(true);
    expect(p.verifySignature(raw + " ", new Headers({ "x-hub-signature-256": sig }))).toBe(false);
    expect(p.verifySignature(raw, new Headers({ "x-hub-signature-256": "sha256=" + "0".repeat(64) }))).toBe(false);
    expect(p.verifySignature(raw, new Headers())).toBe(false);
  });

  it("a reply to an update lands in that case's messages, and the team is told", async () => {
    const u = await optedInCustomer();
    const older = await makeCase(db, u, "Older request");
    const c = await makeCase(db, u, "Newer request");
    await assignCase(db, admin, older.id, manager.id);
    // The client gets an update about the older case and replies to it.
    await postMessage(db, manager, older.id, { body: "Please send the contract", kind: "thread", isInfoRequest: true });
    await dispatchPendingWhatsApp(db);
    const [upd] = (await rows(u.id)).filter((r) => r.caseId === older.id);
    expect(upd!.externalId).toBeTruthy();
    expect((await getCaseRow(db, older.id)).status).toBe("awaiting_information");

    const res = await handleWhatsAppWebhook(db, await cfg(), inbound(u.whatsappPhone!, { type: "text", text: { body: "Sent it by email" }, context: { id: upd!.externalId } }));
    expect(res).toMatchObject({ messages: 1, ignored: 0 });
    const msgs = await db.select().from(s.messages).where(eq(s.messages.caseId, older.id));
    const m = msgs.find((x) => x.body === "Sent it by email")!;
    expect(m).toMatchObject({ senderId: u.id, kind: "thread", via: "whatsapp" });
    expect(await db.select().from(s.messages).where(and(eq(s.messages.caseId, c.id), eq(s.messages.via, "whatsapp")))).toHaveLength(0);
    // The case goes back to the team, who are notified.
    expect((await getCaseRow(db, older.id)).status).toBe("under_review");
    const staff = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, manager.id), eq(s.notifications.caseId, older.id), eq(s.notifications.type, "new_message")));
    expect(staff.length).toBeGreaterThan(0);
    const [after] = await db.select().from(s.users).where(eq(s.users.id, u.id));
    expect(after!.whatsappLastInboundAt).toBeInstanceOf(Date);
  });

  it("a message that isn't a reply goes to the client's latest open case; a repeated delivery adds it once", async () => {
    const u = await optedInCustomer();
    await makeCase(db, u, "First");
    const latest = await makeCase(db, u, "Latest");
    const payload = inbound(u.whatsappPhone!, { type: "text", text: { body: "Any news?" } });
    await handleWhatsAppWebhook(db, await cfg(), payload);
    const again = await handleWhatsAppWebhook(db, await cfg(), payload);
    expect(again).toMatchObject({ messages: 0, ignored: 1 });
    const msgs = await db.select().from(s.messages).where(and(eq(s.messages.caseId, latest.id), eq(s.messages.body, "Any news?")));
    expect(msgs).toHaveLength(1);
  });

  it("ignores unknown numbers and staff, and answers a client with no open case", async () => {
    const res = await handleWhatsAppWebhook(db, await cfg(), inbound("972599999999", { type: "text", text: { body: "hi" } }));
    expect(res).toMatchObject({ messages: 0, ignored: 1 });
    await setWhatsAppOptIn(db, manager, { optIn: true, phone: "058-1112223" });
    expect(await handleWhatsAppWebhook(db, await cfg(), inbound("972581112223", { type: "text", text: { body: "hi" } }))).toMatchObject({ ignored: 1 });
    await setWhatsAppOptIn(db, manager, { optIn: false });

    const u = await optedInCustomer("en");
    const c = await makeCase(db, u, "Done");
    await changeStatus(db, admin, c.id, "cancelled");
    await handleWhatsAppWebhook(db, await cfg(), inbound(u.whatsappPhone!, { type: "text", text: { body: "hello?" } }));
    const reply = sent.find((m) => m.to === u.whatsappPhone)!;
    expect(reply.type).toBe("text");
    expect(reply.text!.body).toMatch(/couldn't find an open request/);
  });

  it("STOP opts the client out and confirms", async () => {
    const u = await optedInCustomer();
    await makeCase(db, u, "Some case");
    await handleWhatsAppWebhook(db, await cfg(), inbound(u.whatsappPhone!, { type: "text", text: { body: "STOP" } }));
    const [r] = await db.select().from(s.users).where(eq(s.users.id, u.id));
    expect(r!.whatsappOptInAt).toBeNull();
    expect(sent.find((m) => m.to === u.whatsappPhone)!.text!.body).toMatch(/הוסרת/);
    await notify(db, { userIds: [u.id], type: "quote_ready", vars: { number: "C-11" } });
    expect(await rows(u.id)).toHaveLength(0);
  });

  it("a file the client sends is added to the case's documents", async () => {
    const u = await optedInCustomer();
    const c = await makeCase(db, u, "With a file");
    await handleWhatsAppWebhook(db, await cfg(), inbound(u.whatsappPhone!, { type: "document", document: { id: "media-pdf", mime_type: "application/pdf", filename: "passport.pdf", caption: "My passport" } }));
    const docs = await db.select().from(s.documents).where(eq(s.documents.caseId, c.id));
    expect(docs.map((d) => d.title)).toContain("My passport");
    const [msg] = await db.select().from(s.messages).where(and(eq(s.messages.caseId, c.id), eq(s.messages.via, "whatsapp")));
    expect(msg!.body).toContain("passport.pdf");
  });

  it("a file type the app doesn't accept, or a file from an unexpected host, isn't added; the client is told how to upload", async () => {
    const u = await optedInCustomer("en");
    const c = await makeCase(db, u, "Voice note");
    await handleWhatsAppWebhook(db, await cfg(), inbound(u.whatsappPhone!, { type: "audio", audio: { id: "media-voice", mime_type: "audio/ogg" } }));
    await handleWhatsAppWebhook(db, await cfg(), inbound(u.whatsappPhone!, { type: "document", document: { id: "media-evil", mime_type: "application/pdf", filename: "x.pdf" } }));
    expect(await db.select().from(s.documents).where(eq(s.documents.caseId, c.id))).toHaveLength(0);
    const msgs = await db.select().from(s.messages).where(and(eq(s.messages.caseId, c.id), eq(s.messages.via, "whatsapp")));
    expect(msgs).toHaveLength(2);
    expect(msgs.every((m) => /couldn't be attached/.test(m.body))).toBe(true);
    expect(sent.filter((m) => m.to === u.whatsappPhone && /upload it here/.test(m.text?.body ?? ""))).toHaveLength(2);
  });

  it("a failed delivery reported by WhatsApp marks the update as failed", async () => {
    const u = await optedInCustomer();
    await notify(db, { userIds: [u.id], type: "quote_ready", vars: { number: "C-12" } });
    await dispatchPendingWhatsApp(db);
    const [row] = await rows(u.id);
    const payload = { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_ID }, statuses: [{ id: row!.externalId, status: "failed", recipient_id: u.whatsappPhone, errors: [{ code: 131026, title: "Message undeliverable" }] }] } }] }] };
    expect(await handleWhatsAppWebhook(db, await cfg(), payload)).toMatchObject({ statuses: 1 });
    const [after] = await rows(u.id);
    expect(after).toMatchObject({ status: "failed", error: "131026 Message undeliverable" });
  });

  it("events for another phone number of the same Meta app are ignored", async () => {
    const u = await optedInCustomer();
    await makeCase(db, u, "Case");
    const p = inbound(u.whatsappPhone!, { type: "text", text: { body: "wrong number" } });
    (p.entry[0]!.changes[0]!.value.metadata as { phone_number_id: string }).phone_number_id = "999";
    expect(await handleWhatsAppWebhook(db, await cfg(), p)).toMatchObject({ messages: 0, ignored: 0 });
  });
});

describe("disconnecting", () => {
  it("stops queuing WhatsApp messages and fails anything still queued", async () => {
    const u = await optedInCustomer();
    await notify(db, { userIds: [u.id], type: "quote_ready", vars: { number: "C-13" } });
    await expectCode(disconnectWhatsApp(db, manager), "forbidden");
    await disconnectWhatsApp(db, admin);
    expect((await getWhatsAppStatus(db)).connected).toBe(false);
    await dispatchPendingWhatsApp(db);
    expect((await rows(u.id))[0]).toMatchObject({ status: "failed", error: "not_connected" });
    await notify(db, { userIds: [u.id], type: "quote_ready", vars: { number: "C-14" } });
    expect(await rows(u.id)).toHaveLength(1);
    await expectCode(setWhatsAppOptIn(db, await makeUser(db, "customer"), { optIn: true, phone: "050-1112223" }), "whatsapp_unavailable");
  });
});
