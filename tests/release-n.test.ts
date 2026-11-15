import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import type { AiProvider } from "@/lib/ai/providers";
import { postMessage } from "@/lib/services/messages";
import { uploadCaseDocument, updateDocumentDetails } from "@/lib/services/documents";
import { copilotText, readUploadedDocument } from "@/lib/services/copilot";
import { expectCode, getAdmin, makeCase, makeUser, setupDb } from "./helpers";

// The AI service in use: null is the offline engine (as in CI); a test sets a stand-in to play a real one.
const ai: { current: AiProvider | null } = { current: null };
vi.mock("@/lib/ai/providers", async (original) => ({ ...(await original<typeof import("@/lib/ai/providers")>()), getAiProvider: () => ai.current }));

let db: Database;
let admin: s.User;

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
});
beforeEach(() => {
  ai.current = null;
});

/** A stand-in AI service that "reads" every file as the same passport and records what it was asked. */
function fileReader(supportsFiles = true) {
  const calls: string[] = [];
  const provider: AiProvider = {
    id: "stand-in",
    model: "stand-in-1",
    supportsFiles,
    structured: async (req) => {
      calls.push(req.system);
      const output = { readable: true, summary: "A passport.", fields: [], notes: "", details: { doc_type: "passport", full_name: "Noa Levi", id_number: "12345678", birth_date: "1990-01-01", issue_date: null, expiry_date: "2031-05-01" } };
      return { output: output as never, model: "stand-in-1", inputTokens: 1, outputTokens: 1 };
    },
  };
  return { provider, calls };
}
const pdf = (n = 1) => ({ name: `passport-${n}.pdf`, data: Buffer.from(`%PDF-1.4 passport ${n}`) });
const details = async (id: string) => (await db.select().from(s.documents).where(eq(s.documents.id, id)))[0]!;

describe("a reply drafted for the team", () => {
  it("answers the client's last message in the client's language, using the team's notes", async () => {
    const client = await makeUser(db, "customer", { locale: "en" });
    const c = await makeCase(db, client);
    await postMessage(db, client, c.id, { body: "When will my documents be ready?", kind: "thread" });
    const en = await copilotText(db, admin, c.id, "reply", "By Thursday.", "he", "en");
    expect(en.text).toContain("When will my documents be ready?");
    expect(en.text).toContain("By Thursday.");
    expect(en.text).toMatch(/^Hello /);
    expect(en.runId).toBeTruthy();
    // Without a language for the client, it's written in the staff member's.
    const he = await copilotText(db, admin, c.id, "reply", "", "he");
    expect(he.text).toMatch(/^שלום /);
    const [run] = await db.select().from(s.aiRuns).where(eq(s.aiRuns.id, en.runId));
    expect(run).toMatchObject({ action: "text_reply", caseId: c.id, userId: admin.id });
  });

  it("is refused when the client didn't agree to AI, and for clients", async () => {
    const client = await makeUser(db, "customer", { aiConsent: false });
    const c = await makeCase(db, client);
    await expectCode(copilotText(db, admin, c.id, "reply", "", "he"), "forbidden");
    const other = await makeUser(db, "customer");
    const c2 = await makeCase(db, other);
    await expectCode(copilotText(db, other, c2.id, "reply", "", "he"), "forbidden");
  });
});

describe("an uploaded document is read automatically", () => {
  it("suggests the details for staff to confirm, when an AI service can read files", async () => {
    const client = await makeUser(db, "customer");
    const c = await makeCase(db, client);
    const up = await uploadCaseDocument(db, client, c.id, { file: pdf(), title: "Passport" });
    // No AI service (the offline engine can't read files): nothing happens.
    expect(await readUploadedDocument(db, up.document.id, "he")).toBe("skipped");
    expect((await details(up.document.id)).details).toBeNull();
    // A service that doesn't read files: the file isn't sent to it.
    const blind = fileReader(false);
    ai.current = blind.provider;
    expect(await readUploadedDocument(db, up.document.id, "he")).toBe("skipped");
    expect(blind.calls).toHaveLength(0);

    const reader = fileReader();
    ai.current = reader.provider;
    expect(await readUploadedDocument(db, up.document.id, "he")).toBe("filled");
    const row = await details(up.document.id);
    expect(row.details).toEqual({ docType: "passport", fullName: "Noa Levi", idNumber: "12345678", birthDate: "1990-01-01", expiryDate: "2031-05-01", source: "ai" });
    expect(row.detailsConfirmedById).toBeNull();
    expect(reader.calls).toHaveLength(1);
    const runs = await db.select().from(s.aiRuns).where(eq(s.aiRuns.caseId, c.id));
    expect(runs.filter((r) => r.action === "doc_analysis")).toMatchObject([{ userId: null, provider: "stand-in" }]);
  });

  it("leaves details a person saved, and files it can't read", async () => {
    const client = await makeUser(db, "customer");
    const c = await makeCase(db, client);
    const reader = fileReader();
    ai.current = reader.provider;
    const up = await uploadCaseDocument(db, client, c.id, { file: pdf(), title: "Passport" });
    await updateDocumentDetails(db, admin, up.document.id, { fullName: "Noa Levy" });
    expect(await readUploadedDocument(db, up.document.id, "he")).toBe("skipped");
    expect((await details(up.document.id)).details).toMatchObject({ fullName: "Noa Levy", source: "staff" });
    // A Word file isn't something the service reads.
    const word = await uploadCaseDocument(db, client, c.id, { file: { name: "letter.docx", data: Buffer.from("PK\u0003\u0004 word") }, title: "Letter" }).catch(() => null);
    if (word) expect(await readUploadedDocument(db, word.document.id, "he")).toBe("skipped");
    expect(await readUploadedDocument(db, crypto.randomUUID(), "he")).toBe("skipped");
    expect(reader.calls).toHaveLength(0);
  });

  it("needs the client's consent, and stops after 20 files an hour on one case", async () => {
    const reader = fileReader();
    ai.current = reader.provider;
    const quiet = await makeUser(db, "customer", { aiConsent: false });
    const qc = await makeCase(db, quiet);
    const qu = await uploadCaseDocument(db, quiet, qc.id, { file: pdf(), title: "Passport" });
    expect(await readUploadedDocument(db, qu.document.id, "he")).toBe("skipped");
    expect(reader.calls).toHaveLength(0);

    const client = await makeUser(db, "customer");
    const c = await makeCase(db, client);
    const results: string[] = [];
    for (let i = 0; i < 22; i++) {
      const up = await uploadCaseDocument(db, client, c.id, { file: pdf(i), title: `Passport ${i}` });
      results.push(await readUploadedDocument(db, up.document.id, "he"));
    }
    expect(results.filter((r) => r === "filled")).toHaveLength(20);
    expect(results.slice(20)).toEqual(["skipped", "skipped"]);
    expect(reader.calls).toHaveLength(20);
  });
});
