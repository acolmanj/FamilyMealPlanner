import { describe, expect, it } from "vitest";
import { SheetError, inWindow, parseMenu, parseWeekHeader, syncWindow, type SheetRow } from "../lib/sheet-sync/parse";

// A small made-up "Menu" tab in the family's layout. The real sheet is not in the repo.
const seven = (s: string) => Array.from({ length: 7 }, (_, i) => `${s} ${i + 1}`);
const DAY_NAMES = ["", "Mon 23 Nov", "Tue 24 Nov", "Wed 25 Nov", "Thu 26 Nov", "Fri 27 Nov", "Sat 28 Nov", "Sun 29 Nov"];
const week = (header: string, lunch: string[] | null, dinner: string[] | null): SheetRow[] => [
  [header],
  DAY_NAMES,
  ...(lunch ? [["Lunch", ...lunch]] : []),
  ...(dinner ? [["Dinner", ...dinner]] : []),
  [],
];
const TOP: SheetRow[] = [["Weekly menu"], ["Write each meal in its box. Each week runs Monday to Sunday."], []];
const text = (w: { cells: { day: string; slot: string; text: string }[] }, day: string, slot: string) =>
  w.cells.find((c) => c.day === day && c.slot === slot)?.text;

describe("week headers", () => {
  it("reads the date in the usual ways", () => {
    expect(parseWeekHeader("Week of Monday 23 November 2026")).toBe("2026-11-23");
    expect(parseWeekHeader("  week of MONDAY  2 november 2026 ")).toBe("2026-11-02");
    expect(parseWeekHeader("Week of Mon 1 Mar 2027")).toBe("2027-03-01");
    expect(parseWeekHeader("Week of 23 November 2026")).toBe("2026-11-23");
    expect(parseWeekHeader("Week of 23/11/2026")).toBe("2026-11-23");
    expect(parseWeekHeader("Week of Monday 7/12/2026")).toBe("2026-12-07");
  });

  it("gives no date for headers it can't read", () => {
    expect(parseWeekHeader("Week of Monday 31 February 2026")).toBeNull();
    expect(parseWeekHeader("Week of Monday 23 Novembre 2026")).toBeNull();
    expect(parseWeekHeader("Week of next Monday")).toBeNull();
    expect(parseWeekHeader("Weekly menu")).toBeNull();
  });
});

describe("the Menu tab", () => {
  it("reads each week block by its header date", () => {
    const rows = [
      ...TOP,
      ...week("Week of Monday 16 November 2026", seven("L16"), seven("D16")),
      ...week("Week of Monday 23 November 2026", seven("L23"), seven("D23")),
    ];
    const { weeks, problems } = parseMenu(rows);
    expect(problems).toEqual([]);
    expect(weeks.map((w) => w.weekStart)).toEqual(["2026-11-16", "2026-11-23"]);
    const last = weeks[1];
    expect(last.cells).toHaveLength(14);
    expect(last.cells[0]).toEqual({ day: "mon", slot: "lunch", text: "L23 1" });
    expect(last.cells[13]).toEqual({ day: "sun", slot: "dinner", text: "D23 7" });
    // The day names row and the title are never read as meals.
    expect(weeks.flatMap((w) => w.cells).some((c) => /Nov|Weekly|Write/.test(c.text))).toBe(false);
  });

  it("is fine with extra blank rows and short rows", () => {
    const rows: SheetRow[] = [
      ...TOP,
      [],
      ["Week of Monday 23 November 2026"],
      [],
      DAY_NAMES,
      [""],
      ["Lunch", "Pasta boloñesa", "", "  Curry  con lentejas "],
      [],
      [],
      ["Dinner"],
    ];
    const [w] = parseMenu(rows).weeks;
    expect(w.cells.map((c) => c.text)).toEqual(["Pasta boloñesa", "", "Curry con lentejas", ...Array(11).fill("")]);
  });

  it("reads Lunch and Dinner in either order", () => {
    const rows: SheetRow[] = [["Week of Monday 23 November 2026"], DAY_NAMES, ["dinner", ...seven("D")], ["LUNCH ", ...seven("L")]];
    const [w] = parseMenu(rows).weeks;
    expect(text(w, "mon", "lunch")).toBe("L 1");
    expect(text(w, "sun", "dinner")).toBe("D 7");
  });

  it("counts a missing Dinner row as empty cells", () => {
    const [w] = parseMenu(week("Week of Monday 23 November 2026", seven("L"), null)).weeks;
    expect(w.cells.filter((c) => c.slot === "dinner").map((c) => c.text)).toEqual(Array(7).fill(""));
    expect(text(w, "fri", "lunch")).toBe("L 5");
  });

  it("skips a week whose header is not a Monday, and still reads the others", () => {
    const rows = [
      ...TOP,
      ...week("Week of Monday 16 November 2026", seven("L16"), seven("D16")),
      ...week("Week of Monday 24 November 2026", seven("Lx"), seven("Dx")),
      ...week("Week of Monday 30 November 2026", seven("L30"), seven("D30")),
    ];
    const { weeks, problems } = parseMenu(rows);
    expect(weeks.map((w) => w.weekStart)).toEqual(["2026-11-16", "2026-11-30"]);
    expect(weeks.flatMap((w) => w.cells).some((c) => c.text.startsWith("Lx"))).toBe(false);
    expect(problems).toEqual([
      { weekStart: "2026-11-23", message: "Week header 'Week of Monday 24 November 2026' (row 9) is not a Monday, so that week was skipped" },
    ]);
  });

  it("skips a header with a date it can't read, without mixing its meals into the week before", () => {
    const rows = [...week("Week of Monday 16 November 2026", seven("L16"), seven("D16")), ...week("Week of Monday 23 Novembre 2026", seven("Lx"), seven("Dx"))];
    const { weeks, problems } = parseMenu(rows);
    expect(weeks).toHaveLength(1);
    expect(text(weeks[0], "mon", "lunch")).toBe("L16 1");
    expect(problems[0]).toEqual({ weekStart: null, message: expect.stringMatching(/'Week of Monday 23 Novembre 2026' \(row 6\) has a date that can't be read/) });
  });

  it("skips every copy of a week that appears twice", () => {
    // A block copied to add a week, with its date not changed yet.
    const rows = [
      ...week("Week of Monday 16 November 2026", seven("L16"), seven("D16")),
      ...week("Week of Monday 23 November 2026", seven("L23"), seven("D23")),
      ...week("Week of Monday 23 November 2026", seven("Lcopy"), seven("Dcopy")),
    ];
    const { weeks, problems } = parseMenu(rows);
    expect(weeks.map((w) => w.weekStart)).toEqual(["2026-11-16"]);
    expect(problems).toEqual([
      {
        weekStart: "2026-11-23",
        message: "There are 2 weeks for Monday 23 November 2026 (rows 6 and 11), so that week was skipped. Change the date in the copied week.",
      },
    ]);
  });

  it("reads only the first of two Lunch rows in a week, and says so", () => {
    const rows: SheetRow[] = [["Week of Monday 23 November 2026"], ["Lunch", "First"], ["Lunch", "Second"], ["Dinner", "Pizza"]];
    const { weeks, problems } = parseMenu(rows);
    expect(text(weeks[0], "mon", "lunch")).toBe("First");
    expect(problems.map((p) => p.message)).toEqual(["The week of Monday 23 November 2026 (row 1) has more than one Lunch row, so only the first one was read"]);
  });

  it("ignores rows before the first week and anything that is not Lunch or Dinner", () => {
    // Ideas live on their own tab, which the sync never asks Google for; notes typed
    // under a week here are not meals either.
    const rows: SheetRow[] = [
      ["Lunch", "Not in a week"],
      ...week("Week of Monday 23 November 2026", seven("L"), seven("D")),
      ["Ideas", "Recetas con granada", "Dúrum kebab casero"],
      ["", "Pastel de chocolate", "Lemon curd"],
    ];
    const { weeks } = parseMenu(rows);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].cells.some((c) => /Not in a week|granada|chocolate|Lemon/.test(c.text))).toBe(false);
  });

  it("stops when there is no week at all", () => {
    expect(() => parseMenu([...TOP, ["Lunch", "Pasta"]])).toThrow(SheetError);
    expect(() => parseMenu([])).toThrow(/Week of Monday 23 November 2026/);
  });
});

describe("weeks that sync", () => {
  const TODAY = "2026-11-26"; // a Thursday; its week starts Monday 23 Nov

  it("runs from three weeks back to four weeks ahead of this week", () => {
    const w = syncWindow(TODAY);
    expect(w).toEqual({ from: "2026-11-02", to: "2026-12-21" });
    expect(inWindow("2026-10-26", w)).toBe(false);
    expect(inWindow("2026-11-02", w)).toBe(true);
    expect(inWindow("2026-12-21", w)).toBe(true);
    expect(inWindow("2026-12-28", w)).toBe(false);
  });

  it("uses Ireland's date: Sunday night is still the same week", () => {
    expect(syncWindow("2026-11-29").from).toBe("2026-11-02");
    expect(syncWindow("2026-11-30").from).toBe("2026-11-09");
  });

  it("keeps only the parsed weeks inside the window", () => {
    const headers = ["26 October", "2 November", "21 December", "28 December"].map((d) => `Week of Monday ${d} 2026`);
    const { weeks } = parseMenu(headers.flatMap((h) => week(h, seven("L"), seven("D"))));
    const w = syncWindow(TODAY);
    expect(weeks.filter((x) => inWindow(x.weekStart, w)).map((x) => x.weekStart)).toEqual(["2026-11-02", "2026-12-21"]);
  });
});
