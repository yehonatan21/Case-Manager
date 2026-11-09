import { describe, expect, it } from "vitest";
import { caseCreateHref, NAV_ITEMS, quickCreateFor } from "@/config/admin-navigation";

describe("Quick Create", () => {
  const keys = (role: Parameters<typeof quickCreateFor>[0]) => quickCreateFor(role).map((i) => i.key);
  it("offers each role only what it may do", () => {
    expect(keys("admin")).toEqual(["request", "task", "meeting", "event"]);
    expect(keys("case_manager")).toEqual(["request", "task", "meeting", "event"]);
    expect(keys("staff")).toEqual(["task", "meeting", "event"]);
    expect(keys("finance")).toEqual([]);
    expect(keys("customer")).toEqual([]);
  });

  it("matches the pages the role can open", () => {
    // A task, a client meeting or an event belongs to pages (Tasks, Meetings) the role has in its menu.
    for (const role of ["admin", "case_manager", "staff", "finance"] as const) {
      const menu = NAV_ITEMS.filter((i) => i.roles.includes(role)).map((i) => i.key);
      if (keys(role).includes("task")) expect(menu).toContain("tasks");
      if (keys(role).includes("event")) expect(menu).toContain("meetings");
    }
  });

  it("opens a picked case on the right tab with the form ready", () => {
    expect(caseCreateHref("c1", { tab: "tasks", intent: "task" })).toBe("/admin/cases/c1?tab=tasks&new=task");
    expect(caseCreateHref("c1", { tab: "meetings", intent: "meeting" })).toBe("/admin/cases/c1?tab=meetings&new=meeting");
  });
});
