import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RULES, screenMeal } from "../lib/gluten/gate";
import { parseSeedData } from "../lib/seed/build";

const root = join(__dirname, "..");

describe("gluten gate", () => {
  it("never lets a Tier A item through, whatever surrounds it", () => {
    const fillers = ["", "con ensalada", "y pollo asado", "(GF)", "sin gluten", "Tortilla de patatas y", "with rice and salad:"];
    for (const rule of RULES.filter((r) => r.tier === "A")) {
      for (const term of rule.terms) {
        for (const before of fillers) {
          for (const after of fillers) {
            const v = screenMeal({ name: `${before} ${term} ${after}` });
            expect(v.status, `${before} ${term} ${after}`).toBe("blocked");
          }
        }
        // Capitals and accents do not hide it either.
        expect(screenMeal({ name: term.toUpperCase() }).status).toBe("blocked");
      }
    }
  });

  it("finds Tier A items in the ingredients after the colon, not only the name", () => {
    expect(screenMeal({ name: "Sopa de garbanzos", ingredients: "1 puerro, fideos finos" }).status).toBe("blocked");
    expect(screenMeal({ name: "Merluza", ingredients: "harina de trigo para rebozar" }).status).toBe("blocked");
  });

  it("blocks ramen and suggests a GF swap (phase 2 check)", () => {
    const v = screenMeal({ name: "Ramen" });
    expect(v.status).toBe("blocked");
    expect(v.swaps[0]).toMatch(/rice noodles/i);
    expect(screenMeal({ name: "Ramen de pollo con huevo" }).status).toBe("blocked");
    const fromSheet = screenMeal({
      name: "Ramen para vagos (El Comidista): https://elpais.com/gastronomia/el-comidista/2026-03-03/ramen-para-vagos-una-receta-rapida-y-sabrosa-con-el-minimo-esfuerzo.html",
    });
    expect(fromSheet.status).toBe("blocked");
    expect(fromSheet.swaps[0]).toMatch(/rice noodles/i);
  });

  it("marks Tier B meals as Needs substitution with the GF product to use", () => {
    for (const name of ["Pasta con atún (Jamie)", "Pizza", "Fish fingers con ensalada de pepino", "Tostis con ensalada", "Pollo teriyaki con arroz", "Chicken tenders con ensalada"]) {
      const v = screenMeal({ name });
      expect(v.status, name).toBe("needs_substitution");
      expect(v.swaps.length, name).toBeGreaterThan(0);
    }
  });

  it("sends Tier C items and the open questions to Needs your check (strictest default)", () => {
    for (const name of [
      "Salchichas con ensalada",
      "Curry Rogan Josh (cordero)",
      "Chili con Carne",
      "Lentejas estofadas",
      "Pastel de pescado",
      "Nachos con carne",
      "Calabaza con alubias y garbanzos",
      "Pisto con arroz",
    ]) {
      expect(screenMeal({ name }).status, name).toBe("needs_check");
    }
    expect(screenMeal({ name: "Nandos (cumple chicos)" }).status).toBe("needs_check");
    expect(screenMeal({ name: "Cena fuera", isTakeaway: true }).status).toBe("needs_check");
  });

  it("does not call a meal Safe when it recognises nothing in it", () => {
    const v = screenMeal({ name: "Bunsens" });
    expect(v.status).toBe("needs_check");
  });

  it("catches the family's own spellings", () => {
    expect(screenMeal({ name: "Ensalada de gnoquis crujientes" }).status).toBe("blocked");
    expect(screenMeal({ name: "Amburguesas" }).status).toBe("needs_check");
  });

  it("does not confuse a Spanish tortilla with a wheat tortilla", () => {
    expect(screenMeal({ name: "Tortilla de patatas con ensalada" }).status).toBe("safe");
    expect(screenMeal({ name: "Tortilla de berenjena con ensalada" }).status).toBe("safe");
    expect(screenMeal({ name: "Tortilla wraps de pollo" }).status).toBe("needs_substitution");
  });

  it("marks plain whole-food meals as Safe", () => {
    for (const name of ["Ensalada verde", "Pollo asado con patatas", "Cordero asado", "Pescado con ensalada de tomates y aguacate", "Salmón con arroz"]) {
      expect(screenMeal({ name }).status, name).toBe("safe");
    }
  });

  it("takes the worst status when a meal has several problems", () => {
    const v = screenMeal({ name: "Pizza y croquetas" });
    expect(v.status).toBe("blocked");
    expect(v.findings.map((f) => f.rule)).toEqual(["breaded", "pizza"]);
  });

  it("gives the same verdict for the same input", () => {
    expect(screenMeal({ name: "Pasta con chorizo" })).toEqual(screenMeal({ name: "Pasta con chorizo" }));
  });

  it("screens every meal in the seed menu without throwing", () => {
    const data = parseSeedData({
      menuCsv: readFileSync(join(root, "Seed/meals_menu_semanal.csv"), "utf8"),
      favouritesCsv: readFileSync(join(root, "Seed/favourites_seed.csv"), "utf8"),
      receiptsCsv: readFileSync(join(root, "Seed/tesco_receipts_clean.csv"), "utf8"),
      glutenMd: readFileSync(join(root, "Seed/gluten_list_for_review.md"), "utf8"),
    });
    const counts: Record<string, number> = {};
    for (const m of data.meals) {
      const v = screenMeal({ name: m.nameGroup, variants: m.variants, ingredients: m.ingredientsNote });
      counts[v.status] = (counts[v.status] ?? 0) + 1;
    }
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(data.meals.length);
  });
});
