import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { documentChecklist, sameTitle, type ChecklistDoc } from "@/lib/checklist";
import { checklistTemplatesFor, requestDocuments, requestTemplateDocuments, sendDocumentReminders, MAX_ITEMS_PER_REQUEST } from "@/lib/services/checklists";
import { upsertTemplate } from "@/lib/services/catalog";
import { reviewDocument, uploadCaseDocument } from "@/lib/services/documents";
import { assignCase, computeClientActions, getCaseBundle, getCaseRow, changeStatus } from "@/lib/services/cases";
import { updateSettings } from "@/lib/services/settings";
import { runJobs } from "@/lib/services/jobs";
import { expectCode, getAdmin, makeCase, makeUser, setupDb } from "./helpers";

let db: Database;
let admin: s.User, manager: s.User;
let visa: s.ServiceTemplate;
const DAY = 86400_000;
const pdf = (name = "doc.pdf") => ({ name, data: Buffer.from("%PDF-1.4 test") });

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
  manager = await makeUser(db, "case_manager");
  visa = await upsertTemplate(db, admin, {
    name: "Visa checklist",
    category: "immigration_visa",
    tasks: [],
    documents: [
      { title: "Passport copy", note: "Photo page", required: true },
      { title: "Passport photo", required: true },
      { title: "Employer letter", required: true },
      { title: "CV", required: false },
    ],
  });
});

/** A case of a fresh customer, assigned to the manager. */
async function newCase() {
  const customer = await makeUser(db, "customer", { locale: "en" });
  const c = await makeCase(db, customer, "Work visa");
  await assignCase(db, admin, c.id, manager.id);
  return { customer, caseId: c.id };
}
const caseDocs = (caseId: string) => db.select().from(s.documents).where(eq(s.documents.caseId, caseId));
const notes = (userId: string, type: string) => db.select().from(s.notifications).where(and(eq(s.notifications.userId, userId), eq(s.notifications.type, type)));
const ago = (days: number) => new Date(Date.now() - days * DAY);

describe("checklist progress (shared by portal and staff)", () => {
  const doc = (over: Partial<ChecklistDoc>): ChecklistDoc => ({ id: Math.random().toString(), title: "D", status: "requested", visibility: "client", required: true, requested: true, ...over });
  it("counts required and optional documents, and what is still missing", () => {
    const list = documentChecklist([
      doc({ title: "A", status: "approved" }),
      doc({ title: "B", status: "uploaded" }),
      doc({ title: "C", status: "needs_new_version" }),
      doc({ title: "D", status: "requested" }),
      doc({ title: "E", status: "requested", required: false }),
      doc({ title: "F", status: "in_review", required: false }),
      doc({ title: "internal", visibility: "internal" }),
      doc({ title: "client's own upload", requested: false, status: "uploaded" }),
    ]);
    expect(list).toMatchObject({ required: 4, requiredProvided: 2, optional: 2, optionalProvided: 1, approved: 1, complete: false });
    expect(list.items).toHaveLength(6);
    expect(list.missing.map((x) => x.title)).toEqual(["C", "D"]);
  });

  it("is complete only when every required document is in (optional ones don't block it)", () => {
    expect(documentChecklist([doc({ status: "uploaded" }), doc({ required: false })]).complete).toBe(true);
    expect(documentChecklist([doc({ required: false })]).complete).toBe(false); // nothing required
    expect(documentChecklist([]).items).toHaveLength(0);
  });

  it("matches titles ignoring case and spacing", () => {
    expect(sameTitle("  Passport  Copy ", "passport copy")).toBe(true);
    expect(sameTitle("Passport", "Passport photo")).toBe(false);
  });
});

describe("templates", () => {
  it("store a document checklist; saving without one keeps it", async () => {
    expect(visa.documents).toEqual([
      { title: "Passport copy", note: "Photo page", required: true },
      { title: "Passport photo", required: true, note: undefined },
      { title: "Employer letter", required: true, note: undefined },
      { title: "CV", required: false, note: undefined },
    ].map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined))));
    const again = await upsertTemplate(db, admin, { id: visa.id, name: "Visa checklist", category: "immigration_visa", tasks: [] });
    expect(again.documents).toHaveLength(4);
  });

  it("are listed for a case with its own service category first, and only if they have documents", async () => {
    await upsertTemplate(db, admin, { name: "AAA other", category: "other", tasks: [], documents: [{ title: "X" }] });
    await upsertTemplate(db, admin, { name: "No docs", category: "immigration_visa", tasks: [] });
    const list = await checklistTemplatesFor(db, "immigration_visa");
    expect(list[0]!.category).toBe("immigration_visa");
    expect(list.some((t) => t.name === "No docs")).toBe(false);
    expect(list.some((t) => t.name === "AAA other")).toBe(true);
  });

  it("only admins can change them", async () => {
    await expectCode(upsertTemplate(db, manager, { name: "x", category: "other", tasks: [], documents: [{ title: "y" }] }), "forbidden");
  });
});

describe("requesting a checklist", () => {
  it("creates every document with its note and required flag, in one go", async () => {
    const { customer, caseId } = await newCase();
    const created = await requestTemplateDocuments(db, manager, caseId, visa.id);
    expect(created.map((d) => [d.title, d.required, d.status])).toEqual([
      ["Passport copy", true, "requested"],
      ["Passport photo", true, "requested"],
      ["Employer letter", true, "requested"],
      ["CV", false, "requested"],
    ]);
    expect(created[0]!.requestNote).toBe("Photo page");

    // One notification (in the app and by email) with the whole list, not four.
    const n = await notes(customer.id, "documents_requested");
    expect(n.map((x) => x.channel).sort()).toEqual(["email", "in_app"]);
    expect(n[0]!.title).toBe(`4 documents needed for case ${(await getCaseRow(db, caseId)).number}`);
    expect(n[0]!.body).toContain("• Passport copy\n• Passport photo\n• Employer letter\n• CV");
    expect(await notes(customer.id, "document_requested")).toHaveLength(0);

    // One client-visible timeline entry, and the case waits for the client.
    const b = await getCaseBundle(db, customer, caseId);
    expect(b.events.filter((e) => e.type === "documents_requested")).toHaveLength(1);
    expect((await getCaseRow(db, caseId)).status).toBe("awaiting_information");
  });

  it("can request only some of the documents", async () => {
    const { caseId } = await newCase();
    const created = await requestTemplateDocuments(db, manager, caseId, visa.id, [0, 3]);
    expect(created.map((d) => d.title)).toEqual(["Passport copy", "CV"]);
  });

  it("doesn't ask twice: documents already requested are skipped, approved ones can be asked for again", async () => {
    const { customer, caseId } = await newCase();
    await requestTemplateDocuments(db, manager, caseId, visa.id, [0]);
    expect(await requestTemplateDocuments(db, manager, caseId, visa.id, [0])).toEqual([]);
    expect(await notes(customer.id, "documents_requested")).toHaveLength(2); // in_app + email from the first request only
    const again = await requestDocuments(db, manager, caseId, [{ title: " passport COPY " }, { title: "New one" }, { title: "new ONE" }]);
    expect(again.map((d) => d.title)).toEqual(["New one"]);

    const [passport] = (await caseDocs(caseId)).filter((d) => d.title === "Passport copy");
    await uploadCaseDocument(db, customer, caseId, { file: pdf(), documentId: passport!.id });
    await reviewDocument(db, manager, passport!.id, { status: "approved" });
    expect((await requestDocuments(db, manager, caseId, [{ title: "Passport copy" }])).map((d) => d.title)).toEqual(["Passport copy"]);
  });

  it("checks permissions, the template and the list", async () => {
    const { customer, caseId } = await newCase();
    for (const u of [customer, await makeUser(db, "finance"), await makeUser(db, "staff"), await makeUser(db, "case_manager")]) {
      await expect(requestTemplateDocuments(db, u, caseId, visa.id)).rejects.toThrow();
    }
    await expectCode(requestTemplateDocuments(db, manager, caseId, "00000000-0000-0000-0000-000000000000"), "not_found");
    await expectCode(requestTemplateDocuments(db, manager, caseId, "nope"), "not_found");
    const empty = await upsertTemplate(db, admin, { name: "Empty", category: "other", tasks: [] });
    await expectCode(requestTemplateDocuments(db, manager, caseId, empty.id), "validation");
    const inactive = await upsertTemplate(db, admin, { name: "Old", category: "other", tasks: [], documents: [{ title: "x" }], active: false });
    await expectCode(requestTemplateDocuments(db, manager, caseId, inactive.id), "not_found");
    await expectCode(requestDocuments(db, manager, caseId, []), "validation");
    await expectCode(requestDocuments(db, manager, caseId, [{ title: "   " }]), "validation");
    await expectCode(requestDocuments(db, manager, caseId, Array.from({ length: MAX_ITEMS_PER_REQUEST + 1 }, (_, i) => ({ title: `D${i}` }))), "validation");
    expect(await caseDocs(caseId)).toHaveLength(0);
  });

  it("the case keeps waiting for the client until every required document is in", async () => {
    const { customer, caseId } = await newCase();
    await requestTemplateDocuments(db, manager, caseId, visa.id);
    const docs = await caseDocs(caseId);
    const byTitle = (t: string) => docs.find((d) => d.title === t)!;
    await uploadCaseDocument(db, customer, caseId, { file: pdf(), documentId: byTitle("Passport copy").id });
    await uploadCaseDocument(db, customer, caseId, { file: pdf(), documentId: byTitle("Passport photo").id });
    expect((await getCaseRow(db, caseId)).status).toBe("awaiting_information");
    // Staff still hear about each upload.
    expect((await notes(manager.id, "document_uploaded")).filter((n) => n.channel === "in_app" && n.caseId === caseId)).toHaveLength(2);
    // The last required one (the optional CV doesn't matter) hands the case back to the team.
    await uploadCaseDocument(db, customer, caseId, { file: pdf(), documentId: byTitle("Employer letter").id });
    expect((await getCaseRow(db, caseId)).status).toBe("under_review");
  });

  it("the client's to-do shows one action for several required documents, none for optional ones", async () => {
    const actions = computeClientActions({
      status: "awaiting_information",
      openQuote: null,
      requestedDocs: [
        { id: "1", title: "Passport copy", requestNote: null, required: true },
        { id: "2", title: "Passport photo", requestNote: null, required: true },
        { id: "3", title: "CV", requestNote: null, required: false },
      ],
      clientTasks: [],
    });
    // The first required one is named too: the client uploads it straight from the next-step card.
    expect(actions).toEqual([{ type: "upload_many", count: 2, titles: ["Passport copy", "Passport photo"], documentId: "1", title: "Passport copy", note: null }]);
    const one = computeClientActions({ status: "awaiting_information", openQuote: null, requestedDocs: [{ id: "1", title: "Passport", requestNote: "x", required: true }, { id: "3", title: "CV", requestNote: null, required: false }], clientTasks: [] });
    expect(one).toEqual([{ type: "upload", documentId: "1", title: "Passport", note: "x" }]);
    const onlyOptional = computeClientActions({ status: "awaiting_information", openQuote: null, requestedDocs: [{ id: "3", title: "CV", requestNote: null, required: false }], clientTasks: [] });
    expect(onlyOptional).toEqual([]);
  });
});

describe("reminders", () => {
  async function requestedCase() {
    const c = await newCase();
    await requestTemplateDocuments(db, manager, c.caseId, visa.id);
    return c;
  }
  /** Pretend the request was made `days` days ago. */
  const age = (caseId: string, days: number) => db.update(s.documents).set({ updatedAt: ago(days) }).where(eq(s.documents.caseId, caseId));
  const reminders = (userId: string) => notes(userId, "documents_reminder").then((r) => r.filter((x) => x.channel === "in_app"));

  it("nothing before the reminder interval", async () => {
    const { customer } = await requestedCase();
    await sendDocumentReminders(db);
    expect(await reminders(customer.id)).toHaveLength(0);
  });

  it("after the interval: one reminder per case listing only the required documents still missing", async () => {
    const { customer, caseId } = await requestedCase();
    const [photo] = (await caseDocs(caseId)).filter((d) => d.title === "Passport photo");
    await uploadCaseDocument(db, customer, caseId, { file: pdf(), documentId: photo!.id });
    await age(caseId, 4);

    const r = await sendDocumentReminders(db);
    expect(r.cases).toBeGreaterThanOrEqual(1);
    const [rem] = await reminders(customer.id);
    expect(rem!.title).toBe(`Reminder: documents still needed for case ${(await getCaseRow(db, caseId)).number}`);
    expect(rem!.body).toContain("2 documents are still missing");
    expect(rem!.body).toContain("• Passport copy\n• Employer letter");
    expect(rem!.body).not.toContain("CV"); // optional
    expect(rem!.body).not.toContain("Passport photo"); // uploaded
    expect((await notes(customer.id, "documents_reminder")).map((x) => x.channel).sort()).toEqual(["email", "in_app"]);

    const docs = await caseDocs(caseId);
    expect(docs.filter((d) => d.reminderCount === 1).map((d) => d.title).sort()).toEqual(["Employer letter", "Passport copy"]);
    // Staff see it in the internal history.
    expect((await getCaseBundle(db, manager, caseId)).events.some((e) => e.type === "documents_reminder")).toBe(true);
  });

  it("waits the interval again between reminders, and stops after the maximum", async () => {
    const { customer, caseId } = await requestedCase();
    await age(caseId, 4);
    await sendDocumentReminders(db);
    await sendDocumentReminders(db); // straight away: nothing new
    expect(await reminders(customer.id)).toHaveLength(1);
    for (let i = 2; i <= 5; i++) {
      await db.update(s.documents).set({ lastRemindedAt: ago(4) }).where(eq(s.documents.caseId, caseId));
      await sendDocumentReminders(db);
    }
    expect(await reminders(customer.id)).toHaveLength(3); // default maximum
  });

  it("a request for a new version starts a fresh reminder cycle", async () => {
    const { customer, caseId } = await requestedCase();
    const [passport] = (await caseDocs(caseId)).filter((d) => d.title === "Passport copy");
    await db.update(s.documents).set({ reminderCount: 3 }).where(eq(s.documents.id, passport!.id));
    await uploadCaseDocument(db, customer, caseId, { file: pdf(), documentId: passport!.id });
    await reviewDocument(db, manager, passport!.id, { status: "needs_new_version", note: "Blurry" });
    const [after] = (await caseDocs(caseId)).filter((d) => d.id === passport!.id);
    expect(after).toMatchObject({ status: "needs_new_version", reminderCount: 0, lastRemindedAt: null });
  });

  it("closed cases and the 0 = off setting send nothing", async () => {
    const closed = await requestedCase();
    await age(closed.caseId, 10);
    await changeStatus(db, admin, closed.caseId, "cancelled");
    const open = await requestedCase();
    await age(open.caseId, 10);
    await updateSettings(db, admin, { document_reminder_days: 0 });
    try {
      expect(await sendDocumentReminders(db)).toEqual({ cases: 0, documents: 0 });
    } finally {
      await updateSettings(db, admin, { document_reminder_days: 3 });
    }
    await sendDocumentReminders(db);
    expect(await reminders(closed.customer.id)).toHaveLength(0);
    expect(await reminders(open.customer.id)).toHaveLength(1);
  });

  it("the interval and maximum come from the settings", async () => {
    await updateSettings(db, admin, { document_reminder_days: 7, document_reminder_max: 1 });
    try {
      const { customer, caseId } = await requestedCase();
      await age(caseId, 5);
      await sendDocumentReminders(db);
      expect(await reminders(customer.id)).toHaveLength(0);
      await age(caseId, 8);
      await sendDocumentReminders(db);
      await db.update(s.documents).set({ lastRemindedAt: ago(8) }).where(eq(s.documents.caseId, caseId));
      await sendDocumentReminders(db);
      expect(await reminders(customer.id)).toHaveLength(1);
    } finally {
      await updateSettings(db, admin, { document_reminder_days: 3, document_reminder_max: 3 });
    }
  });

  it("run as part of the scheduled jobs", async () => {
    const { caseId } = await requestedCase();
    await age(caseId, 4);
    expect((await runJobs(db)).documentReminders).toBeGreaterThanOrEqual(1);
  });
});
