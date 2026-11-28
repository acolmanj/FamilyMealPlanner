import { describe, expect, it } from "vitest";
import { cleanCell, makeMatcher, normalise, similarity, type LibraryMeal } from "../lib/sheet-sync/match";

const meal = (id: string, name: string, extra: Partial<LibraryMeal> = {}): LibraryMeal => ({
  id, name, name_group: name, name_en: null, name_es: null, variants_seen: [], ...extra,
});

const LIBRARY: LibraryMeal[] = [
  meal("pie", "Pastel de pescado", { name_en: "Fish pie" }),
  meal("tortilla", "Tortilla de patatas con ensalada", { variants_seen: ["Tortilla de patatas con ensalada"] }),
  meal("bolo", "Pasta boloñesa (variants)", { name_en: "Spaghetti bolognese", variants_seen: ["Pasta boloñesa", "Bolognesa"] }),
  meal("pisto", "Pisto (variants)", { variants_seen: ["Pisto", "Pisto con arroz (congelador)"] }),
  meal("crema", "Crema de zanahoria", { name_en: "Carrot soup" }),
  meal("pancakes", "Pancakes con salmón", { name_en: "Pancakes with salmon" }),
  meal("verde", "Ensalada verde"),
  meal("pizza", "Pizza", { variants_seen: ["Pizza y croquetas"] }),
  meal("lentejas", "Ensalada de lentejas"),
  meal("lentejas2", "Ensalada de lentejas y adamame"),
];
const match = makeMatcher(LIBRARY);

describe("cleaning a cell", () => {
  it("cuts the notes after a colon", () => {
    expect(cleanCell("Tortilla de patatas con ensalada: 1 Cebolla picada, 6 Patatas")).toBe("Tortilla de patatas con ensalada");
    expect(cleanCell("Risoto:  ")).toBe("Risoto");
  });
  it("cuts a link glued to the name", () => {
    expect(cleanCell("Crema de zanahoriahttps://elpais.com/gastronomia/receta.html")).toBe("Crema de zanahoria");
    expect(cleanCell("Pollo pochado https://elpais.com/x: y")).toBe("Pollo pochado");
  });
  it("tidies spaces", () => {
    expect(cleanCell("  Fish fingers con ensalada de   pepino ")).toBe("Fish fingers con ensalada de pepino");
  });
  it("normalises accents, case and punctuation", () => {
    expect(normalise("Pasta Boloñesa!")).toBe("pasta bolonesa");
    expect(normalise("Puré de 'naranja'")).toBe("pure de naranja");
    expect(normalise("Pisto (variants)")).toBe("pisto");
  });
});

describe("matching a cell to a meal", () => {
  it("is empty when the cell is empty or only a link", () => {
    expect(match("")).toEqual({ kind: "empty", asWritten: null });
    expect(match("https://elpais.com/x")).toEqual({ kind: "empty", asWritten: null });
  });

  it("marks Sobras as leftovers, never a meal", () => {
    expect(match("Sobras")).toEqual({ kind: "leftover", asWritten: "Sobras" });
    expect(match("Sobras: Risoto, sopa de garbanzos")).toEqual({ kind: "leftover", asWritten: "Sobras" });
    expect(match("Pasta (sobras)")).toEqual({ kind: "leftover", asWritten: "Pasta (sobras)" });
    // Even when the library holds a meal called Sobras.
    expect(makeMatcher([meal("s", "Sobras")])("Sobras").kind).toBe("leftover");
  });

  it("marks take-away and eating out", () => {
    expect(match("Take-away")).toEqual({ kind: "takeaway", asWritten: "Take-away" });
    expect(match("Take away (sushi), GF pizza")).toEqual({ kind: "takeaway", asWritten: "Take away (sushi), GF pizza" });
  });

  it("matches exactly on any name, ignoring accents and case", () => {
    expect(match("Fish Pie")).toEqual({ kind: "meal", mealId: "pie", asWritten: "Fish Pie" });
    expect(match("pastel de PESCADO")).toMatchObject({ kind: "meal", mealId: "pie" });
    expect(match("Pasta bolonesa")).toMatchObject({ kind: "meal", mealId: "bolo" });
    expect(match("Bolognesa")).toMatchObject({ kind: "meal", mealId: "bolo" });
    expect(match("Pancakes with salmon")).toMatchObject({ kind: "meal", mealId: "pancakes" });
    expect(match("Tortilla de patatas con ensalada: 1 Cebolla")).toEqual({ kind: "meal", mealId: "tortilla", asWritten: "Tortilla de patatas con ensalada" });
    expect(match("Crema de zanahoriahttps://elpais.com/x")).toEqual({ kind: "meal", mealId: "crema", asWritten: "Crema de zanahoria" });
  });

  it("matches without a bracketed note", () => {
    expect(match("Pisto con arroz")).toMatchObject({ kind: "meal", mealId: "pisto" });
    expect(match("Pizza (Claremont Family Day)")).toMatchObject({ kind: "meal", mealId: "pizza" });
  });

  it("matches small typos when one meal clearly wins", () => {
    expect(match("Tortila de patatas con ensalada")).toMatchObject({ kind: "meal", mealId: "tortilla" });
    expect(match("Pastel de pescao")).toMatchObject({ kind: "meal", mealId: "pie" });
  });

  it("leaves a cell unmatched rather than guess", () => {
    expect(match("Ensalada verde y nachos con guacamole")).toEqual({ kind: "unmatched", asWritten: "Ensalada verde y nachos con guacamole" });
    expect(match("Bainas con patatas")).toEqual({ kind: "unmatched", asWritten: "Bainas con patatas" });
    expect(match("Curry con lentejas")).toMatchObject({ kind: "unmatched" });
    // Close to two meals at once: no clear winner.
    const two = makeMatcher([meal("a", "Tostada con aguacate"), meal("b", "Tostada con aguacates")]);
    expect(two("Tostada con aguacat")).toMatchObject({ kind: "unmatched" });
  });

  it("does not guess when two meals share a name", () => {
    const m = makeMatcher([meal("a", "Pasta", { variants_seen: ["Pasta pesto"] }), meal("b", "Pasta al pesto", { variants_seen: ["Pasta pesto"] })]);
    expect(m("Pasta pesto")).toMatchObject({ kind: "unmatched" });
    expect(m("Pasta")).toMatchObject({ kind: "meal", mealId: "a" });
  });

  it("scores word order as alike", () => {
    expect(similarity("salmon pancakes", "pancakes salmon")).toBe(1);
    expect(similarity("pasta", "pizza")).toBeLessThan(0.86);
  });

  it("keeps the meal the app already has when the cell is a shorter name for it", () => {
    const m = makeMatcher([
      meal("amb", "Amburguesas", { name_en: "Burgers" }),
      meal("kofta", "Lamb kofta burgers", { name_group: "Burgers" }),
      meal("gnoquis", "Ensalada de gnoquis crujientes", { name_es: "Ensalada de ñoquis crujientes" }),
      meal("verde", "Ensalada verde"),
    ]);
    // Two meals are called Burgers: the one already in the slot wins, otherwise no guess.
    expect(m("Burgers", "amb")).toEqual({ kind: "meal", mealId: "amb", asWritten: "Burgers" });
    expect(m("Burgers")).toMatchObject({ kind: "unmatched" });
    expect(m("Ensalada de ñoquis", "gnoquis")).toMatchObject({ kind: "meal", mealId: "gnoquis" });
    expect(m("Ensalada de ñoquis")).toMatchObject({ kind: "unmatched" });
    // A cell with words the app's meal doesn't have stays unmatched.
    expect(m("Ensalada verde y nachos con guacamole", "verde")).toMatchObject({ kind: "unmatched" });
    expect(m("Chicken curry", "amb")).toMatchObject({ kind: "unmatched" });
    // Only little words in common is not enough.
    expect(m("con y de", "gnoquis")).toMatchObject({ kind: "unmatched" });
    // A meal that is not in the list (deleted) is never kept.
    expect(m("Burgers", "deleted")).toMatchObject({ kind: "unmatched" });
  });
});
