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
import { ERROR_CODES } from "@/lib/errors";

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
  it("every error code has a message in both languages", () => {
    for (const code of ERROR_CODES) {
      expect((he.errors as Record<string, string>)[code], `he.errors.${code}`).toBeTruthy();
      expect((en.errors as Record<string, string>)[code], `en.errors.${code}`).toBeTruthy();
    }
  });

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

describe("dates are DD/MM/YYYY everywhere", () => {
  it("shows and reads dates day first, in Hebrew and in English", async () => {
    const { formatDate, formatDateTime } = await import("@/lib/i18n/format");
    const { displayToIso, isoToDisplay } = await import("@/components/ui/date-input");
    expect(formatDate("2026-11-08", "he")).toBe("08/11/2026");
    expect(formatDate("2026-11-08", "en")).toBe("08/11/2026");
    expect(formatDateTime(new Date("2026-11-08T16:30:00Z"), "he")).toBe("08/11/2026, 18:30");
    expect(isoToDisplay("2026-03-05")).toBe("05/03/2026");
    expect(displayToIso("05/03/2026")).toBe("2026-03-05");
    expect(displayToIso("5/3/2026")).toBe("2026-03-05");
    expect(displayToIso("2026-03-05")).toBe("2026-03-05");
    expect(displayToIso("31/02/2026")).toBe("");
    expect(displayToIso("05/03/26")).toBe("");
    // Typing digits one by one adds the slashes.
    const { autoSlash } = await import("@/components/ui/date-input");
    let typed = "";
    for (const ch of "24122026") typed = autoSlash(typed + ch);
    expect(typed).toBe("24/12/2026");
    expect(autoSlash("24/1")).toBe("24/1");
    expect(autoSlash("5/3/2026")).toBe("5/3/2026");
  });
});

describe("times are 24-hour HH:MM", () => {
  it("adds the colon while typing and reads only real times", async () => {
    const { shapeTime, parseTime } = await import("@/components/ui/time-input");
    let typed = "";
    for (const ch of "1830") typed = shapeTime(typed + ch);
    expect(typed).toBe("18:30");
    expect(shapeTime("930")).toBe("9:30");
    expect(shapeTime("9:")).toBe("9:");
    expect(parseTime("9:30")).toBe("09:30");
    expect(parseTime("18:30")).toBe("18:30");
    expect(parseTime("24:00")).toBe("");
    expect(parseTime("12:6")).toBe("");
  });
});

describe("the staff menu", () => {
  it("groups items in order, shows each role only its pages, and the dev mailbox only when on", async () => {
    const { navForRole, isActive, NAV_ITEMS } = await import("@/config/admin-navigation");
    const admin = navForRole("admin", { devMailbox: false });
    expect(admin.map((g) => g.group)).toEqual(["workspace", "operations", "business", "system"]);
    expect(admin.flatMap((g) => g.items.map((i) => i.key))).toEqual(["dashboard", "queue", "inbox", "quotes", "cases", "tasks", "conversations", "meetings", "customers", "payments", "reports", "settings", "activity"]);
    expect(navForRole("admin", { devMailbox: true }).at(-1)!.items.map((i) => i.key)).toContain("mailbox");
    // Staff see no business or system groups at all.
    const staff = navForRole("staff", { devMailbox: true });
    expect(staff.map((g) => g.group)).toEqual(["workspace", "operations"]);
    expect(staff.flatMap((g) => g.items.map((i) => i.key))).not.toContain("inbox");
    const finance = navForRole("finance", { devMailbox: false }).flatMap((g) => g.items.map((i) => i.key));
    expect(finance).toEqual(["dashboard", "quotes", "cases", "payments", "reports"]);
    // Every route appears once.
    expect(new Set(NAV_ITEMS.map((i) => i.href)).size).toBe(NAV_ITEMS.length);
    const dash = NAV_ITEMS.find((i) => i.key === "dashboard")!;
    const cases = NAV_ITEMS.find((i) => i.key === "cases")!;
    expect([isActive(dash, "/admin"), isActive(dash, "/admin/cases")]).toEqual([true, false]);
    expect([isActive(cases, "/admin/cases"), isActive(cases, "/admin/cases/123"), isActive(cases, "/admin/casesx")]).toEqual([true, true, false]);
  });
});
