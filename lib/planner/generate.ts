import { messages, type Lang } from "../i18n/messages";
import { DAYS, LIMITS, SLOTS, cellDate, cellKey, isNewMeal, type Cell, type Day, type PlanMeal, type Slot, type Use } from "./rules";

// Builds a suggested week with plain code: a seeded shuffle of the library, then a
// backtracking search that keeps every week rule. A new seed gives a different week;
// the same seed gives the same week. Nothing is scored: the order is the shuffle.

export type GeneratedCell = { day: Day; slot: Slot; mealId: string; why: string };
export type Relaxed = "starch" | "recency" | "recencyAll";
export type GenerateResult = { cells: GeneratedCell[]; relaxed: Relaxed[]; unfilled: { day: Day; slot: Slot }[] };

export type GenerateInput = {
  weekStart: string;
  meals: Map<string, PlanMeal>;
  history: Use[];
  // Cells that stay as they are (locked by the owner). mealId null means taken by free text.
  keep: Cell[];
  seed: number;
  lang?: Lang;
};

const SPACED = ["pasta", "potatoes", "rice", "noodles"];
// Sobras (leftovers) are never a meal, whatever the library holds.
export const isSobras = (name: string) => /\b(sobras?|leftovers?)\b/i.test(name);

// mulberry32: a tiny seeded random number generator.
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], rand: () => number) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const tradition = (day: Day, slot: Slot) => (day === "sun" && slot === "lunch" ? "roast" : day === "sat" && slot === "dinner" ? "pizza" : null);
const fitsTradition = (m: PlanMeal, kind: "roast" | "pizza") => (kind === "roast" ? m.tags.isRoast : m.tags.isPizza);

function lastUse(history: Use[], mealId: string, before: string) {
  let last: string | null = null;
  for (const u of history) if (u.mealId === mealId && u.date < before && (!last || u.date > last)) last = u.date;
  return last;
}
const gapDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

type Level = { starch: boolean; recency: "full" | "short" | "none" };
const LEVELS: Level[] = [
  { starch: true, recency: "full" },
  { starch: false, recency: "full" },
  { starch: false, recency: "short" },
  { starch: false, recency: "none" },
];
const MAX_STEPS = 40_000;

export function generateWeek({ weekStart, meals, history, keep, seed, lang = "en" }: GenerateInput): GenerateResult {
  const t = messages(lang).gen;
  const rand = rng(seed);
  const keptKeys = new Set(keep.map(cellKey));
  const kept = keep.filter((c) => c.mealId && meals.has(c.mealId)).map((c) => ({ ...c, meal: meals.get(c.mealId!)! }));

  const pool = shuffle(
    [...meals.values()].filter((m) => m.gluten !== "blocked" && !isSobras(m.name) && !kept.some((k) => k.meal.id === m.id)),
    rand,
  );
  const hasRoast = pool.some((m) => m.tags.isRoast);
  const hasPizza = pool.some((m) => m.tags.isPizza);

  // Tradition cells first (fewest choices), then the rest in a shuffled order so
  // pulses and fish land on different days from one run to the next.
  const open = DAYS.flatMap((day) => SLOTS.map((slot) => ({ day, slot }))).filter((c) => !keptKeys.has(cellKey(c)));
  const order = [...open.filter((c) => tradition(c.day, c.slot)), ...shuffle(open.filter((c) => !tradition(c.day, c.slot)), rand)];

  const recencyOk = (m: PlanMeal, cell: { day: Day; slot: Slot }, level: Level) => {
    if (tradition(cell.day, cell.slot)) return true; // pizza every Saturday and the Sunday roast are the point
    if (level.recency === "none") return true;
    const last = lastUse(history, m.id, weekStart);
    if (!last) return true;
    const limit = level.recency === "short" || m.pinned ? LIMITS.recencyDaysPinned : LIMITS.recencyDays;
    return gapDays(last, cellDate(weekStart, cell.day)) >= limit;
  };

  for (const level of LEVELS) {
    const chosen = new Map<string, PlanMeal>(kept.map((k) => [cellKey(k), k.meal]));
    const used = new Set(kept.map((k) => k.meal.id));
    let steps = 0;

    const count = (f: (m: PlanMeal) => boolean) => [...chosen.values()].filter(f).length;

    const fits = (m: PlanMeal, cell: { day: Day; slot: Slot }, remainingAfter: number) => {
      if (used.has(m.id)) return false;
      const kind = tradition(cell.day, cell.slot);
      if (kind === "roast" && hasRoast && !m.tags.isRoast) return false;
      if (kind === "pizza" && hasPizza && !m.tags.isPizza) return false;
      if (!kind && m.tags.isPizza && hasPizza) return false; // pizza belongs to Saturday night
      if (!recencyOk(m, cell, level)) return false;
      if (cell.slot === "dinner" && DAYS.indexOf(cell.day) < 5 && m.tags.effort === "long") return false;
      // Daily mix: one vegetarian and one meat or fish meal each day.
      const other = chosen.get(cellKey({ day: cell.day, slot: cell.slot === "lunch" ? "dinner" : "lunch" }));
      if (other && (other.tags.protein === "veg") === (m.tags.protein === "veg")) return false;
      if (m.tags.isPasta && count((x) => x.tags.isPasta) >= LIMITS.pasta) return false;
      if (m.tags.isProcessed && count((x) => x.tags.isProcessed) >= LIMITS.processed) return false;
      if (isNewMeal(history, m.id, weekStart) && count((x) => isNewMeal(history, x.id, weekStart)) >= LIMITS.newMeals) return false;
      if (level.starch && m.tags.starch && SPACED.includes(m.tags.starch)) {
        const i = DAYS.indexOf(cell.day);
        for (const [key, x] of chosen)
          if (x.tags.starch === m.tags.starch && Math.abs(DAYS.indexOf(key.split("-")[0] as Day) - i) < LIMITS.starchWindowDays) return false;
      }
      // Leave enough cells for the week's fish and pulses.
      const fish = count((x) => x.tags.protein === "fish") + (m.tags.protein === "fish" ? 1 : 0);
      const pulses = count((x) => x.tags.isPulse) + (m.tags.isPulse ? 1 : 0);
      if (Math.max(0, 1 - fish) + Math.max(0, LIMITS.pulsesMin - pulses) > remainingAfter) return false;
      return true;
    };

    const solve = (i: number): boolean => {
      if (i === order.length) return true;
      if (++steps > MAX_STEPS) return false;
      const cell = order[i];
      for (const m of pool) {
        if (!fits(m, cell, order.length - i - 1)) continue;
        chosen.set(cellKey(cell), m);
        used.add(m.id);
        if (solve(i + 1)) return true;
        chosen.delete(cellKey(cell));
        used.delete(m.id);
        if (steps > MAX_STEPS) return false;
      }
      return false;
    };

    if (!solve(0)) continue;

    const relaxed: Relaxed[] = [];
    if (!level.starch) relaxed.push("starch");
    if (level.recency === "short") relaxed.push("recency");
    if (level.recency === "none") relaxed.push("recencyAll");
    const all = [...chosen.values()];
    const fishCount = all.filter((m) => m.tags.protein === "fish").length;
    const cells = order.map((cell) => {
      const m = chosen.get(cellKey(cell))!;
      const kind = tradition(cell.day, cell.slot);
      const bits: string[] = [];
      const isTradition = Boolean(kind && fitsTradition(m, kind));
      if (isTradition) bits.push(kind === "roast" ? t.whyRoast : t.whyPizza);
      if (m.tags.isPulse) bits.push(t.whyPulses);
      if (m.tags.protein === "fish" && fishCount === 1) bits.push(t.whyFish);
      if (m.pinned) bits.push(t.whyPinned);
      const last = lastUse(history, m.id, weekStart);
      if (!isTradition) bits.push(last ? t.lastHad(Math.max(1, Math.round(gapDays(last, weekStart) / 7))) : t.whyNew);
      return { ...cell, mealId: m.id, why: bits.join(", ") };
    });
    cells.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
    return { cells, relaxed, unfilled: [] };
  }

  return { cells: [], relaxed: [], unfilled: open };
}
