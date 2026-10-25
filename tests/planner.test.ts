import { describe, expect, it } from "vitest";
import { checkWeek, suggestAlternatives, suggestForWeek, type Cell, type PlanMeal, type Use } from "../lib/planner/rules";
import { guessTags, mealTags } from "../lib/planner/tags";

const WEEK = "2026-10-26";

function meal(id: string, name: string, extra: Partial<PlanMeal> = {}): PlanMeal {
  return { id, name, tags: mealTags({ name }), gluten: "safe", pinned: false, ...extra };
}

const LIB = [
  meal("roast", "Cordero asado"),
  meal("pizza", "Pizza"),
  meal("salmon", "Salmón con arroz"),
  meal("salad", "Ensalada verde"),
  meal("lentils", "Ensalada de lentejas"),
  meal("pasta1", "Pasta pesto"),
  meal("pasta2", "Pasta con Pollo"),
  meal("pasta3", "Pasta carbonara"),
  meal("fingers", "Fish fingers"),
  meal("sausages", "Salchichas con ensalada"),
  meal("tenders", "Chicken tenders con ensalada"),
  meal("chicken", "Pollo asado con patatas"),
  meal("tortilla", "Tortilla de patatas con ensalada"),
  meal("soup", "Sopa de zanahoria"),
  meal("stew", "Lentejas estofadas"),
  meal("risotto", "Risotto"),
];
const MEALS = new Map(LIB.map((m) => [m.id, m]));
// Everything has been eaten before, a while ago.
const OLD: Use[] = LIB.map((m) => ({ mealId: m.id, date: "2026-08-01" }));

const c = (day: Cell["day"], slot: Cell["slot"], mealId: string | null): Cell => ({ day, slot, mealId });
const rules = (cells: Cell[], history = OLD, meals = MEALS) =>
  checkWeek({ weekStart: WEEK, cells, meals, history }).warnings.map((w) => w.rule);

describe("meal tags", () => {
  it("guesses protein, starch, pasta and processed from the name", () => {
    expect(guessTags("Pasta con atún y anchoillas")).toMatchObject({ protein: "fish", starch: "pasta", isPasta: true });
    expect(guessTags("Patatas al horno can bacon y ensalada verde")).toMatchObject({ protein: "meat", starch: "potatoes" });
    expect(guessTags("Lentejas estofadas")).toMatchObject({ protein: "veg", effort: "long" });
    expect(guessTags("Fish fingers con pepino")).toMatchObject({ protein: "fish", isProcessed: true, effort: "quick" });
    expect(guessTags("Ramen para vagos").starch).toBe("noodles");
    expect(guessTags("Cordero asado / roast lamb").isRoast).toBe(true);
  });

  it("uses what the owner saved over the guess", () => {
    const t = mealTags({ name: "Pasta pesto", protein: "meat", is_pasta: false, effort: "normal" });
    expect(t).toMatchObject({ protein: "meat", isPasta: false, effort: "normal" });
    expect(t.guessed).toMatchObject({ protein: false, isPasta: false, effort: false, isProcessed: true });
  });
});

describe("week rules", () => {
  it("counts fish, pasta, processed and new meals and updates as cells change", () => {
    const cells = [c("mon", "lunch", "salmon"), c("mon", "dinner", "pasta1")];
    const a = checkWeek({ weekStart: WEEK, cells, meals: MEALS, history: OLD }).counts;
    expect(a).toMatchObject({ filled: 2, toFill: 14, fish: 1, pasta: 1, processed: 0, newMeals: 0 });
    const b = checkWeek({ weekStart: WEEK, cells: [...cells, c("tue", "lunch", "fingers")], meals: MEALS, history: OLD }).counts;
    expect(b).toMatchObject({ filled: 3, fish: 2, processed: 1 });
  });

  it("only gluten blocks", () => {
    const meals = new Map(MEALS);
    meals.set("ramen", meal("ramen", "Ramen", { gluten: "blocked" }));
    const w = checkWeek({ weekStart: WEEK, cells: [c("tue", "lunch", "ramen")], meals, history: OLD }).warnings;
    expect(w.filter((x) => x.level === "block").map((x) => x.rule)).toEqual(["gluten"]);
    expect(rules([c("mon", "lunch", "pasta1"), c("tue", "lunch", "pasta2"), c("wed", "lunch", "pasta3")])).not.toContain("gluten");
  });

  it("warns on more than 2 pasta or 2 processed meals", () => {
    expect(rules([c("mon", "lunch", "pasta1"), c("wed", "lunch", "pasta2")])).not.toContain("pasta");
    expect(rules([c("mon", "lunch", "pasta1"), c("wed", "lunch", "pasta2"), c("sat", "lunch", "pasta3")])).toContain("pasta");
    expect(rules([c("mon", "lunch", "fingers"), c("wed", "lunch", "sausages"), c("fri", "lunch", "tenders")])).toContain("processed");
  });

  it("warns when a meal is in the week twice", () => {
    expect(rules([c("mon", "lunch", "salad"), c("thu", "dinner", "salad")])).toContain("repeat");
  });

  it("wants one meat or fish meal and one vegetarian meal each day", () => {
    expect(rules([c("mon", "lunch", "chicken"), c("mon", "dinner", "salad")])).not.toContain("daily-mix");
    expect(rules([c("mon", "lunch", "chicken"), c("mon", "dinner", "sausages")])).toContain("daily-mix");
    expect(rules([c("mon", "lunch", "soup"), c("mon", "dinner", "salad")])).toContain("daily-mix");
  });

  it("keeps the Sunday roast and Saturday pizza", () => {
    expect(rules([c("sun", "lunch", "roast"), c("sat", "dinner", "pizza")])).not.toContain("tradition");
    expect(rules([c("sun", "lunch", "salad")])).toContain("tradition");
    expect(rules([c("sat", "dinner", "salad")])).toContain("tradition");
  });

  it("warns about a long cook on a weeknight", () => {
    expect(rules([c("tue", "dinner", "stew")])).toContain("effort");
    expect(rules([c("sat", "dinner", "stew")])).not.toContain("effort");
  });

  it("warns when a meal was planned in the last 3 weeks, or 2 if pinned", () => {
    const recent: Use[] = [...OLD, { mealId: "salad", date: "2026-10-12" }];
    expect(rules([c("mon", "lunch", "salad")], recent)).toContain("recency");
    expect(rules([c("mon", "lunch", "salad")], [...OLD, { mealId: "salad", date: "2026-10-01" }])).not.toContain("recency");
    const pinned = new Map(MEALS);
    pinned.set("salad", { ...MEALS.get("salad")!, pinned: true });
    expect(rules([c("mon", "lunch", "salad")], recent, pinned)).not.toContain("recency");
  });

  it("warns about more than 1 new meal", () => {
    const history = OLD.filter((u) => u.mealId !== "risotto" && u.mealId !== "tortilla");
    expect(rules([c("mon", "lunch", "risotto")], history)).not.toContain("new");
    expect(rules([c("mon", "lunch", "risotto"), c("tue", "lunch", "tortilla")], history)).toContain("new");
  });

  it("softly warns about the same starch twice in 3 days", () => {
    const w = checkWeek({ weekStart: WEEK, cells: [c("mon", "lunch", "salmon"), c("wed", "dinner", "risotto")], meals: MEALS, history: OLD }).warnings;
    expect(w.find((x) => x.rule === "starch")?.level).toBe("soft");
    expect(rules([c("mon", "lunch", "salmon"), c("thu", "dinner", "risotto")])).not.toContain("starch");
  });

  it("warns about no fish only once the week is full", () => {
    const veg = ["salad", "lentils", "soup", "tortilla", "risotto", "pasta1", "stew"];
    const meat = ["chicken", "sausages", "pasta2", "pasta3", "tenders", "pizza", "roast"];
    const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
    const full = days.flatMap((d, i) => [c(d, "lunch", veg[i]), c(d, "dinner", meat[i])]);
    expect(rules(full)).toContain("fish");
    expect(rules(full.slice(0, 13))).not.toContain("fish");
  });

  it("wants at least 2 pulse meals in a full week", () => {
    expect(guessTags("Lentejas estofadas").isPulse).toBe(true);
    expect(guessTags("Loaded black bean nachos").isPulse).toBe(true);
    expect(guessTags("Ensalada verde").isPulse).toBe(false);
    const veg = ["salad", "lentils", "soup", "tortilla", "risotto", "pasta1", "stew"];
    const meat = ["chicken", "sausages", "pasta2", "salmon", "tenders", "pizza", "roast"];
    const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
    const full = days.flatMap((d, i) => [c(d, "lunch", veg[i]), c(d, "dinner", meat[i])]);
    // Lentil salad and lentil stew are two pulse meals.
    expect(checkWeek({ weekStart: WEEK, cells: full, meals: MEALS, history: OLD }).counts.pulses).toBe(2);
    expect(rules(full)).not.toContain("pulses");
    const fewer = full.map((x) => (x.mealId === "stew" ? { ...x, mealId: "pasta3" } : x));
    expect(rules(fewer)).toContain("pulses");
  });
});

describe("week sidebar suggestions", () => {
  it("leads with pulses and fish when the week has none, then mixes meat, veg and fish", () => {
    const s = suggestForWeek({ weekStart: WEEK, cells: [], meals: MEALS, history: OLD, count: 6 });
    expect(s).toHaveLength(6);
    expect(s[0].meal.tags.isPulse).toBe(true);
    expect(s[1].meal.tags.protein).toBe("fish");
    expect(new Set(s.map((x) => x.meal.tags.protein))).toEqual(new Set(["meat", "veg", "fish"]));
  });

  it("leaves out meals already in the week, recent meals and blocked meals", () => {
    const meals = new Map(MEALS);
    meals.set("ramen", meal("ramen", "Ramen", { gluten: "blocked" }));
    const history: Use[] = [...OLD, { mealId: "soup", date: "2026-10-20" }];
    const ids = suggestForWeek({ weekStart: WEEK, cells: [c("mon", "lunch", "salad")], meals, history, count: 50 }).map((x) => x.meal.id);
    expect(ids).not.toContain("salad");
    expect(ids).not.toContain("soup");
    expect(ids).not.toContain("ramen");
  });
});

describe("swap suggestions", () => {
  it("offers 3 meals that are not in the week, not recent and not blocked", () => {
    const meals = new Map(MEALS);
    meals.set("ramen", meal("ramen", "Ramen", { gluten: "blocked" }));
    const history: Use[] = [...OLD, { mealId: "soup", date: "2026-10-20" }];
    const cells = [c("mon", "lunch", "salad"), c("tue", "lunch", "lentils")];
    const s = suggestAlternatives({ weekStart: WEEK, cells, meals, history, cell: cells[0] });
    expect(s).toHaveLength(3);
    const ids = s.map((x) => x.meal.id);
    expect(ids).not.toContain("salad");
    expect(ids).not.toContain("lentils");
    expect(ids).not.toContain("soup");
    expect(ids).not.toContain("ramen");
    // Same protein as the meal being swapped.
    expect(s.every((x) => x.meal.tags.protein === "veg")).toBe(true);
  });

  it("puts the roast first for Sunday lunch and the vegetarian side of the day's mix first", () => {
    expect(suggestAlternatives({ weekStart: WEEK, cells: [], meals: MEALS, history: OLD, cell: c("sun", "lunch", null) })[0].meal.id).toBe("roast");
    const cells = [c("wed", "lunch", "chicken")];
    const s = suggestAlternatives({ weekStart: WEEK, cells, meals: MEALS, history: OLD, cell: c("wed", "dinner", null) });
    expect(s.every((x) => x.meal.tags.protein === "veg")).toBe(true);
  });

  it("gives the same suggestions for the same inputs", () => {
    const args = { weekStart: WEEK, cells: [], meals: MEALS, history: OLD, cell: c("thu", "dinner", null) };
    expect(suggestAlternatives(args)).toEqual(suggestAlternatives(args));
  });
});
