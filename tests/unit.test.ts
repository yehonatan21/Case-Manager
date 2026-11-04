import { describe, expect, it } from "vitest";
import { he } from "@/lib/i18n/he";
import { en } from "@/lib/i18n/en";
import { caseAccess } from "@/lib/auth/permissions";
import { CLIENT_STATUS, MANUAL_TRANSITIONS, canTransition, statusAfterClientResponse, statusWhenRequestingFromClient } from "@/lib/domain";
import { caseStatusEnum } from "@/lib/db/schema";
import { computeClientActions } from "@/lib/services/cases";
import { detectCategory, detectLanguage, mockIntakeTurn } from "@/lib/ai/mock";
import { redactPII } from "@/lib/ai/redact";
import { validateUpload } from "@/lib/storage/validate";
import { signToken, verifyToken, encryptBuffer, decryptBuffer } from "@/lib/crypto";
import { fmt } from "@/lib/i18n/config";

type Tree = { [k: string]: unknown };
function leaves(obj: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof obj === "string") out.set(prefix, obj);
  else if (Array.isArray(obj)) obj.forEach((v, i) => leaves(v, `${prefix}[${i}]`).forEach((s, k) => out.set(k, s)));
  else if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj as Tree)) leaves(v, prefix ? `${prefix}.${k}` : k).forEach((s, kk) => out.set(kk, s));
  return out;
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("i18n", () => {
  const H = leaves(he);
  const E = leaves(en);
  it("Hebrew and English have exactly the same keys", () => {
    expect([...E.keys()].sort()).toEqual([...H.keys()].sort());
  });
  it("placeholders match between languages", () => {
    const mismatched = [...H.entries()].filter(([k, v]) => placeholders(v) !== placeholders(E.get(k) ?? ""));
    expect(mismatched).toEqual([]);
  });
  it("has no empty strings", () => {
    expect([...H.entries(), ...E.entries()].filter(([, v]) => !v.trim())).toEqual([]);
  });
  it("labels every internal and client status", () => {
    for (const s of caseStatusEnum.enumValues) {
      expect(he.status.internal[s]).toBeTruthy();
      expect(en.status.client[CLIENT_STATUS[s]]).toBeTruthy();
    }
  });
  it("interpolates", () => {
    expect(fmt("Case {number}", { number: "CASE-1" })).toBe("Case CASE-1");
  });
});

describe("permissions", () => {
  const owner = { id: "c1", role: "customer" as const };
  const stranger = { id: "c2", role: "customer" as const };
  const mgr = { id: "m1", role: "case_manager" as const };
  const otherMgr = { id: "m2", role: "case_manager" as const };
  const staff = { id: "s1", role: "staff" as const };
  const finance = { id: "f1", role: "finance" as const };
  const base = { caseAssigneeId: "m1", caseCustomerUserId: "c1" };

  it("customers see only their own cases, never internal data", () => {
    expect(caseAccess({ user: owner, ...base })).toMatchObject({ view: true, isClient: true, internal: false, edit: false, manageQuotes: false });
    expect(caseAccess({ user: stranger, ...base }).view).toBe(false);
  });
  it("case managers handle assigned and unassigned cases", () => {
    expect(caseAccess({ user: mgr, ...base }).manageQuotes).toBe(true);
    expect(caseAccess({ user: otherMgr, ...base }).view).toBe(false);
    expect(caseAccess({ user: otherMgr, caseAssigneeId: null, caseCustomerUserId: "c1" }).view).toBe(true);
  });
  it("staff need an assignment or a task, and cannot price", () => {
    expect(caseAccess({ user: staff, ...base }).view).toBe(false);
    expect(caseAccess({ user: staff, ...base, isTaskAssignee: true })).toMatchObject({ view: true, edit: true, manageQuotes: false });
  });
  it("finance sees quotes but not documents or messages", () => {
    expect(caseAccess({ user: finance, ...base })).toMatchObject({ view: true, viewQuotes: true, documents: false, messages: false, internal: false, edit: false });
  });
});

describe("status machine", () => {
  it("never lets staff manually skip payment or fake a sent quote", () => {
    for (const from of caseStatusEnum.enumValues) {
      expect(MANUAL_TRANSITIONS[from]).not.toContain("quote_sent");
      expect(MANUAL_TRANSITIONS[from]).not.toContain("awaiting_payment");
    }
    expect(canTransition("awaiting_payment", "active")).toBe(false);
    expect(canTransition("active", "completed")).toBe(true);
  });
  it("returns to work when the client responds", () => {
    expect(statusAfterClientResponse("awaiting_information")).toBe("under_review");
    expect(statusAfterClientResponse("awaiting_client")).toBe("active");
    expect(statusWhenRequestingFromClient("active")).toBe("awaiting_client");
    expect(statusWhenRequestingFromClient("under_review")).toBe("awaiting_information");
  });
  it("derives the client's next action", () => {
    const quote = { id: "q", status: "sent", serviceName: "S", validUntil: "2999-01-01" };
    expect(computeClientActions({ status: "quote_sent", openQuote: quote, requestedDocs: [], clientTasks: [] })[0]?.type).toBe("approve_quote");
    expect(computeClientActions({ status: "quote_sent", openQuote: { ...quote, validUntil: "2000-01-01" }, requestedDocs: [], clientTasks: [] })[0]?.type).toBe("quote_expired");
    expect(computeClientActions({ status: "awaiting_payment", openQuote: { ...quote, status: "approved" }, requestedDocs: [], clientTasks: [] })[0]?.type).toBe("pay");
    expect(computeClientActions({ status: "awaiting_client", openQuote: null, requestedDocs: [{ id: "d", title: "T", requestNote: null }], clientTasks: [] }).map((a) => a.type)).toEqual(["upload"]);
    expect(computeClientActions({ status: "active", openQuote: null, requestedDocs: [], clientTasks: [] })).toEqual([]);
  });
});

describe("offline intake engine", () => {
  const msg = (role: "user" | "assistant", content: string, extra: Record<string, unknown> = {}) => ({ id: Math.random().toString(), role, content, at: "", ...extra });
  it("classifies requests in Hebrew and English", () => {
    expect(detectCategory("אני רוצה לבדוק אפשרות לקבל אזרחות זרה")).toBe("citizenship");
    expect(detectCategory("I need help submitting a visa application")).toBe("immigration_visa");
    expect(detectCategory("I'd like advice on setting up a business")).toBe("business_setup");
    expect(detectCategory("something else entirely")).toBe("other");
  });
  it("mirrors the customer's language", () => {
    expect(detectLanguage("I need a visa", "he")).toBe("en");
    expect(detectLanguage("אני צריך ויזה", "en")).toBe("he");
  });
  it("records unknown answers as missing, never as facts", () => {
    const t1 = mockIntakeTurn({ messages: [msg("user", "I want to move abroad with my family")], locale: "en", limit: 7 });
    expect(t1.questionId).toBe("country");
    const t2 = mockIntakeTurn({ messages: [msg("user", "I want to move abroad with my family"), msg("assistant", t1.reply, { qid: t1.questionId }), msg("user", "I don't know", { skipped: true })], locale: "en", limit: 7 });
    expect(t2.summary.known_facts.find((f) => f.label === "Destination country")).toBeUndefined();
    expect(t2.summary.missing_information.join(" ")).toMatch(/country/i);
  });
  it("stops asking at the limit", () => {
    const t = mockIntakeTurn({ messages: [msg("user", "help"), msg("assistant", "q", { qid: "goal" }), msg("user", "a")], locale: "en", limit: 1 });
    expect(t.ready_for_review).toBe(true);
  });
  it("can simulate an AI outage for the manual fallback", () => {
    expect(() => mockIntakeTurn({ messages: [msg("user", "[simulate-ai-error]")], locale: "en", limit: 7 })).toThrow();
  });
});

describe("security helpers", () => {
  it("redacts direct identifiers before AI processing", () => {
    const r = redactPII("mail me at dana@example.com or 052-123-4567, card 4242 4242 4242 4242");
    expect(r).not.toMatch(/dana@example.com|052-123-4567|4242 4242/);
  });
  it("validates uploads by content, not just extension", () => {
    expect(validateUpload("a.pdf", Buffer.from("%PDF-1.7"))).toBe("application/pdf");
    expect(() => validateUpload("a.pdf", Buffer.from("MZ..."))).toThrow();
    expect(() => validateUpload("a.exe", Buffer.from("MZ..."))).toThrow();
    expect(() => validateUpload("a.png", Buffer.from("not png"))).toThrow();
  });
  it("signs short-lived tokens and encrypts files at rest", () => {
    const t = signToken("file:1", 60);
    expect(verifyToken(t)).toBe("file:1");
    expect(verifyToken(t.slice(0, -2) + "00")).toBeNull();
    const data = Buffer.from("secret document");
    const enc = encryptBuffer(data);
    expect(enc.includes(data)).toBe(false);
    expect(decryptBuffer(enc).toString()).toBe("secret document");
  });
});

describe("email sender", () => {
  it("uses EMAIL_FROM_NAME over the name in EMAIL_FROM", async () => {
    const { env } = await import("@/lib/env");
    const { senderAddress } = await import("@/lib/email");
    const saved = { ...env };
    Object.assign(env, { emailFrom: "Case Manager <office@example.com>", emailFromName: "" });
    expect(senderAddress()).toEqual({ name: "Case Manager", address: "office@example.com" });
    Object.assign(env, { emailFromName: "משרד כהן ושות׳" });
    expect(senderAddress()).toEqual({ name: "משרד כהן ושות׳", address: "office@example.com" });
    Object.assign(env, { emailFrom: "office@example.com", emailFromName: "" });
    expect(senderAddress()).toEqual({ name: saved.appName, address: "office@example.com" });
    Object.assign(env, { emailFrom: "", smtpUrl: "smtps://me%40gmail.com:pw@smtp.gmail.com:465", emailFromName: "Office" });
    expect(senderAddress()).toEqual({ name: "Office", address: "me@gmail.com" });
    Object.assign(env, saved);
  });
});
