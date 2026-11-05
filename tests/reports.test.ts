import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { unzipSync, strFromU8 } from "fflate";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { buildReport, reportAccess, resolvePeriod } from "@/lib/services/reports";
import { buildXlsx } from "@/lib/xlsx";
import { duration, monthLabel } from "@/lib/reports-format";
import { assignCase } from "@/lib/services/cases";
import { postMessage } from "@/lib/services/messages";
import { approveQuote } from "@/lib/services/quotes";
import { caseWithSentQuote, expectCode, getAdmin, makeCase, makeUser, setupDb } from "./helpers";

let db: Database;
let admin: s.User;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
});

describe("periods", () => {
  const now = new Date("2026-11-05T10:00:00Z");
  it("resolves presets in Israel time, and validated custom ranges", () => {
    expect(resolvePeriod({}, now)).toMatchObject({ from: "2026-10-07", to: "2026-11-05", preset: "30d" });
    expect(resolvePeriod({ preset: "7d" }, now)).toMatchObject({ from: "2026-10-30", to: "2026-11-05" });
    expect(resolvePeriod({ preset: "month" }, now)).toMatchObject({ from: "2026-11-01", to: "2026-11-05" });
    expect(resolvePeriod({ preset: "last_month" }, now)).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(resolvePeriod({ preset: "last_month" }, new Date("2026-01-15T10:00:00Z"))).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(resolvePeriod({ preset: "year" }, now)).toMatchObject({ from: "2026-01-01", to: "2026-11-05" });
    expect(resolvePeriod({ from: "2026-03-01", to: "2026-03-31" }, now)).toMatchObject({ from: "2026-03-01", to: "2026-03-31", preset: "custom" });
    // Reversed or malformed ranges fall back; very long ones are capped at two years.
    expect(resolvePeriod({ from: "2026-03-31", to: "2026-03-01" }, now).preset).toBe("30d");
    expect(resolvePeriod({ from: "nope", to: "2026-03-01" }, now).preset).toBe("30d");
    expect(resolvePeriod({ from: "2000-01-01", to: "2026-03-01" }, now).from > "2024-01-01").toBe(true);
    // Late evening UTC is already the next day in Israel.
    expect(resolvePeriod({ preset: "7d" }, new Date("2026-11-05T22:30:00Z")).to).toBe("2026-11-06");
  });

  it("formats durations and months", () => {
    const t = { hours: "{n} h", days: "{n} days" };
    expect(duration(2.25, "en", t)).toBe("2.3 h");
    expect(duration(30, "en", t)).toBe("30 h");
    expect(duration(72, "en", t)).toBe("3 days");
    expect(duration(null, "en", t)).toBe("—");
    expect(monthLabel("2026-03", "en")).toMatch(/Mar/);
  });
});

describe("access", () => {
  it("admins see everything, finance the revenue, case managers the operations; others nothing", async () => {
    expect(reportAccess("admin")).toEqual({ revenue: true, operations: true });
    expect(reportAccess("finance")).toEqual({ revenue: true, operations: false });
    expect(reportAccess("case_manager")).toEqual({ revenue: false, operations: true });
    expect(reportAccess("staff")).toBeNull();
    expect(reportAccess("customer")).toBeNull();
    const p = resolvePeriod({});
    await expectCode(buildReport(db, await makeUser(db, "staff"), p), "forbidden");
    await expectCode(buildReport(db, await makeUser(db, "customer"), p), "forbidden");
    const fin = await buildReport(db, await makeUser(db, "finance"), p);
    expect(fin.revenue).not.toBeNull();
    expect(fin.team).toBeNull();
    const cm = await buildReport(db, await makeUser(db, "case_manager"), p);
    expect(cm.revenue).toBeNull();
    expect(cm.team).not.toBeNull();
    // Amounts in the case list are only for those who see revenue.
    expect(cm.cases.every((c) => c.quoteTotalCents === null && c.paidCents === 0)).toBe(true);
  });
});

describe("the numbers", () => {
  it("counts the funnel, response times, revenue and team workload of the period", async () => {
    const before = await buildReport(db, admin, resolvePeriod({}));
    const manager = await makeUser(db, "case_manager");

    // Three new requests: one answered, one quoted and approved, one paid.
    const c1 = await makeCase(db, await makeUser(db, "customer"), "Answered");
    await assignCase(db, admin, c1.id, manager.id);
    await postMessage(db, manager, c1.id, { body: "Hello, we're on it", kind: "thread" });
    const client2 = await makeUser(db, "customer");
    const q2 = await caseWithSentQuote(db, client2, manager);
    await approveQuote(db, client2, q2.quoteId, null);
    const client3 = await makeUser(db, "customer");
    const q3 = await caseWithSentQuote(db, client3, manager);
    await approveQuote(db, client3, q3.quoteId, null);
    const [quote3] = await db.select().from(s.quotes).where(eq(s.quotes.id, q3.quoteId));
    await db.insert(s.payments).values({ caseId: q3.c.id, quoteId: q3.quoteId, provider: "mock", amountCents: quote3!.totalCents, currency: "ILS", status: "succeeded", paidAt: new Date() });
    // A payment from long ago doesn't count.
    await db.insert(s.payments).values({ caseId: q3.c.id, quoteId: q3.quoteId, provider: "mock", amountCents: 999_00, currency: "ILS", status: "succeeded", paidAt: new Date("2020-01-01T10:00:00Z") });

    const r = await buildReport(db, admin, resolvePeriod({}));
    expect(r.funnel.requests - before.funnel.requests).toBe(3);
    expect(r.funnel.quoted - before.funnel.quoted).toBe(2);
    expect(r.funnel.approved - before.funnel.approved).toBe(2);
    expect(r.funnel.paid - before.funnel.paid).toBe(1);
    expect(r.revenue!.totalCents - before.revenue!.totalCents).toBe(quote3!.totalCents);
    expect(r.revenue!.byMonth.at(-1)!.month).toBe(today().slice(0, 7));
    expect(r.revenue!.byMonth.reduce((a, m) => a + m.totalCents, 0)).toBe(r.revenue!.totalCents);
    expect(r.times.responded).toBeGreaterThanOrEqual(3);
    expect(r.times.medianFirstResponseHours).not.toBeNull();
    expect(r.times.medianFirstResponseHours!).toBeGreaterThanOrEqual(0);
    const row = r.cases.find((c) => c.id === q3.c.id)!;
    // The case's paid total covers all its payments, also ones outside the period.
    expect(row).toMatchObject({ assignee: manager.name, paidCents: quote3!.totalCents + 999_00 });
    expect(row.quoteSentAt).toBeInstanceOf(Date);
    const me = r.team!.find((m) => m.id === manager.id)!;
    expect(me).toMatchObject({ openCases: 3, newCases: 3 });
    expect(r.byType.reduce((a, x) => a + x.count, 0)).toBe(r.funnel.requests);

    // A period before any of this is empty.
    const empty = await buildReport(db, admin, { from: "2021-01-01", to: "2021-01-31" });
    expect(empty.funnel.requests).toBe(0);
    expect(empty.revenue!.totalCents).toBe(0);
    expect(empty.times.medianFirstResponseHours).toBeNull();
  });
});

describe("Excel export", () => {
  it("writes a valid workbook: sheets, escaped text, numbers, a bold header and right-to-left sheets", () => {
    const file = buildXlsx([
      { name: "סיכום", rtl: true, rows: [["מדד", "ערך"], ["הכנסות <ILS> & more", 1180.5], ["", null]] },
      { name: "Bad/Name*[x]", rows: [["A"], ["x"]] },
      { name: "סיכום", rows: [["dup"]] },
    ]);
    const files = unzipSync(file);
    expect(Object.keys(files).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml"].sort());
    const wb = strFromU8(files["xl/workbook.xml"]!);
    expect(wb).toContain('name="סיכום"');
    expect(wb).toContain('name="Bad Name  x"');
    expect(wb.match(/name="סיכום/g)!.length).toBe(2);
    const sh = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(sh).toContain('rightToLeft="1"');
    expect(sh).toContain("הכנסות &lt;ILS&gt; &amp; more");
    expect(sh).toContain("<v>1180.5</v>");
    expect(sh).toContain('<c r="A1" s="1" t="inlineStr">');
  });
});
