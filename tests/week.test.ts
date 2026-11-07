import { describe, expect, it } from "vitest";
import { defaultWeek } from "../lib/planner/week";

describe("this week", () => {
  it("is the week holding today, weekends included", () => {
    expect(defaultWeek(new Date("2026-11-07T13:49:00Z"))).toBe("2026-11-02"); // Saturday
    expect(defaultWeek(new Date("2026-11-08T21:00:00Z"))).toBe("2026-11-02"); // Sunday evening
    expect(defaultWeek(new Date("2026-11-02T08:00:00Z"))).toBe("2026-11-02"); // Monday
  });
  it("uses Irish time, not UTC", () => {
    // 00:30 Monday in Dublin summer time is still Sunday in UTC.
    expect(defaultWeek(new Date("2026-06-07T23:30:00Z"))).toBe("2026-06-08");
  });
});
