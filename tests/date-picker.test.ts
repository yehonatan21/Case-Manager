import { describe, expect, it } from "vitest";
import { addDaysIso, addMonthsIso, clampDay, dayPresets, daysBetween, inRange, isIsoDay, monthGrid, officeTodayIso, rangePresets, weekdayOf } from "@/lib/calendar-days";

describe("the date picker's calendar", () => {
  it("lays out a month in Sunday-to-Saturday weeks, with the neighbouring days that fill them", () => {
    // November 2026 starts on a Sunday and ends on a Monday.
    const nov = monthGrid("2026-11-15");
    expect(nov).toHaveLength(5);
    expect(nov[0]![0]).toBe("2026-11-01");
    expect(nov[4]).toEqual(["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05"]);
    // February 2026 starts on a Sunday and fills exactly four weeks; March 2026 needs October-style padding.
    expect(monthGrid("2026-02-10")).toHaveLength(4);
    expect(monthGrid("2026-08-01")[0]![0]).toBe("2026-07-26");
    expect(weekdayOf("2026-11-10")).toBe(2); // a Tuesday
  });

  it("moves by days and months, keeping the day inside short months", () => {
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2024-03-01", -1)).toBe("2024-02-29");
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2026-03-15", -12)).toBe("2025-03-15");
    expect(daysBetween("2026-11-10", "2026-11-15")).toBe(5);
  });

  it("respects the earliest and latest allowed days", () => {
    expect(clampDay("2026-11-01", "2026-11-10")).toBe("2026-11-10");
    expect(clampDay("2026-12-01", undefined, "2026-11-30")).toBe("2026-11-30");
    expect(inRange("2026-11-10", "2026-11-10", "2026-11-10")).toBe(true);
    expect(inRange("2026-11-09", "2026-11-10")).toBe(false);
    expect(isIsoDay("2026-02-30")).toBe(false);
    expect(isIsoDay("2026-02-28")).toBe(true);
  });

  it("offers quick picks for one day and for ranges", () => {
    expect(dayPresets("2026-11-10")).toEqual({ today: "2026-11-10", tomorrow: "2026-11-11", nextWeek: "2026-11-17", nextMonth: "2026-12-10" });
    const r = rangePresets("2026-11-10");
    expect(r.last7).toEqual({ from: "2026-11-04", to: "2026-11-10" });
    expect(r.thisMonth).toEqual({ from: "2026-11-01", to: "2026-11-10" });
    expect(r.lastMonth).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(r.thisYear).toEqual({ from: "2026-01-01", to: "2026-11-10" });
    expect(rangePresets("2026-01-05").lastMonth).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("knows today in the office's time zone", () => {
    // 23:30 UTC on 10 November is already 11 November in Israel.
    expect(officeTodayIso(new Date("2026-11-10T23:30:00Z"))).toBe("2026-11-11");
  });
});
