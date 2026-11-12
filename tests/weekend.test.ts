import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { generateWeek } from "../lib/planner/generate";
import { DAYS, addDays, checkWeek, isWeekend, suggestAlternatives, suggestForWeek, type Cell, type PlanMeal, type Use } from "../lib/planner/rules";
import { mealTags } from "../lib/planner/tags";
import { parseSeedData } from "../lib/seed/build";

// Weekends only: a roast (or any meal the owner marks) goes only on Saturday or Sunday.

const root = join(__dirname, "..");
const read = (f: string) => readFileSync(join(root, "Seed", f), "utf8");
const seed = parseSeedData({
  menuCsv: read("meals_menu_semanal.csv"),
  favouritesCsv: read("favourites_seed.csv"),
  receiptsCsv: read("tesco_receipts_clean.csv"),
  glutenMd: read("gluten_list_for_review.md"),
});
// The real library, with every roast weekends only (as migration 0007 does), plus two
// everyday meals marked weekends only by hand, so the rule is really tested.
const BY_HAND = ["Pasta pesto", "Ensalada verde"];
const LIB: PlanMeal[] = [...seed.meals.values()].map((m) => {
  const tags = mealTags({ name: m.nameGroup });
  return { id: m.nameGroup, name: m.nameGroup, tags, gluten: "safe", pinned: false, weekendOnly: tags.isRoast || BY_HAND.includes(m.nameGroup) };
});
const MEALS = new Map(LIB.map((m) => [m.id, m]));
const HISTORY: Use[] = seed.slots
  .filter((s) => s.nameGroup)
  .map((s) => ({ mealId: s.nameGroup!, date: addDays(s.weekStart, DAYS.indexOf(s.day as (typeof DAYS)[number])) }));
const WEEK = "2026-10-26";
const c = (day: Cell["day"], slot: Cell["slot"], mealId: string | null): Cell => ({ day, slot, mealId });

describe("weekends-only meals in Plan week", () => {
  it("has roasts marked weekends only in the test library", () => {
    expect(LIB.filter((m) => m.weekendOnly).map((m) => m.id)).toEqual(
      expect.arrayContaining(["Cordero asado / roast lamb", "Pollo asado con patatas", ...BY_HAND]),
    );
  });

  it("never puts a weekends-only meal on Monday to Friday, across many seeds", () => {
    for (let s = 1; s <= 80; s++) {
      const r = generateWeek({ weekStart: WEEK, meals: MEALS, history: HISTORY, keep: [], seed: s });
      expect(r.unfilled, `seed ${s}`).toEqual([]);
      for (const cell of r.cells) if (MEALS.get(cell.mealId)!.weekendOnly) expect(isWeekend(cell.day), `seed ${s} ${cell.day}`).toBe(true);
    }
  });

  it("is never relaxed: with the weekend already planned, no weekends-only meal is used", () => {
    const keep = [c("sat", "lunch", null), c("sat", "dinner", null), c("sun", "lunch", null), c("sun", "dinner", null)];
    for (let s = 1; s <= 30; s++) {
      const r = generateWeek({ weekStart: WEEK, meals: MEALS, history: [], keep, seed: s });
      for (const cell of r.cells) expect(MEALS.get(cell.mealId)!.weekendOnly, `seed ${s}`).toBeFalsy();
    }
  });

  it("leaves a weekday empty rather than put a weekends-only meal there", () => {
    const only: PlanMeal = { id: "roast", name: "Roast lamb", tags: mealTags({ name: "Roast lamb" }), gluten: "safe", pinned: false, weekendOnly: true };
    const r = generateWeek({ weekStart: WEEK, meals: new Map([["roast", only]]), history: [], keep: [], seed: 1 });
    expect(r.cells.some((x) => x.mealId === "roast" && !isWeekend(x.day))).toBe(false);
  });
});

describe("weekends-only rules and suggestions", () => {
  const roast: PlanMeal = { id: "roast", name: "Roast lamb", tags: mealTags({ name: "Roast lamb" }), gluten: "safe", pinned: false, weekendOnly: true };
  const salad: PlanMeal = { id: "salad", name: "Ensalada verde", tags: mealTags({ name: "Ensalada verde" }), gluten: "safe", pinned: false };
  const chicken: PlanMeal = { id: "chicken", name: "Pechugas de Pollo", tags: mealTags({ name: "Pechugas de Pollo" }), gluten: "safe", pinned: false };
  const meals = new Map([roast, salad, chicken].map((m) => [m.id, m]));
  const old: Use[] = [...meals.keys()].map((id) => ({ mealId: id, date: "2026-08-01" }));

  it("warns (hard) when a weekends-only meal is on a weekday, in English and Spanish", () => {
    const w = checkWeek({ weekStart: WEEK, cells: [c("tue", "lunch", "roast")], meals, history: old }).warnings.find((x) => x.rule === "weekend");
    expect(w).toMatchObject({ level: "hard", cells: ["tue-lunch"] });
    expect(w!.text).toBe("Roast lamb is a weekends-only meal but is on Tue lunch");
    const es = checkWeek({ weekStart: WEEK, cells: [c("tue", "lunch", "roast")], meals, history: old, lang: "es" }).warnings.find((x) => x.rule === "weekend");
    expect(es!.text).toMatch(/solo para fines de semana/);
  });

  it("does not warn on Saturday or Sunday", () => {
    for (const day of ["sat", "sun"] as const)
      expect(checkWeek({ weekStart: WEEK, cells: [c(day, "dinner", "roast")], meals, history: old }).warnings.map((x) => x.rule)).not.toContain("weekend");
  });

  it("never offers a weekends-only meal as a swap on a weekday, but does at the weekend", () => {
    for (const day of ["mon", "tue", "wed", "thu", "fri"] as const)
      for (const slot of ["lunch", "dinner"] as const)
        expect(suggestAlternatives({ weekStart: WEEK, cells: [], meals, history: old, cell: c(day, slot, null), count: 10 }).map((s) => s.meal.id)).not.toContain("roast");
    expect(suggestAlternatives({ weekStart: WEEK, cells: [], meals, history: old, cell: c("sat", "lunch", null), count: 10 }).map((s) => s.meal.id)).toContain("roast");
  });

  it("still lists it in the week's suggestions, saying weekends only", () => {
    const s = suggestForWeek({ weekStart: WEEK, cells: [], meals, history: old }).find((x) => x.meal.id === "roast");
    expect(s?.why).toMatch(/weekends only/);
  });
});

// Migration 0007 on a real (in-memory) Postgres: which meals start as weekends only.
const AUTH_STUB = `
  create schema if not exists auth;
  create or replace function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  grant usage on schema public to authenticated;
`;

describe("migration 0007_weekend_only", () => {
  const files = readdirSync(join(root, "supabase/migrations")).sort();
  const before = files.filter((f) => f < "0007").map((f) => readFileSync(join(root, "supabase/migrations", f), "utf8"));
  const m0007 = readFileSync(join(root, "supabase/migrations/0007_weekend_only.sql"), "utf8");
  const H = "00000000-0000-4000-8000-000000000001";
  const LIVE: [string, string | null][] = [
    ["Cordero asado / roast lamb", null],
    ["roast lamb", null],
    ["Pollo asado con patatas", null],
    ["Pollo", "Roast Chicken with tomato & Chorizo"],
    ["Patatas asadas con ensalada", null],
    ["Patatas asadas con bacon y ensalada", null],
    ["Verduras de otoño asadas con queso feta", null],
    ["Pechugas de pollo con patatas asadas y ensalada", null],
    ["Crema de calabaza asada", null],
    ["Lechón asado", null],
  ];

  it("marks roasts of meat, not roasted vegetables, and leaves later changes alone when run again", async () => {
    const db = new PGlite();
    await db.exec(AUTH_STUB);
    for (const m of before) await db.exec(m);
    await db.exec(`insert into public.households (id, name) values ('${H}', 'Test')`);
    for (const [name, en] of LIVE)
      await db.query("insert into public.meals (household_id, name, name_group, name_en) values ($1, $2, $2, $3)", [H, name, en]);
    await db.exec(m0007);
    const flagged = async () =>
      (await db.query<{ name: string }>("select name from public.meals where weekend_only order by name")).rows.map((r) => r.name);
    expect(await flagged()).toEqual(["Cordero asado / roast lamb", "Lechón asado", "Pollo", "Pollo asado con patatas", "roast lamb"]);

    // The owner unticks one; running the migration again keeps that.
    await db.exec("update public.meals set weekend_only = false where name = 'roast lamb'");
    await db.exec(m0007);
    expect(await flagged()).not.toContain("roast lamb");
    await db.close();
  });
});
