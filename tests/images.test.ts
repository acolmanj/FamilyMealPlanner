import { describe, expect, it } from "vitest";
import { resolveImage, searchTerms, type FetchJson, type ImageMeal } from "../lib/images/resolve";

const carbonara = {
  idMeal: "52982",
  strMeal: "Spaghetti alla Carbonara",
  strMealThumb: "https://www.themealdb.com/images/media/meals/llcbn01574260722.jpg",
  strIngredient1: "Spaghetti",
  strMeasure1: "320g",
  strIngredient2: "Egg Yolks",
  strMeasure2: "6",
  strIngredient3: "",
  strMeasure3: " ",
};

function fake(routes: Record<string, unknown>): { fetchJson: FetchJson; asked: string[] } {
  const asked: string[] = [];
  const fetchJson: FetchJson = async (url) => {
    asked.push(url);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    return hit ? hit[1] : null;
  };
  return { fetchJson, asked };
}

const meal = (m: Partial<ImageMeal>): ImageMeal => ({ id: "m1", name: "x", image_query: null, image_url: null, mealdb_id: null, ...m });

describe("meal images", () => {
  it("looks up a mapped TheMealDB meal and keeps the small photo, recipe link and ingredients", async () => {
    const { fetchJson } = fake({ "lookup.php?i=52982": { meals: [carbonara] } });
    const r = await resolveImage(meal({ name: "Carbonara", image_query: "mealdb:52982" }), fetchJson);
    expect(r).toMatchObject({
      image_url: "https://www.themealdb.com/images/media/meals/llcbn01574260722.jpg/small",
      image_source: "themealdb",
      image_page_url: "https://www.themealdb.com/meal/52982",
      mealdb_name: "Spaghetti alla Carbonara",
      mealdb_ingredients: ["320g Spaghetti", "6 Egg Yolks"],
    });
  });

  it("uses a Wikipedia photo only when it is on Wikimedia Commons", async () => {
    const commons = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Fajitas.jpg/320px-Fajitas.jpg";
    const ok = fake({ "en.wikipedia.org/api/rest_v1/page/summary/Fajita": { type: "standard", thumbnail: { source: commons } } });
    expect(await resolveImage(meal({ name: "Fajitas de Pollo", image_query: "wiki:en:Fajita" }), ok.fetchJson)).toMatchObject({
      image_url: commons,
      image_source: "wikimedia",
      mealdb_name: null,
    });

    const fairUse = fake({
      "summary/Fish_finger": { type: "standard", thumbnail: { source: "https://upload.wikimedia.org/wikipedia/en/1/12/Box.jpg" } },
    });
    const r = await resolveImage(meal({ name: "Fish fingers", image_query: "wiki:en:Fish_finger" }), fairUse.fetchJson);
    expect(r).toBeNull();
  });

  it("searches TheMealDB in English for a new Spanish meal name", async () => {
    expect(searchTerms("Pollo al curry (variants)")).toEqual(["chicken curry", "curry", "chicken"]);
    const { fetchJson, asked } = fake({
      "search.php?s=chicken%20curry": {
        meals: [
          { ...carbonara, idMeal: "1", strMeal: "Chicken Congee" },
          { ...carbonara, idMeal: "2", strMeal: "Chicken Curry" },
        ],
      },
    });
    const r = await resolveImage(meal({ name: "Pollo al curry" }), fetchJson);
    expect(asked[0]).toContain("search.php?s=chicken%20curry");
    expect(r?.mealdb_id).toBe("2");
  });

  it("gives up quietly when nothing is found", async () => {
    const { fetchJson } = fake({});
    expect(await resolveImage(meal({ name: "Cena rara" }), fetchJson)).toBeNull();
  });
});
