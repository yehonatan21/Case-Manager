/**
 * WhatsApp updates and replies.
 *
 * - An admin connects the business number (Settings → Integrations). Credentials are stored encrypted, or come
 *   from WHATSAPP_* environment variables.
 * - Users opt in on their profile with their mobile number. Every notification for an opted-in user also gets a
 *   "whatsapp" row in the notifications outbox; `dispatchPendingWhatsApp` sends it: as plain text within 24 hours
 *   of the user's last WhatsApp message (WhatsApp's customer-service window), otherwise with the approved template.
 * - Replies arrive on the signed webhook (/api/webhooks/whatsapp) and are added to the case's messages as the
 *   client; files they send are added to the case's documents. "STOP" opts the user out.
 */
import { after } from "next/server";
import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { getDb, type Database, type DbOrTx } from "../db";
import { cases, customers, messages, notifications, settings, users, type User } from "../db/schema";
import { env } from "../env";
import { AppError } from "../errors";
import { decryptBuffer, encryptBuffer, randomToken } from "../crypto";
import { dictionaries } from "../i18n/dictionaries";
import { fmt, type Locale } from "../i18n/config";
import { ALLOWED_UPLOAD_TYPES, OPEN_STATUSES, isStaffRole } from "../domain";
import { normalizePhone, templateParam, whatsappProvider, WhatsAppError, type InboundMessage, type WhatsAppConfig } from "../whatsapp";
import { audit } from "./audit";
import { getSettings } from "./settings";

const KEY = "integrations.whatsapp";
/** WhatsApp lets businesses send free-form messages for 24 hours after the user's last message. */
export const SERVICE_WINDOW_MS = 24 * 3600_000;
const MAX_ATTEMPTS = 5;

type Stored = Omit<WhatsAppConfig, "apiUrl"> & { displayPhone: string | null; name: string | null; connectedAt: string; connectedBy: string };

export type WhatsAppStatus = {
  connected: boolean;
  source: "settings" | "env" | null;
  displayPhone: string | null;
  name: string | null;
  phoneNumberIdHint: string | null;
  template: string | null;
  templateLanguages: { he: string; en: string } | null;
  connectedAt: string | null;
  /** What to paste into the Meta app's webhook settings (admins only). */
  webhookUrl: string;
  verifyToken: string | null;
};

const hint = (s: string) => (s.length <= 4 ? "••••" : `••••${s.slice(-4)}`);

async function readStored(db: DbOrTx): Promise<Stored | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const enc = (row?.value as { enc?: string } | undefined)?.enc;
  if (!enc) return null;
  try {
    return JSON.parse(decryptBuffer(Buffer.from(enc, "base64")).toString("utf8")) as Stored;
  } catch (err) {
    console.error("[whatsapp] stored connection can't be decrypted", err);
    return null;
  }
}

/** The admin's connection, else WHATSAPP_* environment variables, else null (WhatsApp off). */
export async function getWhatsAppConfig(db: DbOrTx): Promise<(WhatsAppConfig & { source: "settings" | "env" }) | null> {
  const s = await readStored(db);
  if (s) return { phoneNumberId: s.phoneNumberId, accessToken: s.accessToken, appSecret: s.appSecret, verifyToken: s.verifyToken, template: s.template, templateLanguages: s.templateLanguages, apiUrl: env.whatsappApiUrl, source: "settings" };
  if (env.whatsappPhoneNumberId && env.whatsappAccessToken && env.whatsappAppSecret) {
    return {
      phoneNumberId: env.whatsappPhoneNumberId,
      accessToken: env.whatsappAccessToken,
      appSecret: env.whatsappAppSecret,
      verifyToken: env.whatsappVerifyToken,
      template: env.whatsappTemplate,
      templateLanguages: { he: "he", en: "en" },
      apiUrl: env.whatsappApiUrl,
      source: "env",
    };
  }
  return null;
}

export async function isWhatsAppEnabled(db: DbOrTx): Promise<boolean> {
  if (env.whatsappPhoneNumberId && env.whatsappAccessToken && env.whatsappAppSecret) return true;
  const [row] = await db.select({ key: settings.key }).from(settings).where(eq(settings.key, KEY));
  return !!row;
}

export const webhookUrl = () => new URL("/api/webhooks/whatsapp", env.appUrl).toString();

export async function getWhatsAppStatus(db: DbOrTx): Promise<WhatsAppStatus> {
  const cfg = await getWhatsAppConfig(db);
  const stored = cfg?.source === "settings" ? await readStored(db) : null;
  return {
    connected: !!cfg,
    source: cfg?.source ?? null,
    displayPhone: stored?.displayPhone ?? null,
    name: stored?.name ?? null,
    phoneNumberIdHint: cfg ? hint(cfg.phoneNumberId) : null,
    template: cfg?.template ?? null,
    templateLanguages: cfg?.templateLanguages ?? null,
    connectedAt: stored?.connectedAt ?? null,
    webhookUrl: webhookUrl(),
    verifyToken: cfg?.verifyToken || null,
  };
}

const NAME = /^[a-z0-9_]{1,512}$/;
const LANG = /^[a-z]{2,3}(_[A-Z]{2})?$/;

export type ConnectInput = { phoneNumberId: string; accessToken: string; appSecret: string; template: string; templateLanguages: { he: string; en: string } };

/** Checks the credentials with WhatsApp, then stores them encrypted with a fresh webhook verify token. */
export async function connectWhatsApp(db: DbOrTx, actor: User, input: ConnectInput) {
  if (actor.role !== "admin") throw new AppError("forbidden");
  const phoneNumberId = input.phoneNumberId.trim();
  const accessToken = input.accessToken.trim();
  const appSecret = input.appSecret.trim();
  const template = input.template.trim();
  const langs = { he: input.templateLanguages.he.trim(), en: input.templateLanguages.en.trim() };
  if (!/^\d{5,30}$/.test(phoneNumberId) || accessToken.length < 20 || !/^[A-Za-z0-9]{16,64}$/.test(appSecret) || !NAME.test(template) || !LANG.test(langs.he) || !LANG.test(langs.en)) {
    throw new AppError("validation", "Invalid WhatsApp settings");
  }
  const previous = await readStored(db);
  const cfg: WhatsAppConfig = { phoneNumberId, accessToken, appSecret, verifyToken: previous?.verifyToken ?? randomToken(24), template, templateLanguages: langs, apiUrl: env.whatsappApiUrl };
  let info: { displayPhone: string | null; name: string | null };
  try {
    info = await whatsappProvider(cfg).verifyCredentials();
  } catch (err) {
    throw new AppError("whatsapp_refused", `WhatsApp refused the credentials: ${(err as Error).message}`);
  }
  const value: Stored = { ...cfg, ...info, connectedAt: new Date().toISOString(), connectedBy: actor.id };
  delete (value as Partial<WhatsAppConfig>).apiUrl;
  const enc = encryptBuffer(Buffer.from(JSON.stringify(value), "utf8")).toString("base64");
  await db
    .insert(settings)
    .values({ key: KEY, value: { enc }, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: { enc }, updatedAt: new Date() } });
  await audit(db, { actorId: actor.id, action: "whatsapp.connect", entityType: "settings", details: { phoneNumberIdHint: hint(phoneNumberId), template } });
}

export async function disconnectWhatsApp(db: DbOrTx, actor: User) {
  if (actor.role !== "admin") throw new AppError("forbidden");
  await db.delete(settings).where(eq(settings.key, KEY));
  await audit(db, { actorId: actor.id, action: "whatsapp.disconnect", entityType: "settings" });
}

/** Profile: turn WhatsApp updates on (with a mobile number) or off. */
export async function setWhatsAppOptIn(db: DbOrTx, user: Pick<User, "id" | "whatsappOptInAt" | "whatsappPhone">, input: { optIn: boolean; phone?: string | null }) {
  if (!input.optIn) {
    await db.update(users).set({ whatsappOptInAt: null, whatsappPhone: null }).where(eq(users.id, user.id));
    return;
  }
  if (!(await isWhatsAppEnabled(db))) throw new AppError("whatsapp_unavailable", "WhatsApp is not available");
  const phone = normalizePhone(input.phone);
  if (!phone) throw new AppError("whatsapp_phone_invalid", "A valid mobile number is needed for WhatsApp");
  const keep = user.whatsappOptInAt && user.whatsappPhone === phone;
  await db
    .update(users)
    .set({ whatsappPhone: phone, whatsappOptInAt: keep ? user.whatsappOptInAt : new Date() })
    .where(eq(users.id, user.id));
}

/** Users (of `ids`) who opted in to WhatsApp → their number. Empty when WhatsApp isn't connected. */
export async function whatsappRecipients(db: DbOrTx, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0 || !(await isWhatsAppEnabled(db))) return new Map();
  const rows = await db
    .select({ id: users.id, phone: users.whatsappPhone })
    .from(users)
    .where(and(inArray(users.id, ids), isNotNull(users.whatsappOptInAt), isNotNull(users.whatsappPhone)));
  return new Map(rows.map((r) => [r.id, r.phone!]));
}

const absolute = (link: string | null) => new URL(link ?? "/", env.appUrl).toString();

/** The text sent inside the 24-hour window, and the template's parameters outside it. */
export function whatsappContent(locale: Locale, company: string, n: { title: string; body: string; link: string | null }) {
  const d = dictionaries[locale].whatsapp;
  const link = absolute(n.link);
  const text = [`*${n.title}*`, n.body, fmt(d.viewLink, { link })].filter(Boolean).join("\n\n");
  return { text, params: [templateParam(company, 60), templateParam(n.title, 200), templateParam(n.body), templateParam(link, 500)] };
}

/** Sends queued WhatsApp messages. Safe to run concurrently (rows are claimed with SKIP LOCKED). */
export async function dispatchPendingWhatsApp(db: Database, limit = 50): Promise<number> {
  const claimed = await db.execute(sql`
    update notifications set attempts = attempts + 1
    where id in (
      select id from notifications
      where channel = 'whatsapp' and status = 'pending' and attempts < ${MAX_ATTEMPTS}
      order by created_at
      limit ${limit}
      for update skip locked
    )
    returning id, user_id, to_phone, title, body, link, attempts`);
  const list = (claimed as unknown as { rows: Record<string, unknown>[] }).rows ?? (claimed as unknown as Record<string, unknown>[]);
  if (list.length === 0) return 0;
  const cfg = await getWhatsAppConfig(db);
  if (!cfg) {
    await db.update(notifications).set({ status: "failed", error: "not_connected" }).where(inArray(notifications.id, list.map((n) => String(n.id))));
    return 0;
  }
  const provider = whatsappProvider(cfg);
  const company = (await getSettings(db)).company.name || env.appName;
  let sent = 0;
  for (const n of list) {
    const id = String(n.id);
    const [u] = await db.select({ locale: users.locale, lastInbound: users.whatsappLastInboundAt, optIn: users.whatsappOptInAt, phone: users.whatsappPhone }).from(users).where(eq(users.id, String(n.user_id)));
    // Opted out (or changed number) after the row was queued.
    if (!u?.optIn || !u.phone || u.phone !== n.to_phone) {
      await db.update(notifications).set({ status: "failed", error: "opted_out" }).where(eq(notifications.id, id));
      continue;
    }
    const locale = (u.locale as Locale) ?? "he";
    const content = whatsappContent(locale, company, { title: String(n.title), body: String(n.body ?? ""), link: (n.link as string) ?? null });
    const inWindow = !!u.lastInbound && Date.now() - u.lastInbound.getTime() < SERVICE_WINDOW_MS;
    try {
      const r = inWindow ? await provider.sendText(u.phone, content.text) : await provider.sendTemplate(u.phone, cfg.templateLanguages[locale], content.params);
      await db.update(notifications).set({ status: "sent", sentAt: new Date(), error: null, externalId: r.id }).where(eq(notifications.id, id));
      sent++;
    } catch (err) {
      const transient = err instanceof WhatsAppError ? err.transient : true;
      const attempts = Number(n.attempts ?? 1);
      await db
        .update(notifications)
        .set({ status: transient && attempts < MAX_ATTEMPTS ? "pending" : "failed", error: String((err as Error).message ?? err).slice(0, 500) })
        .where(eq(notifications.id, id));
    }
  }
  return sent;
}

/** Sends right after the response (or now, outside a request). Skipped in unit tests. */
export function scheduleWhatsAppDispatch() {
  if (env.isTest) return;
  const run = async () => {
    try {
      await dispatchPendingWhatsApp(await getDb());
    } catch (err) {
      console.error("[whatsapp] dispatch failed", err);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

/** "Send a test" in the settings: the template to the admin's own opted-in number. */
export async function queueWhatsAppTest(db: DbOrTx, actor: User) {
  if (actor.role !== "admin") throw new AppError("forbidden");
  if (!(await isWhatsAppEnabled(db))) throw new AppError("whatsapp_unavailable", "WhatsApp is not connected");
  if (!actor.whatsappOptInAt || !actor.whatsappPhone) throw new AppError("whatsapp_needs_opt_in", "Turn on WhatsApp updates on your profile first");
  const d = dictionaries[actor.locale ?? "he"].whatsapp;
  await db.insert(notifications).values({ userId: actor.id, type: "whatsapp_test", channel: "whatsapp", toPhone: actor.whatsappPhone, title: d.testTitle, body: d.testBody, link: "/portal/profile", status: "pending" });
}

// ---------- Incoming ----------

const STOP_WORDS = new Set(["stop", "unsubscribe", "הסר", "הסרה", "עצור", "stop."]);
const EXT_BY_MIME = Object.fromEntries(Object.entries(ALLOWED_UPLOAD_TYPES).map(([m, exts]) => [m, exts[0]!]));

export type WebhookResult = { messages: number; ignored: number; statuses: number };

/** The case a reply belongs to: the one the replied-to update was about, else the client's latest open case. */
async function caseForReply(db: DbOrTx, user: User, contextId: string | null): Promise<string | null> {
  if (contextId) {
    const [n] = await db
      .select({ caseId: notifications.caseId })
      .from(notifications)
      .where(and(eq(notifications.externalId, contextId), eq(notifications.userId, user.id)));
    if (n?.caseId) return n.caseId;
  }
  const [c] = await db
    .select({ id: cases.id })
    .from(cases)
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .where(and(eq(customers.userId, user.id), inArray(cases.status, OPEN_STATUSES)))
    .orderBy(desc(cases.updatedAt))
    .limit(1);
  return c?.id ?? null;
}

async function reply(cfg: WhatsAppConfig, to: string, text: string) {
  try {
    await whatsappProvider(cfg).sendText(to, text);
  } catch (err) {
    console.error("[whatsapp] auto-reply failed", (err as Error).message);
  }
}

async function handleMessage(db: Database, cfg: WhatsAppConfig, m: InboundMessage): Promise<boolean> {
  // A webhook can be delivered more than once.
  const [dup] = await db.select({ id: messages.id }).from(messages).where(eq(messages.externalId, m.id));
  if (dup) return false;
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.whatsappPhone, m.from), isNotNull(users.whatsappOptInAt), ne(users.status, "disabled")))
    .limit(1);
  // Unknown numbers, and staff (who answer in the app), are ignored.
  if (!user || isStaffRole(user.role)) return false;
  const d = dictionaries[(user.locale as Locale) ?? "he"].whatsapp;
  await db.update(users).set({ whatsappLastInboundAt: new Date() }).where(eq(users.id, user.id));

  if (m.text && STOP_WORDS.has(m.text.trim().toLowerCase())) {
    await db.update(users).set({ whatsappOptInAt: null, whatsappPhone: null }).where(eq(users.id, user.id));
    await reply(cfg, m.from, d.optedOut);
    return true;
  }

  const caseId = await caseForReply(db, user, m.contextId);
  if (!caseId) {
    await reply(cfg, m.from, fmt(d.noOpenCase, { link: absolute("/portal") }));
    return true;
  }

  // Imported lazily: messages/documents import notifications, which imports this module.
  const { postMessage } = await import("./messages");
  if (m.media) {
    const caption = m.media.caption?.trim() || null;
    const ext = (m.media.filename?.split(".").pop()?.toLowerCase() ?? "") || EXT_BY_MIME[m.media.mimeType?.split(";")[0]?.trim() ?? ""] || "";
    const name = m.media.filename || `whatsapp-${new Date().toISOString().slice(0, 10)}.${ext || "bin"}`;
    let uploaded = false;
    try {
      const file = await whatsappProvider(cfg).downloadMedia(m.media.id);
      const { uploadCaseDocument } = await import("./documents");
      await uploadCaseDocument(db, user, caseId, { file: { name: name.includes(".") ? name : `${name}.${ext || "bin"}`, data: file.data }, title: caption?.slice(0, 200) ?? null, visibility: "client" });
      uploaded = true;
    } catch (err) {
      console.error("[whatsapp] couldn't add the file to the case", (err as Error).message);
    }
    const body = uploaded ? (caption ? `${caption}\n\n${fmt(d.fileAdded, { name })}` : fmt(d.fileAdded, { name })) : fmt(d.fileNotAdded, { name });
    await postMessage(db, user, caseId, { body, kind: "thread", via: "whatsapp", externalId: m.id });
    if (!uploaded) await reply(cfg, m.from, fmt(d.fileRejected, { link: absolute(`/portal/cases/${caseId}?tab=documents`) }));
    return true;
  }
  const body = m.text?.trim() || fmt(d.unsupported, { kind: m.unsupported ?? "" });
  await postMessage(db, user, caseId, { body, kind: "thread", via: "whatsapp", externalId: m.id });
  return true;
}

/**
 * Processes a verified webhook delivery: replies become case messages, delivery failures are recorded.
 * Throws on unexpected errors so WhatsApp retries; duplicates are skipped by message id.
 */
export async function handleWhatsAppWebhook(db: Database, cfg: WhatsAppConfig, payload: unknown): Promise<WebhookResult> {
  const ev = whatsappProvider(cfg).parseWebhook(payload);
  const res: WebhookResult = { messages: 0, ignored: 0, statuses: 0 };
  for (const m of ev.messages) {
    try {
      if (await handleMessage(db, cfg, m)) res.messages++;
      else res.ignored++;
    } catch (err) {
      // A message that can't be posted (e.g. the case was closed meanwhile) shouldn't block the rest.
      if (err instanceof AppError) {
        console.error("[whatsapp] message not added", err.code);
        res.ignored++;
      } else throw err;
    }
  }
  for (const s of ev.statuses) {
    if (s.status !== "failed") continue;
    await db.update(notifications).set({ status: "failed", error: (s.error ?? "failed").slice(0, 500) }).where(and(eq(notifications.externalId, s.id), eq(notifications.channel, "whatsapp")));
    res.statuses++;
  }
  return res;
}
