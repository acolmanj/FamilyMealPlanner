import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RULES, applyConfirmation, screenMeal } from "../lib/gluten/gate";
import { isNotAMeal } from "../lib/planner/not-a-meal";
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

  it("sends Tier C items to Needs your check", () => {
    for (const name of [
      "Salchichas con ensalada",
      "Curry Rogan Josh (cordero)",
      "Chili con Carne",
      "Lentejas estofadas",
      "Nachos con carne",
      "Calabaza con alubias y garbanzos",
      "Pisto con arroz",
    ]) {
      expect(screenMeal({ name }).status, name).toBe("needs_check");
    }
    expect(screenMeal({ name: "Nandos (cumple chicos)" }).status).toBe("needs_check");
    expect(screenMeal({ name: "Cena fuera", isTakeaway: true }).status).toBe("needs_check");
  });

  // The owner's answers, 11 November 2026.
  describe("the owner's answers", () => {
    it("1. tinned food needs a label check", () => {
      for (const name of ["Calabaza con alubias de bote", "400g tin black beans", "Tinned tomatoes", "Tomate en lata", "Garbanzos en conserva"]) {
        const v = screenMeal({ name });
        expect(v.status, name).toBe("needs_check");
        expect(v.findings.map((f) => f.rule), name).toContain("tinned");
      }
    });

    it("2. tinned fish is safe, and wins over the tin word", () => {
      for (const name of ["Tinned tuna", "Tin of tuna", "Canned sardines", "Atún en lata", "Lata de atún", "Sardinas en lata", "Atún en aceite", "Ensalada de caballa en conserva"]) {
        const v = screenMeal({ name });
        expect(v.status, name).toBe("safe");
        expect(v.findings.map((f) => f.rule), name).toContain("tinned-fish");
      }
      expect(screenMeal({ name: "Ensalada", ingredients: "1 tin tuna in sunflower oil" }).status).toBe("safe");
      expect(screenMeal({ name: "Parmentier sardines in olive oil" }).status).toBe("safe");
      expect(screenMeal({ name: "Ensalada", ingredients: "1 tin John West tuna\n2 tomates" }).status).toBe("safe");
      // A tin to cook in is not tinned food.
      expect(screenMeal({ name: "Chicken in a roasting tin" }).status).toBe("safe");
      // A tin of beans next to the tuna still needs its check.
      expect(screenMeal({ name: "Tinned tuna", ingredients: "400g tin black beans" }).status).toBe("needs_check");
    });

    it("3. anything labelled gluten free is safe, and Tesco Free From counts", () => {
      for (const name of ["Tesco Free From pasta", "Pasta sin gluten", "Gluten free pizza base", "Gluten-free spaghetti", "GF pasta con atún"]) {
        const v = screenMeal({ name });
        expect(v.status, name).toBe("safe");
        expect(v.findings.map((f) => f.rule), name).toContain("labelled-gf");
      }
      // Only the labelled item: the rest of the meal is still screened.
      expect(screenMeal({ name: "GF pasta with sausages" }).status).toBe("needs_check");
      expect(screenMeal({ name: "Ensalada", ingredients: "Tesco Free From pasta, 2 salchichas" }).status).toBe("needs_check");
      expect(screenMeal({ name: "Pasta sin gluten", ingredients: "1 pastilla de caldo" }).status).toBe("needs_check");
      // One label clears one thing, even with no joining word.
      for (const name of ["GF pasta sausages", "GF pasta & sausages", "GF pasta + meatballs", "Salchichas pasta sin gluten", "Free from lasagne / sausages"]) {
        expect(screenMeal({ name }).status, name).toBe("needs_check");
      }
      expect(screenMeal({ name: "Pastel de pescado sin gluten" }).status).toBe("safe");
      // "gf" is a whole word only.
      expect(screenMeal({ name: "gfx pasta" }).status).toBe("needs_substitution");
      // No label, no pass.
      expect(screenMeal({ name: "Pasta" }).status).toBe("needs_substitution");
      // A label never clears a Tier A item.
      expect(screenMeal({ name: "GF ramen" }).status).toBe("blocked");
      expect(screenMeal({ name: "Fideos sin gluten" }).status).toBe("blocked");
    });

    it("4. fish pie is safe, with the cornflour swap", () => {
      for (const name of ["Pastel de pescado", "Fish pie"]) {
        const v = screenMeal({ name });
        expect(v.status, name).toBe("safe");
        expect(v.swaps[0], name).toMatch(/cornflour/);
      }
      expect(screenMeal({ name: "Fish pie", ingredients: "2 tbsp plain flour" }).status).toBe("blocked");
      expect(screenMeal({ name: "Apple pie" }).status).toBe("blocked");
    });

    it("6. nachos and tortilla chips need a label check; wraps still need GF ones", () => {
      expect(screenMeal({ name: "Nachos con carne" }).status).toBe("needs_check");
      expect(screenMeal({ name: "Tortilla chips con guacamole" }).status).toBe("needs_check");
      expect(screenMeal({ name: "Tortilla wraps de pollo" }).status).toBe("needs_substitution");
      expect(screenMeal({ name: "Tortilla de patatas" }).status).toBe("safe");
    });

    it("7. take-away and eating out are not meals", () => {
      for (const name of ["Nandos", "Take-away", "Takeaway", "Take away (cumple)", "Eating out", "Comer fuera", "Comida para llevar"]) {
        expect(isNotAMeal(name), name).toBe(true);
      }
      expect(isNotAMeal("Sobras")).toBe(true);
      for (const name of ["Pollo asado", "Pastel de pescado", "Tortilla de patatas"]) expect(isNotAMeal(name), name).toBe(false);
      expect(screenMeal({ name: "Nandos" }).findings[0].note).toMatch(/not meals/);
    });
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

  it("shows a household-confirmed meal as Safe but keeps its GF swap", () => {
    const ramen = screenMeal({ name: "Ramen para vagos" });
    const v = applyConfirmation(ramen, true);
    expect(v.status).toBe("safe");
    expect(v.screened).toBe("blocked");
    expect(v.swaps[0]).toMatch(/rice noodles/i);
    expect(applyConfirmation(ramen, false).status).toBe("blocked");
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

describe("take-away matcher stays narrow", () => {
  it("keeps real meals that mention a restaurant or a packed lunch", () => {
    expect(isNotAMeal("Restaurant-style chicken curry")).toBe(false);
    expect(isNotAMeal("Lentejas para llevar al trabajo")).toBe(false);
  });
  it("treats a branded tin of tuna as tinned fish", () => {
    expect(screenMeal({ name: "Ensalada", ingredients: "1 tin of Princes tuna" }).status).toBe("safe");
  });
});
