/**
 * Receipts and invoices for payments.
 *
 * - An admin connects an invoicing service (Green Invoice / Morning) under Settings → Integrations; the keys are
 *   checked with the service and stored encrypted.
 * - When a payment succeeds, a document is queued: with the service connected and "issue automatically" on, a tax
 *   document (חשבונית מס קבלה or קבלה) is issued there, emailed to the client by the service if chosen, and its PDF
 *   saved to the case's documents. With no service connected, the app saves its own payment confirmation instead
 *   (clearly marked as not a tax document).
 * - Issuing runs right after the payment and again from the jobs for anything left (retries temporary errors).
 *   Staff (admin, finance) can issue by hand, or retry a failed one, from the Payments page.
 */
import { after } from "next/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Database, type DbOrTx } from "../db";
import { cases, customers, documentFiles, documents, invoices, organizations, payments, quotes, settings, users, type Invoice, type User } from "../db/schema";
import { AppError } from "../errors";
import { env } from "../env";
import { decryptBuffer, encryptBuffer } from "../crypto";
import { dictionaries } from "../i18n/dictionaries";
import { fmt, type Locale } from "../i18n/config";
import { zonedDay } from "../meetings";
import { invoiceProvider, InvoiceError, type InvoiceConfig } from "../invoicing";
import { paymentConfirmationPdf } from "../pdf/confirmation";
import { portalCaseLink } from "./cases";
import { addEvent } from "./events";
import { notify } from "./notifications";
import { audit } from "./audit";
import { getSettings } from "./settings";
import { storeFile } from "./documents";

const KEY = "integrations.invoices";
const MAX_ATTEMPTS = 5;

type Stored = Omit<InvoiceConfig, "apiUrl"> & { businessName: string | null; connectedAt: string; connectedBy: string };

export type InvoiceStatus = {
  connected: boolean;
  provider: "greeninvoice" | null;
  sandbox: boolean;
  businessName: string | null;
  apiKeyIdHint: string | null;
  documentType: "320" | "400";
  autoIssue: boolean;
  emailClient: boolean;
  connectedAt: string | null;
};

const hint = (s: string) => (s.length <= 4 ? "••••" : `••••${s.slice(-4)}`);

async function readStored(db: DbOrTx): Promise<Stored | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const enc = (row?.value as { enc?: string } | undefined)?.enc;
  if (!enc) return null;
  try {
    return JSON.parse(decryptBuffer(Buffer.from(enc, "base64")).toString("utf8")) as Stored;
  } catch (err) {
    console.error("[invoices] stored connection can't be decrypted", err);
    return null;
  }
}

export async function getInvoiceConfig(db: DbOrTx): Promise<InvoiceConfig | null> {
  const s = await readStored(db);
  return s ? { ...s, apiUrl: env.invoiceApiUrl || null } : null;
}

export async function getInvoiceStatus(db: DbOrTx): Promise<InvoiceStatus> {
  const s = await readStored(db);
  return {
    connected: !!s,
    provider: s?.provider ?? null,
    sandbox: s?.sandbox ?? true,
    businessName: s?.businessName ?? null,
    apiKeyIdHint: s ? hint(s.apiKeyId) : null,
    documentType: s?.documentType ?? "320",
    autoIssue: s?.autoIssue ?? true,
    emailClient: s?.emailClient ?? true,
    connectedAt: s?.connectedAt ?? null,
  };
}

export type ConnectInvoicesInput = { provider: "greeninvoice"; apiKeyId: string; apiSecret: string; sandbox: boolean; documentType: "320" | "400"; autoIssue: boolean; emailClient: boolean };

/** Checks the keys with the service, then stores them encrypted. Re-saving without a secret keeps the stored keys. */
export async function connectInvoices(db: DbOrTx, actor: User, input: ConnectInvoicesInput) {
  if (actor.role !== "admin") throw new AppError("forbidden");
  const prev = await readStored(db);
  const apiKeyId = input.apiKeyId.trim() || prev?.apiKeyId || "";
  const apiSecret = input.apiSecret.trim() || prev?.apiSecret || "";
  if (!/^[\w-]{8,100}$/.test(apiKeyId) || !/^[\w-]{8,200}$/.test(apiSecret)) throw new AppError("validation", "Invalid API key");
  const cfg: InvoiceConfig = { provider: input.provider, apiKeyId, apiSecret, sandbox: input.sandbox, documentType: input.documentType, autoIssue: input.autoIssue, emailClient: input.emailClient, apiUrl: env.invoiceApiUrl || null };
  let info: { businessName: string | null };
  try {
    info = await invoiceProvider(cfg).verify();
  } catch (err) {
    throw new AppError("invoices_refused", `The invoicing service refused the keys: ${(err as Error).message}`);
  }
  const value: Stored = { provider: cfg.provider, apiKeyId, apiSecret, sandbox: cfg.sandbox, documentType: cfg.documentType, autoIssue: cfg.autoIssue, emailClient: cfg.emailClient, businessName: info.businessName, connectedAt: new Date().toISOString(), connectedBy: actor.id };
  const enc = encryptBuffer(Buffer.from(JSON.stringify(value), "utf8")).toString("base64");
  await db
    .insert(settings)
    .values({ key: KEY, value: { enc }, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: { enc }, updatedAt: new Date() } });
  await audit(db, { actorId: actor.id, action: "invoices.connect", entityType: "settings", details: { provider: cfg.provider, sandbox: cfg.sandbox, documentType: cfg.documentType, keyHint: hint(apiKeyId) } });
}

export async function disconnectInvoices(db: DbOrTx, actor: User) {
  if (actor.role !== "admin") throw new AppError("forbidden");
  await db.delete(settings).where(eq(settings.key, KEY));
  await audit(db, { actorId: actor.id, action: "invoices.disconnect", entityType: "settings" });
}

const canManage = (u: Pick<User, "role">) => u.role === "admin" || u.role === "finance";

/**
 * After a successful payment: queue its document. With a service connected but automatic issuing off, nothing is
 * queued (staff issue it by hand). Without a service, the payment confirmation is queued.
 */
export async function queueInvoiceForPayment(db: DbOrTx, paymentId: string, opts: { manual?: User } = {}) {
  const cfg = await getInvoiceConfig(db);
  if (cfg && !cfg.autoIssue && !opts.manual) return null;
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!p || p.status !== "succeeded") throw new AppError("validation", "Only a successful payment gets a document");
  const [row] = await db
    .insert(invoices)
    .values({ paymentId: p.id, caseId: p.caseId, provider: cfg?.provider ?? "confirmation", documentType: cfg ? cfg.documentType : null, status: "pending", createdById: opts.manual?.id ?? null })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

/** Staff: issue a document for a payment that has none, or retry a failed one. */
export async function issueInvoiceManually(db: Database, actor: User, paymentId: string) {
  if (!canManage(actor)) throw new AppError("forbidden");
  const [existing] = await db.select().from(invoices).where(eq(invoices.paymentId, paymentId));
  if (existing?.status === "issued") throw new AppError("conflict", "Already issued");
  if (existing) {
    // A retry uses the current connection (it may have been connected since).
    const cfg = await getInvoiceConfig(db);
    await db
      .update(invoices)
      .set({ status: "pending", attempts: 0, error: null, provider: cfg?.provider ?? "confirmation", documentType: cfg?.documentType ?? null })
      .where(eq(invoices.id, existing.id));
  } else {
    await queueInvoiceForPayment(db, paymentId, { manual: actor });
  }
  await audit(db, { actorId: actor.id, action: "invoices.issue_manual", entityType: "payment", entityId: paymentId });
  await dispatchPendingInvoices(db, 5);
  const [after] = await db.select().from(invoices).where(eq(invoices.paymentId, paymentId));
  return after!;
}

/** Everything needed to describe a payment on a document. */
async function paymentDetails(db: DbOrTx, paymentId: string) {
  const [r] = await db
    .select({ p: payments, c: cases, q: quotes, client: users, org: organizations })
    .from(payments)
    .innerJoin(cases, eq(cases.id, payments.caseId))
    .innerJoin(customers, eq(customers.id, cases.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .leftJoin(organizations, eq(organizations.id, customers.organizationId))
    .leftJoin(quotes, eq(quotes.id, payments.quoteId))
    .where(eq(payments.id, paymentId));
  return r ?? null;
}

const PROVIDER_LABEL: Record<string, string> = { grow: "Grow", stripe: "Stripe", mock: "Test checkout" };

async function issueOne(db: Database, inv: Invoice) {
  const r = await paymentDetails(db, inv.paymentId);
  if (!r) throw new InvoiceError("Payment not found", false);
  const locale = ((r.client.locale as Locale) ?? "he") as Locale;
  const d = dictionaries[locale].invoices;
  const s = await getSettings(db);
  const company = s.company.name || env.appName;
  const service = r.q?.serviceName || r.c.title;
  const paidAt = r.p.paidAt ?? r.p.createdAt;
  let file: { name: string; data: Buffer } | null = null;
  let number: string;
  let externalId: string | null = null;
  let url: string | null = null;
  let title: string;

  if (inv.provider === "confirmation") {
    number = r.p.id.slice(0, 8).toUpperCase();
    title = fmt(d.confirmationTitle, { number });
    file = {
      name: `${d.confirmationFile}-${r.c.number}.pdf`,
      data: await paymentConfirmationPdf(
        { company, companyEmail: s.company.email, companyPhone: s.company.phone, reference: r.p.id, clientName: r.org?.name || r.client.name, clientEmail: r.client.email, caseNumber: r.c.number, service, quoteVersion: r.q?.version ?? null, amountCents: r.p.amountCents, currency: r.p.currency, paidAt, provider: PROVIDER_LABEL[r.p.provider] ?? r.p.provider },
        locale,
      ),
    };
  } else {
    const cfg = await getInvoiceConfig(db);
    if (!cfg) throw new InvoiceError("The invoicing service isn't connected", false);
    const provider = invoiceProvider(cfg);
    const issued = await provider.issue({
      reference: r.p.id,
      date: zonedDay(paidAt).day,
      currency: r.p.currency,
      totalCents: r.p.amountCents,
      vatRate: Number(r.q?.taxRate ?? s.vat_rate),
      description: fmt(d.lineDescription, { service, number: r.c.number }),
      lines: [],
      client: { name: r.org?.name || r.client.name, email: r.client.email, phone: r.client.phone, taxId: r.org?.businessId ?? null },
      paymentMethod: "credit_card",
      locale,
      remarks: fmt(d.remarks, { number: r.c.number }),
    });
    number = issued.number;
    externalId = issued.externalId;
    url = issued.url;
    title = fmt(cfg.documentType === "400" ? d.receiptTitle : d.taxReceiptTitle, { number });
    const pdf = await provider.downloadPdf(issued).catch(() => null);
    if (pdf) file = { name: `${cfg.documentType === "400" ? d.receiptFile : d.taxReceiptFile}-${number}.pdf`, data: pdf };
  }

  // The PDF goes to the case's documents, where the client sees it.
  let documentId: string | null = null;
  if (file) {
    const stored = await storeFile(db, null, file, `cases/${r.c.id}`);
    documentId = await db.transaction(async (tx) => {
      const [doc] = await tx.insert(documents).values({ caseId: r.c.id, title, status: "approved", visibility: "client", currentVersion: 1 }).returning();
      await tx.insert(documentFiles).values({ documentId: doc!.id, version: 1, uploadedById: null, ...stored });
      return doc!.id;
    });
  }
  await db.update(invoices).set({ status: "issued", number, externalId, url, documentId, error: null, issuedAt: new Date() }).where(eq(invoices.id, inv.id));
  await addEvent(db, { caseId: r.c.id, type: "receipt_issued", actorKind: "system", visibility: "client", data: { title } });
  // The PDF is in the case's documents; without one (the service gave no downloadable PDF), link to the service's copy.
  const link = documentId ? `${portalCaseLink(r.c.id)}?tab=documents` : url?.startsWith("https://") ? url : portalCaseLink(r.c.id);
  await notify(db, { userIds: [r.client.id], type: documentId ? "receipt_ready" : "receipt_ready_external", caseId: r.c.id, vars: { number: r.c.number, title }, link });
  await audit(db, { action: "invoices.issued", entityType: "payment", entityId: r.p.id, details: { provider: inv.provider, number } });
}

/** Issues queued documents. Safe to run concurrently (rows are claimed with SKIP LOCKED). */
export async function dispatchPendingInvoices(db: Database, limit = 20): Promise<number> {
  const claimed = await db.execute(sql`
    update invoices set attempts = attempts + 1
    where id in (
      select id from invoices where status = 'pending' and attempts < ${MAX_ATTEMPTS}
      order by created_at limit ${limit} for update skip locked
    )
    returning id`);
  const ids = ((claimed as unknown as { rows: { id: string }[] }).rows ?? (claimed as unknown as { id: string }[])).map((x) => x.id);
  if (ids.length === 0) return 0;
  let issued = 0;
  for (const inv of await db.select().from(invoices).where(inArray(invoices.id, ids))) {
    try {
      await issueOne(db, inv);
      issued++;
    } catch (err) {
      const transient = err instanceof InvoiceError ? err.transient : false;
      const message = String((err as Error).message ?? err).slice(0, 500);
      const failed = !transient || inv.attempts >= MAX_ATTEMPTS;
      await db.update(invoices).set({ status: failed ? "failed" : "pending", error: message }).where(eq(invoices.id, inv.id));
      if (failed) {
        console.error("[invoices] couldn't issue", message);
        // Tell finance and admins, so someone fixes it and retries.
        const team = await db.select({ id: users.id }).from(users).where(and(inArray(users.role, ["admin", "finance"]), eq(users.status, "active")));
        const [c] = await db.select({ number: cases.number }).from(cases).where(eq(cases.id, inv.caseId));
        await notify(db, { userIds: team.map((t) => t.id), type: "receipt_failed", caseId: inv.caseId, vars: { number: c?.number ?? "", error: message.slice(0, 140) }, link: "/admin/payments" });
      }
    }
  }
  return issued;
}

export function scheduleInvoiceDispatch() {
  if (env.isTest) return;
  const run = async () => {
    try {
      await dispatchPendingInvoices(await getDb());
    } catch (err) {
      console.error("[invoices] dispatch failed", err);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

/** Documents per payment, for the Payments page and the client's payment list. */
export async function invoicesForPayments(db: DbOrTx, paymentIds: string[]) {
  if (paymentIds.length === 0) return new Map<string, Invoice>();
  const rows = await db.select().from(invoices).where(inArray(invoices.paymentId, paymentIds)).orderBy(desc(invoices.createdAt));
  return new Map(rows.map((r) => [r.paymentId, r]));
}
