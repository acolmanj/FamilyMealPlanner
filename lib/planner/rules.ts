import type { Status } from "../gluten/gate";
import type { Tags } from "./tags";

// The week rules from the build brief, as plain functions of the grid.
// Only gluten blocks; every other rule returns a warning the owner can ignore.
// Nothing here scores a meal: suggestions are ordered by plain facts only.

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
// Sobras (leftovers) are not a meal, so the planner has no slot for them.
export const SLOTS = ["lunch", "dinner"] as const;
export type Day = (typeof DAYS)[number];
export type Slot = (typeof SLOTS)[number];

export const DAY_LABEL: Record<Day, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
export const SLOT_LABEL: Record<Slot, string> = { lunch: "Lunch", dinner: "Dinner" };

export const LIMITS = { pasta: 2, processed: 2, newMeals: 1, pulsesMin: 2, recencyDays: 21, recencyDaysPinned: 14, starchWindowDays: 3 };
const SPACED_STARCHES = ["pasta", "potatoes", "rice", "noodles"];

export type PlanMeal = {
  id: string;
  name: string;
  tags: Tags;
  gluten: Status;
  pinned: boolean;
};

export type Cell = { day: Day; slot: Slot; mealId: string | null };

// One earlier use of a meal, from any other week's plan.
export type Use = { mealId: string; date: string };

export type Warning = {
  level: "block" | "hard" | "soft";
  rule: string;
  text: string;
  cells: string[];
};

export type Counts = {
  filled: number;
  toFill: number;
  fish: number;
  meat: number;
  veg: number;
  pasta: number;
  processed: number;
  pulses: number;
  newMeals: number;
};

export type WeekInput = {
  weekStart: string;
  cells: Cell[];
  meals: Map<string, PlanMeal>;
  history: Use[];
};

export const cellKey = (c: { day: string; slot: string }) => `${c.day}-${c.slot}`;
const cellName = (c: Cell) => `${DAY_LABEL[c.day]} ${c.slot}`;

export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export const cellDate = (weekStart: string, day: Day) => addDays(weekStart, DAYS.indexOf(day));

// The most recent earlier use of each meal, before the given date.
function lastUseBefore(history: Use[], mealId: string, date: string): string | null {
  let last: string | null = null;
  for (const u of history) if (u.mealId === mealId && u.date < date && (!last || u.date > last)) last = u.date;
  return last;
}

export function isNewMeal(history: Use[], mealId: string, weekStart: string) {
  return !history.some((u) => u.mealId === mealId && u.date < weekStart);
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function checkWeek({ weekStart, cells, meals, history }: WeekInput): { counts: Counts; warnings: Warning[] } {
  const filled = cells.filter((c) => c.mealId && meals.has(c.mealId));
  const main = filled;
  const mealOf = (c: Cell) => meals.get(c.mealId!)!;
  const warnings: Warning[] = [];
  const weekComplete = main.length === DAYS.length * 2;

  const distinct = [...new Set(filled.map((c) => c.mealId!))].map((id) => meals.get(id)!);
  const newIds = distinct.filter((m) => isNewMeal(history, m.id, weekStart)).map((m) => m.id);
  const counts: Counts = {
    filled: main.length,
    toFill: DAYS.length * 2,
    fish: filled.filter((c) => mealOf(c).tags.protein === "fish").length,
    meat: filled.filter((c) => mealOf(c).tags.protein === "meat").length,
    veg: filled.filter((c) => mealOf(c).tags.protein === "veg").length,
    pasta: filled.filter((c) => mealOf(c).tags.isPasta).length,
    processed: filled.filter((c) => mealOf(c).tags.isProcessed).length,
    pulses: filled.filter((c) => mealOf(c).tags.isPulse).length,
    newMeals: newIds.length,
  };

  // Gluten: the only rule that blocks.
  for (const c of filled) {
    const g = mealOf(c).gluten;
    if (g === "blocked") warnings.push({ level: "block", rule: "gluten", text: `${cellName(c)}: blocked for gluten`, cells: [cellKey(c)] });
  }

  // Traditions.
  const sunLunch = filled.find((c) => c.day === "sun" && c.slot === "lunch");
  if (sunLunch && !mealOf(sunLunch).tags.isRoast)
    warnings.push({ level: "hard", rule: "tradition", text: "Sunday lunch is the roast", cells: [cellKey(sunLunch)] });
  const satDinner = filled.find((c) => c.day === "sat" && c.slot === "dinner");
  if (satDinner && !mealOf(satDinner).tags.isPizza)
    warnings.push({ level: "hard", rule: "tradition", text: "Saturday dinner is pizza (GF base)", cells: [cellKey(satDinner)] });

  // Fish, once the week is complete (before that the count says how many so far).
  if (weekComplete && counts.fish === 0) warnings.push({ level: "hard", rule: "fish", text: "No fish meal this week", cells: [] });

  // Pulses (lentils, beans, chickpeas) are a regular part of the week.
  if (weekComplete && counts.pulses < LIMITS.pulsesMin)
    warnings.push({ level: "hard", rule: "pulses", text: `Pulses ${counts.pulses}, target at least ${LIMITS.pulsesMin}`, cells: [] });

  // Once a week.
  const byMeal = new Map<string, Cell[]>();
  for (const c of filled) byMeal.set(c.mealId!, [...(byMeal.get(c.mealId!) ?? []), c]);
  for (const [id, cs] of byMeal)
    if (cs.length > 1)
      warnings.push({ level: "hard", rule: "repeat", text: `${meals.get(id)!.name} is in the week ${cs.length} times`, cells: cs.map(cellKey) });

  // Daily mix: one meat (or fish) meal and one vegetarian meal each day.
  for (const day of DAYS) {
    const dayCells = main.filter((c) => c.day === day);
    if (dayCells.length < 2) continue;
    const proteins = dayCells.map((c) => mealOf(c).tags.protein);
    if (!proteins.includes("veg"))
      warnings.push({ level: "hard", rule: "daily-mix", text: `${DAY_LABEL[day]}: no vegetarian meal`, cells: dayCells.map(cellKey) });
    else if (proteins.every((p) => p === "veg"))
      warnings.push({ level: "hard", rule: "daily-mix", text: `${DAY_LABEL[day]}: no meat or fish meal`, cells: dayCells.map(cellKey) });
  }

  // Pasta and processed.
  if (counts.pasta > LIMITS.pasta)
    warnings.push({
      level: "hard",
      rule: "pasta",
      text: `Pasta ${counts.pasta}, target ${LIMITS.pasta} or fewer`,
      cells: filled.filter((c) => mealOf(c).tags.isPasta).map(cellKey),
    });
  if (counts.processed > LIMITS.processed)
    warnings.push({
      level: "hard",
      rule: "processed",
      text: `Processed ${counts.processed}, target ${LIMITS.processed} or fewer`,
      cells: filled.filter((c) => mealOf(c).tags.isProcessed).map(cellKey),
    });

  // Effort: weeknight dinners are Quick.
  for (const c of main)
    if (c.slot === "dinner" && DAYS.indexOf(c.day) < 5 && mealOf(c).tags.effort === "long")
      warnings.push({ level: "hard", rule: "effort", text: `${cellName(c)}: long cook on a weeknight`, cells: [cellKey(c)] });

  // Old and new: about 1 new meal a week.
  if (counts.newMeals > LIMITS.newMeals)
    warnings.push({
      level: "hard",
      rule: "new",
      text: `${plural(counts.newMeals, "new meal")}, target about ${LIMITS.newMeals}`,
      cells: filled.filter((c) => newIds.includes(c.mealId!)).map(cellKey),
    });

  // Recency: not within 3 weeks (2 if pinned).
  for (const c of filled) {
    const m = mealOf(c);
    const date = cellDate(weekStart, c.day);
    const last = lastUseBefore(history, m.id, weekStart);
    if (!last) continue;
    const gap = daysBetween(last, date);
    const limit = m.pinned ? LIMITS.recencyDaysPinned : LIMITS.recencyDays;
    if (gap < limit)
      warnings.push({ level: "hard", rule: "recency", text: `${cellName(c)}: had it ${plural(gap, "day")} ago`, cells: [cellKey(c)] });
  }

  // Starch spacing (soft): not the same starch twice in any 3-day window.
  const starchy = main
    .map((c) => ({ c, starch: mealOf(c).tags.starch, i: DAYS.indexOf(c.day) }))
    .filter((x) => x.starch && SPACED_STARCHES.includes(x.starch));
  for (let a = 0; a < starchy.length; a++)
    for (let b = a + 1; b < starchy.length; b++) {
      const x = starchy[a];
      const y = starchy[b];
      if (x.starch === y.starch && Math.abs(x.i - y.i) < LIMITS.starchWindowDays)
        warnings.push({
          level: "soft",
          rule: "starch",
          text: `${x.starch} twice within 3 days (${cellName(x.c)}, ${cellName(y.c)})`,
          cells: [cellKey(x.c), cellKey(y.c)],
        });
    }

  return { counts, warnings };
}

export type Suggestion = { meal: PlanMeal; why: string };

// Meals that fit this cell, ordered by plain facts: the day's tradition, the protein the
// cell or day needs, pulses or fish the week is missing, pinned, then longest since last planned.
export function suggestAlternatives(input: WeekInput & { cell: Cell; count?: number }): Suggestion[] {
  const { weekStart, cells, meals, history, cell, count = 3 } = input;
  const inWeek = new Set(cells.filter((c) => c.mealId && cellKey(c) !== cellKey(cell)).map((c) => c.mealId));
  const current = cell.mealId ? meals.get(cell.mealId) : undefined;
  const date = cellDate(weekStart, cell.day);

  let wantProtein: PlanMeal["tags"]["protein"][] | null = current ? [current.tags.protein] : null;
  if (!current) {
    const other = cells.find((c) => c.day === cell.day && c.slot === (cell.slot === "lunch" ? "dinner" : "lunch") && c.mealId);
    const p = other && meals.get(other.mealId!)?.tags.protein;
    if (p) wantProtein = p === "veg" ? ["meat", "fish"] : ["veg"];
  }
  const tradition = cell.day === "sun" && cell.slot === "lunch" ? "roast" : cell.day === "sat" && cell.slot === "dinner" ? "pizza" : null;
  const others = cells.filter((c) => c.mealId && cellKey(c) !== cellKey(cell)).map((c) => meals.get(c.mealId!)).filter(Boolean) as PlanMeal[];
  const needPulse = others.filter((m) => m.tags.isPulse).length < LIMITS.pulsesMin;
  const needFish = !others.some((m) => m.tags.protein === "fish");

  const pool = [...meals.values()]
    .filter((m) => m.id !== cell.mealId && !inWeek.has(m.id) && m.gluten !== "blocked")
    .map((m) => {
      const last = lastUseBefore(history, m.id, weekStart);
      const gap = last ? daysBetween(last, date) : null;
      return { m, last, gap };
    })
    .filter(({ m, gap }) => gap === null || gap >= (m.pinned ? LIMITS.recencyDaysPinned : LIMITS.recencyDays));

  const rank = ({ m, last }: (typeof pool)[number]) => [
    tradition === "roast" ? (m.tags.isRoast ? 0 : 1) : tradition === "pizza" ? (m.tags.isPizza ? 0 : 1) : 0,
    wantProtein && !wantProtein.includes(m.tags.protein) ? 1 : 0,
    needPulse && !m.tags.isPulse ? 1 : 0,
    needFish && m.tags.protein !== "fish" ? 1 : 0,
    m.pinned ? 0 : 1,
    last ? 0 : 1, // past meals before new ones (about 1 new a week)
  ];
  pool.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    if (a.last !== b.last) return (a.last ?? "") < (b.last ?? "") ? -1 : 1;
    return a.m.name.localeCompare(b.m.name);
  });

  return pool.slice(0, count).map(({ m, gap }) => {
    const bits: string[] = [];
    if (m.pinned) bits.push("pinned");
    bits.push(gap === null ? "new to the plan" : `last planned ${weeksAgo(gap)}`);
    if (needPulse && m.tags.isPulse) bits.push("pulses for the week");
    else if (needFish && m.tags.protein === "fish") bits.push("fish for the week");
    if (wantProtein && wantProtein.includes(m.tags.protein) && !current) bits.push(m.tags.protein === "veg" ? "vegetarian for the day's mix" : `${m.tags.protein} for the day's mix`);
    return { meal: m, why: bits.join(", ") };
  });
}

function weeksAgo(days: number) {
  const w = Math.floor(days / 7);
  return w < 1 ? `${plural(days, "day")} ago` : `${plural(w, "week")} ago`;
}

// A spread of meals for the week's sidebar: what the week is missing first (pulses, fish),
// then meat, vegetarian and fish in turn, each ordered pinned first and longest since last planned.
export function suggestForWeek(input: WeekInput & { count?: number }): Suggestion[] {
  const { weekStart, cells, meals, history, count = 10 } = input;
  const inWeek = new Set(cells.map((c) => c.mealId).filter(Boolean));
  const planned = [...inWeek].map((id) => meals.get(id!)).filter(Boolean) as PlanMeal[];
  const needPulse = planned.filter((m) => m.tags.isPulse).length < LIMITS.pulsesMin;
  const needFish = !planned.some((m) => m.tags.protein === "fish");

  const pool = [...meals.values()]
    .filter((m) => !inWeek.has(m.id) && m.gluten !== "blocked")
    .map((m) => {
      const last = lastUseBefore(history, m.id, weekStart);
      return { m, last, gap: last ? daysBetween(last, weekStart) : null };
    })
    .filter(({ m, gap }) => gap === null || gap >= (m.pinned ? LIMITS.recencyDaysPinned : LIMITS.recencyDays))
    .sort(
      (a, b) =>
        Number(!a.m.pinned) - Number(!b.m.pinned) ||
        Number(!a.last) - Number(!b.last) ||
        (a.last ?? "").localeCompare(b.last ?? "") ||
        a.m.name.localeCompare(b.m.name),
    );

  type Kind = "pulse" | "meat" | "veg" | "fish";
  const kindOf = (m: PlanMeal): Kind => (m.tags.isPulse ? "pulse" : m.tags.protein);
  const order: Kind[] = [...(needPulse ? ["pulse" as Kind] : []), ...(needFish ? ["fish" as Kind] : []), "meat", "veg", "fish", "pulse"];
  const queues = new Map<Kind, typeof pool>();
  for (const k of order) queues.set(k, pool.filter((p) => kindOf(p.m) === k));
  const kinds = [...new Set(order)];
  const picked: Suggestion[] = [];
  for (let round = 0; picked.length < count && kinds.some((k) => queues.get(k)!.length); round++)
    for (const k of kinds) {
      const next = queues.get(k)!.shift();
      if (!next || picked.length >= count) continue;
      const bits = [next.gap === null ? "new to the plan" : `last planned ${weeksAgo(next.gap)}`];
      if (needPulse && k === "pulse") bits.push("pulses for the week");
      if (needFish && k === "fish") bits.push("fish for the week");
      if (next.m.pinned) bits.unshift("pinned");
      picked.push({ meal: next.m, why: bits.join(", ") });
    }
  return picked;
}
