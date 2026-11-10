import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import type * as s from "@/lib/db/schema";
import { assignCase } from "@/lib/services/cases";
import { globalSearch } from "@/lib/services/global-search";
import { parseHiddenPanels } from "@/components/admin/workspace/types";
import { caseWithSentQuote, getAdmin, makeCase, makeUser, setupDb } from "./helpers";

let db: Database;
let admin: s.User;
let member: s.User;
let mine: s.Case;
let fresh: s.Case;

beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
  member = await makeUser(db, "staff");
  const client = await makeUser(db, "customer");
  ({ c: mine } = await caseWithSentQuote(db, client, member));
  await assignCase(db, admin, mine.id, member.id);
  // A new request nobody has taken yet.
  fresh = await makeCase(db, await makeUser(db, "customer"), "Zebra crossing permit");
});

const kinds = (hits: { kind: string }[]) => [...new Set(hits.map((h) => h.kind))].sort();

describe("global search (Ctrl+K)", () => {
  it("needs at least 2 characters", async () => {
    expect(await globalSearch(db, admin, "")).toEqual([]);
    expect(await globalSearch(db, admin, "C")).toEqual([]);
  });

  it("finds cases, requests, clients and quotes for an admin, each pointing at its page", async () => {
    const byNumber = await globalSearch(db, admin, mine.number);
    expect(kinds(byNumber)).toEqual(["case", "quote"]);
    expect(byNumber.find((h) => h.kind === "case")).toMatchObject({ id: mine.id, href: `/admin/cases/${mine.id}`, ref: mine.number });
    expect(byNumber.find((h) => h.kind === "quote")!.href).toMatch(/^\/admin\/quotes\//);
    const request = await globalSearch(db, admin, "Zebra");
    expect(request).toEqual([expect.objectContaining({ kind: "request", id: fresh.id, status: "submitted" })]);
    const clients = await globalSearch(db, admin, "@example.com");
    expect(clients.some((h) => h.kind === "customer" && h.href.startsWith("/admin/customers/"))).toBe(true);
  });

  it("shows a team member only their cases, and no clients or quotes", async () => {
    const hits = await globalSearch(db, member, mine.number);
    expect(kinds(hits)).toEqual(["case"]);
    expect(await globalSearch(db, member, "Zebra")).toEqual([]);
    expect((await globalSearch(db, member, "@example.com")).every((h) => h.kind === "case")).toBe(true);
    // A new request is a plain case for those who don't handle Incoming.
    expect((await globalSearch(db, await makeUser(db, "finance"), "Zebra"))[0]?.kind).toBe("case");
  });

  it("finance sees no clients; clients find nothing", async () => {
    const finance = await makeUser(db, "finance");
    expect((await globalSearch(db, finance, "@example.com")).some((h) => h.kind === "customer")).toBe(false);
    expect(await globalSearch(db, await makeUser(db, "customer"), mine.number)).toEqual([]);
  });

  it("limits each kind", async () => {
    const hits = await globalSearch(db, admin, "Test request");
    for (const k of ["case", "request", "customer", "quote"]) expect(hits.filter((h) => h.kind === k).length).toBeLessThanOrEqual(5);
  });
});

describe("case workspace panels", () => {
  it("reads the hidden side panels from the cookie, ignoring anything else", () => {
    expect(parseHiddenPanels(undefined)).toEqual([]);
    expect(parseHiddenPanels("details,copilot")).toEqual(["details", "copilot"]);
    expect(parseHiddenPanels("copilot,evil,")).toEqual(["copilot"]);
  });
});
