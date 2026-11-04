import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import type * as s from "@/lib/db/schema";
import { assignCase, caseWithAccess, changeStatus, getCaseBundle, listCustomerCases, listStaffCases, publishClientUpdate } from "@/lib/services/cases";
import { postMessage } from "@/lib/services/messages";
import { requestDocument, uploadCaseDocument, authorizeDownload } from "@/lib/services/documents";
import { createTasks } from "@/lib/services/tasks";
import { approveQuote, createDraftQuote, sendQuote, updateDraftQuote } from "@/lib/services/quotes";
import { generateCaseSummary } from "@/lib/services/copilot";
import { inviteStaff, updateStaffUser } from "@/lib/services/users";
import { updateSettings } from "@/lib/services/settings";
import { upsertPriceItem, upsertTemplate } from "@/lib/services/catalog";
import { caseWithSentQuote, expectCode, getAdmin, makeCase, makeUser, quoteInput, setupDb } from "./helpers";

let db: Database;
let admin: s.User, manager: s.User, otherManager: s.User, staff: s.User, finance: s.User, customer: s.User, stranger: s.User;
let caseId: string;

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
  manager = await makeUser(db, "case_manager");
  otherManager = await makeUser(db, "case_manager");
  staff = await makeUser(db, "staff");
  finance = await makeUser(db, "finance");
  customer = await makeUser(db, "customer");
  stranger = await makeUser(db, "customer");
  caseId = (await makeCase(db, customer)).id;
});

describe("unassigned new request", () => {
  it("is visible to every case manager (inbox) but not to staff", async () => {
    await caseWithAccess(db, manager, caseId);
    await caseWithAccess(db, otherManager, caseId);
    await expectCode(caseWithAccess(db, staff, caseId), "not_found");
    expect((await listStaffCases(db, staff)).some((c) => c.id === caseId)).toBe(false);
  });
});

describe("after assignment to a case manager", () => {
  beforeAll(async () => {
    await assignCase(db, admin, caseId, manager.id);
  });

  it("other case managers lose access", async () => {
    await expectCode(caseWithAccess(db, otherManager, caseId), "not_found");
    expect((await listStaffCases(db, otherManager)).some((c) => c.id === caseId)).toBe(false);
  });

  it("staff gain access only through an assigned task, and still can't price", async () => {
    await createTasks(db, manager, caseId, [{ title: "Help", assigneeId: staff.id }]);
    const { access } = await caseWithAccess(db, staff, caseId);
    expect(access).toMatchObject({ view: true, edit: true, manageQuotes: false });
    await expectCode(createDraftQuote(db, staff, caseId), "forbidden");
  });

  it("finance sees the case and quotes but no messages, documents or AI tools", async () => {
    await postMessage(db, manager, caseId, { body: "internal", kind: "internal_note" });
    const b = await getCaseBundle(db, finance, caseId);
    expect(b.messages).toHaveLength(0);
    expect(b.documents).toHaveLength(0);
    await expectCode(postMessage(db, finance, caseId, { body: "x", kind: "thread" }), "forbidden");
    await expectCode(changeStatus(db, finance, caseId, "under_review"), "forbidden");
    await expectCode(generateCaseSummary(db, finance, caseId, "en"), "forbidden");
    await expectCode(requestDocument(db, finance, caseId, { title: "x" }), "forbidden");
  });

  it("the customer sees only client-facing data and cannot use staff actions", async () => {
    const b = await getCaseBundle(db, customer, caseId);
    expect(b.case.aiSummary).toBeNull();
    expect(b.messages.every((m) => m.kind === "thread")).toBe(true);
    expect(b.events.every((e) => e.visibility === "client")).toBe(true);
    await expectCode(postMessage(db, customer, caseId, { body: "x", kind: "internal_note" }), "forbidden");
    await expectCode(changeStatus(db, customer, caseId, "completed"), "forbidden");
    await expectCode(publishClientUpdate(db, customer, caseId, "x"), "forbidden");
    await expectCode(requestDocument(db, customer, caseId, { title: "x" }), "forbidden");
    await expectCode(createDraftQuote(db, customer, caseId), "forbidden");
    await expectCode(assignCase(db, customer, caseId, customer.id), "forbidden");
  });

  it("another customer can't see the case, its documents or its files", async () => {
    await expectCode(caseWithAccess(db, stranger, caseId), "not_found");
    expect(await listCustomerCases(db, stranger)).toHaveLength(0);
    const up = await uploadCaseDocument(db, customer, caseId, { file: { name: "a.pdf", data: Buffer.from("%PDF-1.4 x") } });
    await expectCode(authorizeDownload(db, stranger, null, up.file.id), "not_found");
    await expectCode(authorizeDownload(db, null, null, up.file.id), "unauthorized");
    await expectCode(authorizeDownload(db, finance, null, up.file.id), "not_found");
    expect((await authorizeDownload(db, customer, null, up.file.id)).id).toBe(up.file.id);
    expect((await authorizeDownload(db, manager, null, up.file.id)).id).toBe(up.file.id);
  });

  it("customers never see internal documents uploaded by staff", async () => {
    const up = await uploadCaseDocument(db, manager, caseId, { file: { name: "memo.pdf", data: Buffer.from("%PDF-1.4 memo") }, visibility: "internal" });
    const b = await getCaseBundle(db, customer, caseId);
    expect(b.documents.some((d) => d.id === up.document.id)).toBe(false);
    await expectCode(authorizeDownload(db, customer, null, up.file.id), "not_found");
    await expectCode(uploadCaseDocument(db, customer, caseId, { file: { name: "x.pdf", data: Buffer.from("%PDF-1.4") }, documentId: up.document.id }), "not_found");
  });
});

describe("quote approval rights", () => {
  it("only the case's own customer can approve", async () => {
    const { quoteId } = await caseWithSentQuote(db, customer);
    await expectCode(approveQuote(db, stranger, quoteId, null), "not_found");
    await expectCode(approveQuote(db, admin, quoteId, null), "forbidden");
    await expectCode(approveQuote(db, finance, quoteId, null), "forbidden");
    expect((await approveQuote(db, customer, quoteId, null)).status).toBe("approved");
  });

  it("customers never see draft quotes", async () => {
    const c = await makeCase(db, customer);
    const q = await createDraftQuote(db, admin, c.id);
    await updateDraftQuote(db, admin, q.id, quoteInput());
    expect((await getCaseBundle(db, customer, c.id)).quotes).toHaveLength(0);
    await sendQuote(db, admin, q.id);
    expect((await getCaseBundle(db, customer, c.id)).quotes).toHaveLength(1);
  });
});

describe("AI consent", () => {
  it("disables copilot tools for customers who declined AI processing", async () => {
    const noAi = await makeUser(db, "customer", { aiConsent: false });
    const c = await makeCase(db, noAi);
    await expectCode(generateCaseSummary(db, admin, c.id, "en"), "forbidden");
    // The background summary after submission silently skips instead of failing.
    expect(await generateCaseSummary(db, null, c.id, "en")).toBeNull();
  });
});

describe("administration is admin-only", () => {
  it("rejects non-admins for staff, settings, templates and prices", async () => {
    for (const u of [manager, staff, finance, customer]) {
      await expectCode(inviteStaff(db, u, { email: "x@example.com", name: "X", role: "staff" }), "forbidden");
      await expectCode(updateStaffUser(db, u, staff.id, { status: "disabled" }), "forbidden");
      await expectCode(updateSettings(db, u, { vat_rate: 0 }), "forbidden");
      await expectCode(upsertTemplate(db, u, { name: "T", category: "other", tasks: [] }), "forbidden");
      await expectCode(upsertPriceItem(db, u, { code: "X", name: "X", category: "other", unitPriceCents: 1, currency: "ILS" }), "forbidden");
    }
  });

  it("admins can't lock themselves out or turn staff into customers", async () => {
    await expectCode(updateStaffUser(db, admin, admin.id, { status: "disabled" }), "validation");
    await expectCode(updateStaffUser(db, admin, admin.id, { role: "staff" }), "validation");
    await expectCode(updateStaffUser(db, admin, customer.id, { role: "admin" }), "not_found");
    await expectCode(inviteStaff(db, admin, { email: admin.email, name: "dup", role: "staff" }), "conflict");
  });
});
