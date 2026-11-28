import { DAYS, addDays, type Day, type Slot } from "../planner/rules";
import { mondayOf } from "../planner/week";

// Reads the "Menu" tab of the family's "Weekly Menu" Google Sheet. Pure: rows of text in,
// weeks out, so tests can hand it plain arrays.
//
// Layout (by content, not fixed row numbers, so copied blocks and extra blank rows are fine):
//   A: "Week of Monday 23 November 2026"        <- starts a week; its date is the truth
//   A: blank, B..H: "Mon 23 Nov" .. "Sun 29 Nov" <- only for people, ignored
//   A: "Lunch",  B..H: Monday..Sunday lunch
//   A: "Dinner", B..H: Monday..Sunday dinner
//   a blank row
// Lunch and Dinner may come in either order; a missing row counts as empty cells.

export type SheetRow = (string | null | undefined)[]; // index 0 is column A

export type SheetCell = { day: Day; slot: Slot; text: string };
export type SheetWeek = { row: number; label: string; weekStart: string; cells: SheetCell[] };
// weekStart is the Monday of the week the problem is about, or null when no date could be read.
export type SheetProblem = { weekStart: string | null; message: string };
export type ParsedSheet = { weeks: SheetWeek[]; problems: SheetProblem[] };

export class SheetError extends Error {}

const FIRST_DAY_COL = 1; // column B

// Whitespace tidied, so a stray double space or line break is not a "change".
export const tidy = (s: string) => s.replace(/\s+/g, " ").trim();
const text = (v: string | null | undefined) => (v == null ? "" : tidy(String(v)));

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const WEEKDAY = "(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\\.?,?\\s+)?";
const WORDS = new RegExp(`^week of\\s+${WEEKDAY}(\\d{1,2})(?:st|nd|rd|th)?\\s+([a-z]+)\\.?,?\\s+(\\d{4})$`, "i");
const DIGITS = new RegExp(`^week of\\s+${WEEKDAY}(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4})$`, "i");

const isoOf = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Reject dates that roll over, such as 31 February.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
};

export const isWeekHeader = (a: string) => /^week of\b/i.test(tidy(a));

// The date in a week header as YYYY-MM-DD, or null when it can't be read.
//   "Week of Monday 23 November 2026", "week of mon 23 nov 2026", "Week of 23/11/2026"
export function parseWeekHeader(a: string): string | null {
  const s = tidy(a);
  const w = s.match(WORDS);
  if (w) {
    const month = MONTHS[w[2].toLowerCase()];
    return month ? isoOf(Number(w[3]), month, Number(w[1])) : null;
  }
  const d = s.match(DIGITS);
  return d ? isoOf(Number(d[3]), Number(d[2]), Number(d[1])) : null;
}

const isMonday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 1;
const mondayOfIso = (iso: string) => mondayOf(new Date(`${iso}T00:00:00Z`));
const longDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${iso}T00:00:00Z`))
    .replace(",", "");

type Block = { row: number; label: string; date: string | null; lunch: SheetRow | null; dinner: SheetRow | null; extra: Slot[] };

export function parseMenu(rows: SheetRow[]): ParsedSheet {
  const blocks: Block[] = [];
  rows.forEach((r, i) => {
    const a = text(r?.[0]);
    if (isWeekHeader(a)) {
      blocks.push({ row: i + 1, label: a, date: parseWeekHeader(a), lunch: null, dinner: null, extra: [] });
      return;
    }
    const block = blocks[blocks.length - 1];
    const slot = a.toLowerCase();
    if (!block || (slot !== "lunch" && slot !== "dinner")) return; // title, tip, day names, blank rows
    if (block[slot]) block.extra.push(slot);
    else block[slot] = r;
  });
  if (!blocks.length)
    throw new SheetError('Could not find any week in the Menu tab. Each week should start with a row like "Week of Monday 23 November 2026" in column A.');

  const problems: SheetProblem[] = [];
  const count = new Map<string, number[]>();
  for (const b of blocks) if (b.date) count.set(b.date, [...(count.get(b.date) ?? []), b.row]);

  const weeks: SheetWeek[] = [];
  for (const b of blocks) {
    if (!b.date) {
      problems.push({ weekStart: null, message: `Week header '${b.label}' (row ${b.row}) has a date that can't be read, so that week was skipped` });
      continue;
    }
    if (!isMonday(b.date)) {
      problems.push({ weekStart: mondayOfIso(b.date), message: `Week header '${b.label}' (row ${b.row}) is not a Monday, so that week was skipped` });
      continue;
    }
    const same = count.get(b.date)!;
    if (same.length > 1) {
      if (same[0] === b.row)
        problems.push({
          weekStart: b.date,
          message: `There are ${same.length} weeks for ${longDate(b.date)} (rows ${same.join(" and ")}), so that week was skipped. Change the date in the copied week.`,
        });
      continue;
    }
    for (const slot of b.extra)
      problems.push({ weekStart: b.date, message: `The week of ${longDate(b.date)} (row ${b.row}) has more than one ${slot === "lunch" ? "Lunch" : "Dinner"} row, so only the first one was read` });
    const cells: SheetCell[] = [];
    for (const slot of ["lunch", "dinner"] as const) {
      const row = b[slot];
      DAYS.forEach((day, i) => cells.push({ day, slot, text: row ? text(row[FIRST_DAY_COL + i]) : "" }));
    }
    weeks.push({ row: b.row, label: b.label, weekStart: b.date, cells });
  }
  return { weeks, problems };
}

// Weeks the sync may change: from three weeks back to four weeks ahead of this week.
// Older weeks are history that was already imported.
export function syncWindow(today: string) {
  const monday = mondayOf(new Date(`${today}T00:00:00Z`));
  return { from: addDays(monday, -21), to: addDays(monday, 28) };
}

export const inWindow = (weekStart: string, w: { from: string; to: string }) => weekStart >= w.from && weekStart <= w.to;
