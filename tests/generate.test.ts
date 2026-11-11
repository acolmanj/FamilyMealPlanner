import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateWeek, isNotAMeal, isSobras } from "../lib/planner/generate";
import { DAYS, addDays, checkWeek, type Cell, type PlanMeal, type Use } from "../lib/planner/rules";
import { mealTags } from "../lib/planner/tags";
import { parseSeedData } from "../lib/seed/build";

// The real library and history from /Seed, every meal Safe (John cooks them all gluten-free).
const read = (f: string) => readFileSync(`Seed/${f}`, "utf8");
const seed = parseSeedData({
  menuCsv: read("meals_menu_semanal.csv"),
  favouritesCsv: read("favourites_seed.csv"),
  receiptsCsv: read("tesco_receipts_clean.csv"),
  glutenMd: read("gluten_list_for_review.md"),
});
const LIB: PlanMeal[] = [...seed.meals.values()].map((m) => ({
  id: m.nameGroup,
  name: m.nameGroup,
  tags: mealTags({ name: m.nameGroup }),
  gluten: "safe",
  pinned: m.isFavourite,
}));
const MEALS = new Map(LIB.map((m) => [m.id, m]));
const HISTORY: Use[] = seed.slots
  .filter((s) => s.nameGroup)
  .map((s) => ({ mealId: s.nameGroup!, date: addDays(s.weekStart, DAYS.indexOf(s.day as (typeof DAYS)[number])) }));
// The week right after the seed history, so recency really bites.
const WEEK = "2026-10-26";

const run = (s: number, keep: Cell[] = [], meals = MEALS) => generateWeek({ weekStart: WEEK, meals, history: HISTORY, keep, seed: s });
const asCells = (r: ReturnType<typeof run>, keep: Cell[] = []): Cell[] => [...keep, ...r.cells];

describe("suggest a week", () => {
  it("fills all 14 slots and keeps every hard rule, for many seeds", () => {
    for (let s = 1; s <= 40; s++) {
      const r = run(s);
      expect(r.unfilled).toEqual([]);
      expect(r.cells).toHaveLength(14);
      const { counts, warnings } = checkWeek({ weekStart: WEEK, cells: asCells(r), meals: MEALS, history: HISTORY });
      const hard = warnings.filter((w) => w.level !== "soft");
      if (!r.relaxed.length) expect(hard, `seed ${s}`).toEqual([]);
      else expect(hard.filter((w) => w.rule !== "recency"), `seed ${s}`).toEqual([]);
      expect(counts.pulses).toBeGreaterThanOrEqual(2);
      expect(counts.fish).toBeGreaterThanOrEqual(1);
    }
  });

  it("puts the roast on Sunday lunch and pizza on Saturday dinner", () => {
    const r = run(7);
    expect(MEALS.get(r.cells.find((c) => c.day === "sun" && c.slot === "lunch")!.mealId)!.tags.isRoast).toBe(true);
    expect(r.cells.find((c) => c.day === "sat" && c.slot === "dinner")!.mealId).toBe("Pizza");
  });

  it("never suggests Sobras, even if the library has it", () => {
    const sobras: PlanMeal = { id: "sobras", name: "Sobras", tags: mealTags({ name: "Sobras" }), gluten: "safe", pinned: false };
    const meals = new Map([...MEALS, ["sobras", sobras]]);
    for (let s = 1; s <= 20; s++) expect(run(s, [], meals).cells.map((c) => c.mealId)).not.toContain("sobras");
    expect(isSobras("Sobras de lentejas")).toBe(true);
    expect(isSobras("Lentejas estofadas")).toBe(false);
  });

  it("never suggests a take-away or eating out, even if the library has it", () => {
    const nandos: PlanMeal = { id: "nandos", name: "Nandos", tags: mealTags({ name: "Nandos" }), gluten: "safe", pinned: false };
    const meals = new Map([...MEALS, ["nandos", nandos]]);
    for (let s = 1; s <= 20; s++) expect(run(s, [], meals).cells.map((c) => c.mealId)).not.toContain("nandos");
    expect(isNotAMeal("Take-away")).toBe(true);
    expect(isNotAMeal("Lentejas estofadas")).toBe(false);
  });

  it("gives the same week for the same seed and a different week for another", () => {
    expect(run(3)).toEqual(run(3));
    const weeks = new Set(Array.from({ length: 10 }, (_, i) => run(i + 100).cells.map((c) => c.mealId).join("|")));
    expect(weeks.size).toBeGreaterThan(8);
  });

  it("keeps cells already planned and does not repeat their meals", () => {
    const keep: Cell[] = [
      { day: "mon", slot: "lunch", mealId: "Pasta pesto" },
      { day: "wed", slot: "dinner", mealId: null }, // free text
    ];
    const r = run(11, keep);
    expect(r.cells).toHaveLength(12);
    expect(r.cells.some((c) => c.day === "mon" && c.slot === "lunch")).toBe(false);
    expect(r.cells.some((c) => c.day === "wed" && c.slot === "dinner")).toBe(false);
    expect(r.cells.map((c) => c.mealId)).not.toContain("Pasta pesto");
    // Monday's other meal balances the vegetarian pasta.
    expect(MEALS.get(r.cells.find((c) => c.day === "mon")!.mealId)!.tags.protein).not.toBe("veg");
  });

  it("explains each meal", () => {
    const r = run(5);
    expect(r.cells.every((c) => c.why.length > 0)).toBe(true);
    expect(r.cells.find((c) => c.day === "sat" && c.slot === "dinner")!.why).toMatch(/Saturday pizza/);
  });
});

describe("suggest a week without a pizza in the library", () => {
  it("still fills Saturday dinner and explains it", () => {
    const meals = new Map([...MEALS].filter(([id]) => id !== "Pizza"));
    const r = generateWeek({ weekStart: WEEK, meals, history: HISTORY, keep: [], seed: 9 });
    const sat = r.cells.find((c) => c.day === "sat" && c.slot === "dinner")!;
    expect(sat.why).toMatch(/last had|new to the plan/);
  });
});
