import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database, DbOrTx } from "../db";
import { cases, customers, documents, messages, priceListItems, quotes, serviceTemplates, tasks, users, type CaseAiSummary, type User } from "../db/schema";
import { AppError } from "../errors";
import { aiCaseSummary, aiDocAnalysis, aiProviderName, aiQuoteDraft, aiTaskPlan, aiTextTool, type CaseContext } from "../ai";
import type { TextTool } from "../ai/schemas";
import { caseWithAccess, getCaseRow, type CaseBundle } from "./cases";
import { addEvent } from "./events";
import { rateLimit } from "./rate-limit";
import { env } from "../env";
import { storage } from "../storage";
import { latestFile } from "./documents";
import { addDaysIso } from "../utils";
import type { Locale } from "../i18n/config";
import { isStaffRole } from "../domain";

async function guard(db: DbOrTx, actor: User, caseId: string, need: "view" | "edit" | "manageQuotes" = "view") {
  if (!isStaffRole(actor.role)) throw new AppError("forbidden");
  const { access } = await caseWithAccess(db, actor, caseId);
  if (!access[need] || !access.internal) throw new AppError("forbidden");
  await rateLimit(db, `ai:user:${actor.id}`, env.aiMaxRunsPerHour, 3600);
}

/** Collects the case content the copilot may use (never other cases). */
export async function buildCaseContext(db: DbOrTx, caseId: string): Promise<CaseContext> {
  const c = await getCaseRow(db, caseId);
  const [cust] = await db.select({ name: users.name, userId: users.id }).from(customers).innerJoin(users, eq(users.id, customers.userId)).where(eq(customers.id, c.customerId));
  const msgs = await db
    .select({ m: messages, author: users.name })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.senderId))
    .where(eq(messages.caseId, c.id))
    .orderBy(asc(messages.createdAt));
  const docs = await db.select().from(documents).where(eq(documents.caseId, c.id)).orderBy(asc(documents.createdAt));
  const open = await db
    .select({ title: tasks.title })
    .from(tasks)
    .where(and(eq(tasks.caseId, c.id), inArray(tasks.status, ["todo", "in_progress", "waiting"])))
    .orderBy(asc(tasks.sortOrder));
  return {
    caseId: c.id,
    number: c.number,
    title: c.title,
    description: c.description,
    goal: c.goal,
    status: c.status,
    category: c.serviceCategory,
    customerName: cust?.name ?? "",
    intake: c.intakeSummary,
    messages: msgs.map((r, i) => ({
      ref: `M${i + 1}`,
      id: r.m.id,
      fromClient: r.m.senderId === cust?.userId,
      internal: r.m.kind === "internal_note",
      author: r.author ?? "",
      at: r.m.createdAt.toISOString().slice(0, 16).replace("T", " "),
      body: r.m.body,
    })),
    documents: docs.map((d, i) => ({
      ref: `D${i + 1}`,
      id: d.id,
      title: d.title,
      status: d.status,
      analysis: (d.aiAnalysis as { summary?: string } | null)?.summary ?? null,
    })),
    openTasks: open.map((t) => t.title),
  };
}

function resolveSources(ctx: CaseContext, refs: string[]): CaseAiSummary["known_facts"][number]["sources"] {
  return refs
    .map((r) => r.trim().toUpperCase())
    .map((r) => {
      if (r === "INTAKE") return { kind: "intake" as const, id: null };
      const m = ctx.messages.find((x) => x.ref === r);
      if (m) return { kind: "message" as const, id: m.id };
      const d = ctx.documents.find((x) => x.ref === r);
      if (d) return { kind: "document" as const, id: d.id };
      return null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
}

export async function generateCaseSummary(db: Database, actor: User | null, caseId: string, locale: Locale) {
  if (actor) await guard(db, actor, caseId);
  const ctx = await buildCaseContext(db, caseId);
  const { output, provider } = await aiCaseSummary(db, { ctx, locale, userId: actor?.id ?? null });
  const summary: CaseAiSummary = {
    what_client_wants: output.what_client_wants,
    known_facts: output.known_facts.map((f) => ({ fact: f.fact, sources: resolveSources(ctx, f.source_refs) })),
    missing_information: output.missing_information,
    complexities: output.complexities,
    recommended_next_step: output.recommended_next_step,
    generated_at: new Date().toISOString(),
    provider,
  };
  await db.update(cases).set({ aiSummary: summary }).where(eq(cases.id, caseId));
  await addEvent(db, { caseId, type: "ai_summary", actorKind: "ai", visibility: "internal" });
  return summary;
}

export async function copilotQuoteDraft(db: Database, actor: User, caseId: string, locale: Locale) {
  await guard(db, actor, caseId, "manageQuotes");
  const ctx = await buildCaseContext(db, caseId);
  const priceList = await db.select().from(priceListItems).where(eq(priceListItems.active, true));
  const templates = await db.select().from(serviceTemplates).where(eq(serviceTemplates.active, true));
  const { output, runId, provider } = await aiQuoteDraft(db, { ctx, locale, userId: actor.id, priceList, templates });
  // Prices come exclusively from the approved price list — never from the model.
  const items = output.items.map((i) => {
    const p = i.price_list_code ? priceList.find((x) => x.code === i.price_list_code) : undefined;
    return {
      description: i.description,
      quantity: i.quantity > 0 ? i.quantity : 1,
      unitPriceCents: p?.unitPriceCents ?? 0,
      priceListItemId: p?.id ?? null,
      needsPrice: !p,
    };
  });
  const bullets = (xs: string[]) => xs.filter(Boolean).join("\n");
  return {
    runId,
    provider,
    draft: {
      serviceName: output.service_name,
      scope: [output.scope, output.required_documents.length ? `\n${locale === "he" ? "מסמכים שיידרשו" : "Documents required"}:\n${bullets(output.required_documents)}` : ""].join(""),
      included: bullets(output.included),
      excluded: bullets(output.excluded),
      paymentTerms: output.payment_terms,
      timeline: output.timeline_estimate,
      terms: bullets(output.disclaimers),
      items,
    },
  };
}

export async function copilotTaskPlan(db: Database, actor: User, caseId: string, locale: Locale) {
  await guard(db, actor, caseId, "edit");
  const ctx = await buildCaseContext(db, caseId);
  const templates = await db.select().from(serviceTemplates).where(eq(serviceTemplates.active, true));
  const [q] = await db.select({ scope: quotes.scope }).from(quotes).where(and(eq(quotes.caseId, caseId), eq(quotes.status, "approved")));
  const { output, runId, provider } = await aiTaskPlan(db, { ctx, locale, userId: actor.id, templates, quoteScope: q?.scope });
  return {
    runId,
    provider,
    tasks: output.tasks.slice(0, 12).map((t) => ({
      title: t.title,
      description: t.description,
      requiresClientAction: t.requires_client_action,
      dueDate: t.due_in_days != null ? addDaysIso(Math.max(0, Math.round(t.due_in_days))) : null,
      priority: t.priority,
    })),
  };
}

export async function copilotText(db: Database, actor: User, caseId: string, tool: TextTool, input: string, locale: Locale, targetLang?: Locale) {
  await guard(db, actor, caseId);
  const ctx = await buildCaseContext(db, caseId);
  const { output, runId, provider } = await aiTextTool(db, { ctx, locale, userId: actor.id, tool, input, targetLang });
  return { text: output.text, runId, provider };
}

export async function copilotAnalyzeDocument(db: Database, actor: User, documentId: string, locale: Locale) {
  const [d] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!d?.caseId) throw new AppError("not_found");
  await guard(db, actor, d.caseId);
  const f = await latestFile(db, d.id);
  if (!f) throw new AppError("not_found");
  const data = await storage().get(f.storageKey);
  const { output, provider } = await aiDocAnalysis(db, { caseId: d.caseId, locale, userId: actor.id, title: d.title, mimeType: f.mimeType, data });
  const analysis = { ...output, fileId: f.id, version: f.version, provider, generated_at: new Date().toISOString() };
  await db.update(documents).set({ aiAnalysis: analysis }).where(eq(documents.id, d.id));
  return analysis;
}

export type Recommendation = { kind: "ask_client" | "prepare_quote" | "create_tasks" };

/** At most three focused recommendations, derived from the case state. */
export function recommendations(b: CaseBundle): Recommendation[] {
  const recs: Recommendation[] = [];
  const s = b.case.status;
  const missing = (b.case.aiSummary?.missing_information ?? b.case.intakeSummary?.missing_information ?? []).length;
  const hasDraftOrSent = b.quotes.some((q) => ["draft", "sent", "clarification_requested", "approved"].includes(q.status));
  if (["submitted", "under_review", "quote_preparation"].includes(s) && missing > 0) recs.push({ kind: "ask_client" });
  if (["submitted", "under_review", "quote_preparation", "declined"].includes(s) && !hasDraftOrSent) recs.push({ kind: "prepare_quote" });
  if ((s === "active" || s === "awaiting_client") && b.tasks.filter((t) => t.status !== "cancelled").length === 0) recs.push({ kind: "create_tasks" });
  return recs.slice(0, 3);
}

export function aiIsMock() {
  return aiProviderName() === "mock";
}
