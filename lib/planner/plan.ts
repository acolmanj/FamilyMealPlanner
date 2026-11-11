import { generateWeek, type GeneratedCell, type Relaxed } from "./generate";
import { DAYS, SLOTS, cellDate, type Cell, type PlanMeal, type Use } from "./rules";
import type { Lang } from "../i18n/messages";

// "Plan week": fill only the empty slots of several weeks in a row (this week and next),
// keeping everything already planned. Each week is solved with the weeks before it in its
// history, so next week never repeats this week's meals or breaks recency across the join.

export type WeekToPlan = { weekStart: string; cells: Cell[] };
export type PlannedWeek = { weekStart: string; empty: number; cells: GeneratedCell[]; relaxed: Relaxed[]; failed: boolean };

export const emptySlots = (cells: Cell[]) =>
  DAYS.length * SLOTS.length - new Set(cells.map((c) => `${c.day}-${c.slot}`)).size;

export function planWeeks({
  weeks,
  meals,
  history,
  seed,
  lang = "en",
}: {
  weeks: WeekToPlan[];
  meals: Map<string, PlanMeal>;
  // Earlier and later uses. Anything dated inside the weeks being planned is ignored:
  // those weeks' cells are the truth.
  history: Use[];
  seed: number;
  lang?: Lang;
}): PlannedWeek[] {
  const inWeek = (u: Use, w: WeekToPlan) => u.date >= w.weekStart && u.date <= cellDate(w.weekStart, "sun");
  const uses = history.filter((u) => !weeks.some((w) => inWeek(u, w)));
  // What is already in the weeks being planned counts as history for the other weeks.
  for (const w of weeks)
    for (const c of w.cells) if (c.mealId) uses.push({ mealId: c.mealId, date: cellDate(w.weekStart, c.day) });

  return weeks.map((w, i) => {
    const empty = emptySlots(w.cells);
    if (empty === 0) return { weekStart: w.weekStart, empty, cells: [], relaxed: [], failed: false };
    const r = generateWeek({
      weekStart: w.weekStart,
      meals,
      history: uses.filter((u) => !inWeek(u, w)),
      keep: w.cells,
      seed: seed + i * 7919,
      lang,
    });
    const failed = r.unfilled.length > 0;
    if (!failed) for (const c of r.cells) uses.push({ mealId: c.mealId, date: cellDate(w.weekStart, c.day) });
    return { weekStart: w.weekStart, empty, cells: r.cells, relaxed: r.relaxed, failed };
  });
}
