import { generateWeek, type GeneratedCell, type Relaxed } from "./generate";
import { DAYS, SLOTS, cellDate, type Cell, type Day, type PlanMeal, type Use } from "./rules";
import type { Lang } from "../i18n/messages";

// "Plan week": fill only the empty slots of several weeks in a row (this week and next),
// keeping everything already planned. Each week is solved with the weeks before it in its
// history, so next week never repeats this week's meals or breaks recency across the join.
// Days before today are left as they are: they count as taken and are never filled.

export type WeekToPlan = { weekStart: string; cells: Cell[] };
export type PlannedWeek = { weekStart: string; empty: number; passed: Day[]; cells: GeneratedCell[]; relaxed: Relaxed[]; failed: boolean };

// The days of a week that are already over on `today` (YYYY-MM-DD). None when today is missing.
export const passedDays = (weekStart: string, today?: string): Day[] => (today ? DAYS.filter((d) => cellDate(weekStart, d) < today) : []);

// Empty slots still to come: a slot on a day that has passed is not counted.
export const emptySlots = (cells: Cell[], passed: Day[] = []) =>
  (DAYS.length - passed.length) * SLOTS.length - new Set(cells.filter((c) => !passed.includes(c.day)).map((c) => `${c.day}-${c.slot}`)).size;

// The cells to keep: what is there, plus every empty slot on a day that has passed.
export const withPassed = (cells: Cell[], passed: Day[]): Cell[] => [
  ...cells,
  ...passed.flatMap((day) => SLOTS.filter((slot) => !cells.some((c) => c.day === day && c.slot === slot)).map((slot) => ({ day, slot, mealId: null }))),
];

export function planWeeks({
  weeks,
  meals,
  history,
  seed,
  lang = "en",
  today,
}: {
  weeks: WeekToPlan[];
  meals: Map<string, PlanMeal>;
  // Earlier and later uses. Anything dated inside the weeks being planned is ignored:
  // those weeks' cells are the truth.
  history: Use[];
  seed: number;
  lang?: Lang;
  // Today's date (YYYY-MM-DD, Europe/Dublin): earlier days are not filled.
  today?: string;
}): PlannedWeek[] {
  const inWeek = (u: Use, w: WeekToPlan) => u.date >= w.weekStart && u.date <= cellDate(w.weekStart, "sun");
  const uses = history.filter((u) => !weeks.some((w) => inWeek(u, w)));
  // What is already in the weeks being planned counts as history for the other weeks.
  for (const w of weeks)
    for (const c of w.cells) if (c.mealId) uses.push({ mealId: c.mealId, date: cellDate(w.weekStart, c.day) });

  return weeks.map((w, i) => {
    const passed = passedDays(w.weekStart, today);
    const empty = emptySlots(w.cells, passed);
    if (empty === 0) return { weekStart: w.weekStart, empty, passed, cells: [], relaxed: [], failed: false };
    const r = generateWeek({
      weekStart: w.weekStart,
      meals,
      history: uses.filter((u) => !inWeek(u, w)),
      keep: withPassed(w.cells, passed),
      seed: seed + i * 7919,
      lang,
    });
    const failed = r.unfilled.length > 0;
    if (!failed) for (const c of r.cells) uses.push({ mealId: c.mealId, date: cellDate(w.weekStart, c.day) });
    return { weekStart: w.weekStart, empty, passed, cells: r.cells, relaxed: r.relaxed, failed };
  });
}
