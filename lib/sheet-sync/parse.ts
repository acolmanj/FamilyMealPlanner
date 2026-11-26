import { DAYS, addDays, type Day, type Slot } from "../planner/rules";
import { mondayOf } from "../planner/week";

// Reads the family menu sheet. Pure: rows in, weeks out. No imports from the xlsx reader,
// so tests can hand it plain arrays.
//
// Layout: a header row with MONDAY..SUNDAY in columns C..I, then two rows per week:
// LUNCH (column A = the week's date label) and DINNER. Rows after the last week with an
// empty column B (ideas, desserts) are not weeks and are ignored.

// One spreadsheet cell: text, a real date, a number (an Excel date serial) or nothing.
export type SheetValue = string | number | boolean | Date | null | undefined;
export type SheetRow = SheetValue[]; // index 0 is column A

export type SheetCell = { day: Day; slot: Slot; text: string };
export type SheetWeek = { position: number; label: string; weekStart: string; cells: SheetCell[] };
export type ParsedSheet = { weeks: SheetWeek[]; anchor: { position: number; label: string; weekStart: string } };

export class SheetError extends Error {}

const HEADER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const FIRST_DAY_COL = 2; // column C

// Whitespace tidied, so a stray double space or line break is not a "change".
export const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

function text(v: SheetValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return tidy(String(v));
}

const isoOf = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Reject dates that roll over, such as 31/02 or 0/01.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
};

// A date label as YYYY-MM-DD, or null. Takes real dates, Excel date numbers and dd/mm/yyyy text.
export function parseLabel(v: SheetValue): string | null {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // Excel dates come through at midnight UTC; round so a time part can't shift the day.
    const r = new Date(Math.round(v.getTime() / 86_400_000) * 86_400_000);
    return isoOf(r.getUTCFullYear(), r.getUTCMonth() + 1, r.getUTCDate());
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 1) return null;
    return addDays("1899-12-30", Math.floor(v)); // Excel's day 0
  }
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return m ? isoOf(Number(m[3]), Number(m[2]), Number(m[1])) : null;
}

const isMonday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 1;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

type Block = { label: SheetValue; lunch: SheetRow; dinner: SheetRow | null };

function findBlocks(rows: SheetRow[]): Block[] {
  const header = rows.findIndex((r) => HEADER.every((d, i) => text(r?.[FIRST_DAY_COL + i]).toUpperCase() === d));
  if (header < 0) throw new SheetError("Could not find the row with MONDAY to SUNDAY in columns C to I.");
  const blocks: Block[] = [];
  for (const row of rows.slice(header + 1)) {
    const kind = text(row?.[1]).toUpperCase();
    if (kind === "LUNCH") blocks.push({ label: row[0], lunch: row, dinner: null });
    else if (kind === "DINNER") {
      const last = blocks[blocks.length - 1];
      if (last && !last.dinner) {
        last.dinner = row;
        if (text(last.label) === "") last.label = row[0];
      }
    }
  }
  if (!blocks.length) throw new SheetError("The sheet has no LUNCH or DINNER rows.");
  return blocks;
}

// Labels are often wrong, but week order is reliable. Anchor on the last week's label when
// it is a Monday; otherwise walk back to the newest Monday label that fits the order (every
// earlier Monday label is at least that many weeks before it). Every other week is counted
// from the anchor.
export function findAnchor(labels: SheetValue[]): { position: number; weekStart: string } | null {
  const dates = labels.map(parseLabel);
  for (let i = dates.length - 1; i >= 0; i--) {
    const d = dates[i];
    if (!d || !isMonday(d)) continue;
    const fits = dates.slice(0, i).every((e, k) => !e || !isMonday(e) || daysBetween(e, d) >= 7 * (i - k));
    if (i === dates.length - 1 || fits) return { position: i, weekStart: d };
  }
  return null;
}

// The anchor must be near today, or the dates are too far off to trust.
export const ANCHOR_MAX_AHEAD_DAYS = 21;
export const ANCHOR_MAX_BEHIND_DAYS = 56;

export function parseMenu(rows: SheetRow[], today: string): ParsedSheet {
  const blocks = findBlocks(rows);
  const anchor = findAnchor(blocks.map((b) => b.label));
  if (!anchor)
    throw new SheetError("None of the week dates in column A is a Monday written as dd/mm/yyyy, so the weeks can't be dated.");
  const label = text(blocks[anchor.position].label);
  const ahead = daysBetween(today, anchor.weekStart);
  if (ahead > ANCHOR_MAX_AHEAD_DAYS || -ahead > ANCHOR_MAX_BEHIND_DAYS)
    throw new SheetError(
      `The week dated "${label}" (${anchor.weekStart}) is too far from today (${today}) to trust. Check the date in column A of the last week.`,
    );

  const weeks = blocks.map((b, position) => {
    const cells: SheetCell[] = [];
    for (const slot of ["lunch", "dinner"] as const) {
      const row = slot === "lunch" ? b.lunch : b.dinner;
      DAYS.forEach((day, i) => cells.push({ day, slot, text: row ? text(row[FIRST_DAY_COL + i]) : "" }));
    }
    return { position, label: text(b.label), weekStart: addDays(anchor.weekStart, 7 * (position - anchor.position)), cells };
  });
  return { weeks, anchor: { ...anchor, label } };
}

// Weeks the sync may change: from three weeks back to four weeks ahead of this week.
// Older weeks are history that was already imported.
export function syncWindow(today: string) {
  const monday = mondayOf(new Date(`${today}T00:00:00Z`));
  return { from: addDays(monday, -21), to: addDays(monday, 28) };
}

export const inWindow = (weekStart: string, w: { from: string; to: string }) => weekStart >= w.from && weekStart <= w.to;
