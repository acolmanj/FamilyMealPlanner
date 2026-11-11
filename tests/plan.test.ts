import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FAVOURITE_WEIGHT, generateWeek, rng, weightedShuffle } from "../lib/planner/generate";
import { emptySlots, passedDays, planWeeks } from "../lib/planner/plan";
import { DAYS, addDays, cellDate, checkWeek, slotFits, suggestAlternatives, type Cell, type PlanMeal, type Use } from "../lib/planner/rules";
import { mealTags } from "../lib/planner/tags";
import { parseSeedData } from "../lib/seed/build";
import { inferSlotPreferences, prefFromCounts, slotPreferenceSql } from "../lib/seed/slots";

// The real library and history from /Seed, with each meal's usual slot read from the sheet
// and the owner's confirmed favourites. Every meal Safe (John cooks them all gluten-free).
const read = (f: string) => readFileSync(`Seed/${f}`, "utf8");
const seed = parseSeedData({
  menuCsv: read("meals_menu_semanal.csv"),
  favouritesCsv: read("favourites_seed.csv"),
  receiptsCsv: read("tesco_receipts_clean.csv"),
  glutenMd: read("gluten_list_for_review.md"),
});
const PREFS = new Map(inferSlotPreferences(seed.slots).map((c) => [c.nameGroup, c.pref]));
const library = (opts: { prefs?: boolean; favourites?: boolean } = {}) =>
  new Map<string, PlanMeal>(
    seed.meals.map((m) => [
      m.nameGroup,
      {
        id: m.nameGroup,
        name: m.nameGroup,
        tags: mealTags({ name: m.nameGroup }),
        gluten: "safe",
        pinned: false,
        favourite: (opts.favourites ?? true) && m.isFavourite,
        slotPref: (opts.prefs ?? true) ? PREFS.get(m.nameGroup) : undefined,
      },
    ]),
  );
const MEALS = library();
const HISTORY: Use[] = seed.slots
  .filter((s) => s.nameGroup)
  .map((s) => ({ mealId: s.nameGroup!, date: addDays(s.weekStart, DAYS.indexOf(s.day)) }));
// The same history ten weeks earlier: every meal is known, none is recent.
const OLD = HISTORY.map((u) => ({ ...u, date: addDays(u.date, -70) }));
const WEEK = "2026-10-26";
const SEEDS = Array.from({ length: 120 }, (_, i) => i + 1);

const hardRules = (weekStart: string, cells: Cell[], history: Use[], meals = MEALS) =>
  checkWeek({ weekStart, cells, meals, history }).warnings.filter((w) => w.level !== "soft");

describe("slot preference from the menu sheet", () => {
  it("is supper or lunch at 70% or more of a meal's uses, otherwise either", () => {
    expect(prefFromCounts(0, 1)).toBe("supper");
    expect(prefFromCounts(1, 11)).toBe("supper");
    expect(prefFromCounts(3, 1)).toBe("lunch");
    expect(prefFromCounts(1, 2)).toBe("either"); // 67% dinner
    expect(prefFromCounts(2, 2)).toBe("either");
    expect(prefFromCounts(0, 0)).toBe("either");
    expect(PREFS.get("Pizza")).toBe("supper");
    expect(PREFS.get("Lentejas estofadas (variants)")).toBe("lunch");
    expect(PREFS.get("Chili con Carne")).toBe("either");
    expect(PREFS.has("Sobras")).toBe(false);
  });

  it("ships the same backfill in the migration and in supabase/data", () => {
    const sql = slotPreferenceSql(inferSlotPreferences(seed.slots));
    expect(readFileSync("supabase/migrations/0006_slot_preference_elpais.sql", "utf8")).toContain(sql);
    expect(readFileSync("supabase/data/meal_slot_preferences.sql", "utf8")).toContain(sql);
    expect(sql).toContain("m.slot_preference = 'either'"); // never overwrites one set by hand
  });

  it("puts supper meals at dinner, lunch meals at lunch, either in both, breakfast nowhere", () => {
    expect([slotFits("supper", "dinner"), slotFits("supper", "lunch")]).toEqual([true, false]);
    expect([slotFits("lunch", "lunch"), slotFits("lunch", "dinner")]).toEqual([true, false]);
    expect([slotFits("either", "lunch"), slotFits(undefined, "dinner")]).toEqual([true, true]);
    expect([slotFits("breakfast", "lunch"), slotFits("breakfast", "dinner")]).toEqual([false, false]);
  });
});

describe("planning with the usual slot", () => {
  // Share of weekday-and-Sunday dinner picks that were historically dinner meals (Saturday is pizza).
  const dinnerShare = (meals: Map<string, PlanMeal>) => {
    let supper = 0;
    let all = 0;
    for (const s of SEEDS.slice(0, 60)) {
      const r = generateWeek({ weekStart: WEEK, meals, history: HISTORY, keep: [], seed: s });
      for (const c of r.cells.filter((c) => c.slot === "dinner" && c.day !== "sat")) {
        all++;
        if (PREFS.get(c.mealId) === "supper") supper++;
      }
    }
    return supper / all;
  };

  it("makes dinners look like the dinners in the menu sheet", () => {
    const withPrefs = dinnerShare(MEALS);
    const without = dinnerShare(library({ prefs: false }));
    expect(withPrefs).toBeGreaterThanOrEqual(0.85);
    expect(without).toBeLessThan(0.7);
    expect(withPrefs - without).toBeGreaterThan(0.2);
  });

  it("keeps every meal in its slot and every hard rule, unless it says what it relaxed", () => {
    for (const s of SEEDS.slice(0, 60)) {
      const r = generateWeek({ weekStart: WEEK, meals: MEALS, history: HISTORY, keep: [], seed: s });
      expect(r.unfilled).toEqual([]);
      if (!r.relaxed.includes("slot"))
        for (const c of r.cells) if (!(c.day === "sat" && c.slot === "dinner") && !(c.day === "sun" && c.slot === "lunch"))
          expect(slotFits(MEALS.get(c.mealId)!.slotPref, c.slot), `seed ${s} ${c.day} ${c.slot} ${c.mealId}`).toBe(true);
      const hard = hardRules(WEEK, r.cells, HISTORY).filter((w) => !(r.relaxed.length && w.rule === "recency"));
      expect(hard, `seed ${s}`).toEqual([]);
    }
  });

  it("never plans a breakfast for lunch or dinner", () => {
    const meals = new Map(MEALS);
    for (const id of ["Tostada con aguacate/huevos (variants)", "Tostis / tosties", "Pisto (variants)"])
      meals.set(id, { ...meals.get(id)!, slotPref: "breakfast" });
    for (const s of SEEDS.slice(0, 40)) {
      const ids = generateWeek({ weekStart: WEEK, meals, history: OLD, keep: [], seed: s }).cells.map((c) => c.mealId);
      expect(ids).not.toContain("Pisto (variants)");
      expect(ids).not.toContain("Tostis / tosties");
    }
  });

  it("relaxes the usual slot only as a last resort, and says so", () => {
    // Every meal is a lunch meal except the pizza: the week cannot be filled otherwise.
    const meals = new Map([...MEALS].map(([id, m]) => [id, { ...m, slotPref: id === "Pizza" ? ("supper" as const) : ("lunch" as const) }]));
    const r = generateWeek({ weekStart: WEEK, meals, history: OLD, keep: [], seed: 3 });
    expect(r.unfilled).toEqual([]);
    expect(r.relaxed).toContain("slot");
    expect(r.cells.some((c) => /usually a lunch/.test(c.why))).toBe(true);
  });

  it("says when a meal is a usual dinner or lunch", () => {
    const r = generateWeek({ weekStart: WEEK, meals: MEALS, history: HISTORY, keep: [], seed: 5 });
    expect(r.cells.some((c) => c.slot === "dinner" && /a usual dinner/.test(c.why))).toBe(true);
    expect(r.cells.some((c) => c.slot === "lunch" && /a usual lunch/.test(c.why))).toBe(true);
  });

  it("ranks swaps that fit the slot first", () => {
    const cells: Cell[] = [];
    const s = suggestAlternatives({ weekStart: WEEK, cells, meals: MEALS, history: OLD, cell: { day: "tue", slot: "dinner", mealId: null }, count: 5 });
    expect(s.every(({ meal }) => slotFits(meal.slotPref, "dinner"))).toBe(true);
  });
});

describe("favourites come back more often", () => {
  // Times each favourite is planned, per meal and per week, against the other meals.
  const rate = (meals: Map<string, PlanMeal>) => {
    const favs = seed.meals.filter((m) => m.isFavourite).map((m) => m.nameGroup);
    let fav = 0;
    let other = 0;
    for (const s of SEEDS) {
      const r = generateWeek({ weekStart: WEEK, meals, history: OLD, keep: [], seed: s });
      expect(hardRules(WEEK, r.cells, OLD, meals), `seed ${s}`).toEqual([]);
      for (const c of r.cells) {
        if ((c.day === "sat" && c.slot === "dinner") || (c.day === "sun" && c.slot === "lunch")) continue; // traditions
        if (favs.includes(c.mealId)) fav++;
        else other++;
      }
    }
    return fav / favs.length / (other / (seed.meals.length - favs.length));
  };

  it("about twice as often as other meals, with every rule still kept", () => {
    const ratio = rate(MEALS);
    expect(ratio).toBeGreaterThan(1.6);
    expect(ratio).toBeLessThan(3.5);
    const flat = rate(library({ favourites: false }));
    expect(flat).toBeGreaterThan(0.7);
    expect(flat).toBeLessThan(1.4);
  });

  it("draws a weighted item ahead about as often as its weight says", () => {
    const rand = rng(42);
    let first = 0;
    for (let i = 0; i < 4000; i++) if (weightedShuffle(["fav", "other"], (x) => (x === "fav" ? FAVOURITE_WEIGHT : 1), rand)[0] === "fav") first++;
    expect(first / 4000).toBeCloseTo(FAVOURITE_WEIGHT / (FAVOURITE_WEIGHT + 1), 1);
  });

  it("says favourite in the why line", () => {
    const r = generateWeek({ weekStart: WEEK, meals: MEALS, history: OLD, keep: [], seed: 8 });
    const favCell = r.cells.find((c) => MEALS.get(c.mealId)!.favourite)!;
    expect(favCell.why).toMatch(/favourite/);
  });
});

describe("plan week: this week and next", () => {
  const A = "2026-11-09";
  const B = "2026-11-16";
  const thisWeek: Cell[] = [
    { day: "mon", slot: "lunch", mealId: "Pasta pesto" },
    { day: "mon", slot: "dinner", mealId: "Pescado con ensalada de tomates y aguacate" },
    { day: "tue", slot: "dinner", mealId: null }, // free text
  ];
  const nextWeek: Cell[] = [{ day: "wed", slot: "dinner", mealId: "Fish fingers" }];

  it("fills only the empty slots of both weeks and keeps what is planned", () => {
    expect(emptySlots(thisWeek)).toBe(11);
    for (const s of SEEDS.slice(0, 30)) {
      const [a, b] = planWeeks({ weeks: [{ weekStart: A, cells: thisWeek }, { weekStart: B, cells: nextWeek }], meals: MEALS, history: OLD, seed: s });
      expect(a.failed || b.failed).toBe(false);
      expect(a.cells).toHaveLength(11);
      expect(b.cells).toHaveLength(13);
      for (const k of thisWeek) expect(a.cells.some((c) => c.day === k.day && c.slot === k.slot)).toBe(false);
      for (const k of nextWeek) expect(b.cells.some((c) => c.day === k.day && c.slot === k.slot)).toBe(false);
    }
  });

  it("never repeats a meal across the two weeks, except the Saturday pizza and Sunday roast", () => {
    for (const s of SEEDS.slice(0, 30)) {
      const [a, b] = planWeeks({ weeks: [{ weekStart: A, cells: thisWeek }, { weekStart: B, cells: nextWeek }], meals: MEALS, history: OLD, seed: s });
      const all = [...thisWeek.map((c) => ({ ...c, w: A })), ...nextWeek.map((c) => ({ ...c, w: B })), ...a.cells.map((c) => ({ ...c, w: A })), ...b.cells.map((c) => ({ ...c, w: B }))];
      const notTradition = all.filter((c) => c.mealId && !(c.day === "sat" && c.slot === "dinner") && !(c.day === "sun" && c.slot === "lunch"));
      const ids = notTradition.map((c) => c.mealId);
      expect(new Set(ids).size, `seed ${s}`).toBe(ids.length);
      // And next week passes its own rules with this week as history.
      const history = [...OLD, ...[...thisWeek, ...a.cells].filter((c) => c.mealId).map((c) => ({ mealId: c.mealId!, date: cellDate(A, c.day) }))];
      expect(hardRules(B, [...nextWeek, ...b.cells], history), `seed ${s}`).toEqual([]);
    }
  });

  it("leaves a full week alone", () => {
    const full: Cell[] = DAYS.flatMap((day) => (["lunch", "dinner"] as const).map((slot) => ({ day, slot, mealId: null })));
    const [a] = planWeeks({ weeks: [{ weekStart: A, cells: full }], meals: MEALS, history: OLD, seed: 1 });
    expect(a).toMatchObject({ empty: 0, cells: [], failed: false });
  });

  it("leaves days that have passed as they are and counts only the days to come", () => {
    // Wednesday 11 November: Monday and Tuesday of week A have passed.
    const today = "2026-11-11";
    expect(passedDays(A, today)).toEqual(["mon", "tue"]);
    expect(passedDays(B, today)).toEqual([]);
    const thisWeek: Cell[] = [{ day: "mon", slot: "dinner", mealId: "m1" }, { day: "wed", slot: "lunch", mealId: null }];
    expect(emptySlots(thisWeek, passedDays(A, today))).toBe(9);
    for (const s of SEEDS.slice(0, 10)) {
      const [a, b] = planWeeks({ weeks: [{ weekStart: A, cells: thisWeek }, { weekStart: B, cells: [] }], meals: MEALS, history: OLD, seed: s, today });
      expect(a).toMatchObject({ empty: 9, passed: ["mon", "tue"], failed: false });
      expect(a.cells).toHaveLength(9);
      expect(a.cells.some((c) => c.day === "mon" || c.day === "tue")).toBe(false);
      expect(b).toMatchObject({ empty: 14, passed: [] });
      expect(b.cells).toHaveLength(14);
    }
    // On Sunday evening only Sunday is left; next Monday the whole week has passed.
    expect(planWeeks({ weeks: [{ weekStart: A, cells: [] }], meals: MEALS, history: OLD, seed: 1, today: "2026-11-15" })[0].cells.map((c) => c.day)).toEqual(["sun", "sun"]);
    expect(planWeeks({ weeks: [{ weekStart: A, cells: [] }], meals: MEALS, history: OLD, seed: 1, today: "2026-11-16" })[0]).toMatchObject({ empty: 0, cells: [] });
  });

  it("plans at most one new El País idea a week, never one blocked for gluten, and flags it", () => {
    const ideas: PlanMeal[] = [
      { id: "idea-1", name: "Garbanzos con espinacas", tags: mealTags({ name: "Garbanzos con espinacas" }), gluten: "needs_check", pinned: false, idea: true, slotPref: "either" },
      { id: "idea-2", name: "Merluza en salsa verde", tags: mealTags({ name: "Merluza en salsa verde" }), gluten: "needs_check", pinned: false, idea: true, slotPref: "either" },
      { id: "idea-3", name: "Lasaña de carne", tags: mealTags({ name: "Lasaña de carne" }), gluten: "blocked", pinned: false, idea: true, slotPref: "either" },
      // Ingredients not read from the recipe page: listed in Meals, never planned.
      { id: "idea-4", name: "Crema de calabaza", tags: mealTags({ name: "Crema de calabaza" }), gluten: "needs_check", pinned: false, idea: true, noPlan: true, slotPref: "either" },
      // Anything but a clean "check gluten" is never planned either.
      { id: "idea-5", name: "Merluza rebozada", tags: mealTags({ name: "Merluza rebozada" }), gluten: "needs_substitution", pinned: false, idea: true, slotPref: "either" },
    ];
    const meals = new Map([...MEALS, ...ideas.map((m) => [m.id, m] as const)]);
    let planned = 0;
    for (const s of SEEDS.slice(0, 40)) {
      for (const w of planWeeks({ weeks: [{ weekStart: A, cells: [] }, { weekStart: B, cells: [] }], meals, history: OLD, seed: s })) {
        const used = w.cells.filter((c) => c.mealId.startsWith("idea-"));
        expect(used.length).toBeLessThanOrEqual(1);
        expect(used.map((c) => c.mealId)).not.toContain("idea-3");
        expect(used.map((c) => c.mealId)).not.toContain("idea-4");
        expect(used.map((c) => c.mealId)).not.toContain("idea-5");
        for (const c of used) expect(c.why).toMatch(/from El País$/);
        planned += used.length;
      }
    }
    expect(planned).toBeGreaterThan(10); // ideas do get tried
  });
});
