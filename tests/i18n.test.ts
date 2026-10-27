import { describe, expect, it } from "vitest";
import { localiseVerdict } from "../lib/gluten/es";
import { RULES, screenMeal } from "../lib/gluten/gate";
import { MESSAGES, mealName } from "../lib/i18n/messages";
import { checkWeek, type PlanMeal } from "../lib/planner/rules";
import { mealTags } from "../lib/planner/tags";

function keys(o: object, prefix = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("English and Spanish", () => {
  it("has every message in both languages", () => {
    expect(keys(MESSAGES.es).sort()).toEqual(keys(MESSAGES.en).sort());
  });

  it("shows the meal name in the chosen language, falling back to how it was written", () => {
    const m = { name: "Lentejas estofadas (variants)", name_en: "Lentil stew", name_es: "Lentejas estofadas" };
    expect(mealName(m, "en")).toBe("Lentil stew");
    expect(mealName(m, "es")).toBe("Lentejas estofadas");
    expect(mealName({ name: "Cena nueva" }, "en")).toBe("Cena nueva");
  });

  it("translates every gluten rule note and swap into Spanish", () => {
    for (const r of RULES) {
      const f = { rule: r.id, term: r.terms[0] ?? r.id, tier: r.tier, status: r.status, note: r.note, swap: r.swap };
      const [es] = localiseVerdict({ status: r.status, findings: [f], swaps: [] }, "es").findings;
      expect(es.note, r.id).not.toBe(r.note);
      if (r.swap) expect(es.swap, r.id).not.toBe(r.swap);
    }
    const v = localiseVerdict(screenMeal({ name: "Ramen" }), "es");
    expect(v.swaps[0]).toMatch(/fideos de arroz/);
  });

  it("writes week warnings in Spanish", () => {
    const meal: PlanMeal = { id: "a", name: "Pasta con pollo", tags: mealTags({ name: "Pasta con pollo" }), gluten: "safe", pinned: false };
    const meals = new Map([[meal.id, meal]]);
    const cells = [
      { day: "mon" as const, slot: "lunch" as const, mealId: "a" },
      { day: "tue" as const, slot: "lunch" as const, mealId: "a" },
    ];
    const { warnings } = checkWeek({ weekStart: "2026-11-02", cells, meals, history: [], lang: "es" });
    expect(warnings.map((w) => w.text)).toContain("Pasta con pollo está 2 veces en la semana");
  });
});
