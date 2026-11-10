import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db";
import type * as s from "@/lib/db/schema";
import { canOpenPage, STAFF_PAGES, type StaffPage } from "@/lib/auth/permissions";
import { NAV_ITEMS, QUICK_CREATE } from "@/config/admin-navigation";
import { reportAccess } from "@/lib/services/reports";
import { createStaffEvent } from "@/lib/services/staff-events";
import { SETTINGS_TABS, settingsTab } from "@/config/settings-tabs";
import { expectCode, makeUser, setupDb } from "./helpers";

const STAFF: s.UserRole[] = ["admin", "case_manager", "staff", "finance"];

describe("one access table for pages, the menu and Quick Create", () => {
  it("the menu shows a page exactly to those the page lets in", () => {
    for (const item of NAV_ITEMS) {
      for (const role of STAFF) expect(item.roles.includes(role), `${item.key} / ${role}`).toBe(canOpenPage(role, item.key as StaffPage));
    }
  });

  it("Quick Create offers an action only to those who may open where it leads", () => {
    const leadsTo: Record<string, StaffPage> = { request: "newCase", task: "tasks", meeting: "meetings", event: "meetings" };
    for (const q of QUICK_CREATE) for (const role of STAFF) expect(q.roles.includes(role), `${q.key} / ${role}`).toBe(canOpenPage(role, leadsTo[q.key]!));
  });

  it("reports and the page agree; clients open no staff page", () => {
    for (const role of [...STAFF, "customer"] as s.UserRole[]) expect(reportAccess(role) !== null, role).toBe(canOpenPage(role, "reports"));
    for (const page of Object.keys(STAFF_PAGES) as StaffPage[]) expect(canOpenPage("customer", page)).toBe(false);
  });
});

describe("calendar events follow the Meetings page", () => {
  let db: Database;
  beforeAll(async () => {
    db = await setupDb();
  });
  it("finance, who has no Meetings page, can't add events", async () => {
    const input = { title: "Lunch", date: "2026-12-01", allDay: true };
    await expectCode(createStaffEvent(db, await makeUser(db, "finance"), input), "forbidden");
    expect((await createStaffEvent(db, await makeUser(db, "staff"), input)).title).toBe("Lunch");
  });
});

describe("Settings tabs", () => {
  it("an unknown tab opens General", () => {
    expect(settingsTab("users")).toBe("users");
    expect(settingsTab("bogus")).toBe("general");
    expect(settingsTab(undefined)).toBe("general");
    expect(SETTINGS_TABS[0]).toBe("general");
  });
});
