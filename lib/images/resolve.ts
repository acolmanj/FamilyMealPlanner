import { normalise } from "../gluten/gate";

// Finds a small photo and a recipe idea for a meal. TheMealDB first (free test key "1"),
// then Wikipedia, keeping only images hosted on Wikimedia Commons, which are free to reuse.
// Recipes found here are ideas only: the gluten gate still decides, never the recipe.

export type ImageMeal = { id: string; name: string; image_query: string | null; image_url: string | null; mealdb_id: string | null };

export type ImageFacts = {
  image_url: string | null;
  image_source: "themealdb" | "wikimedia" | null;
  image_page_url: string | null;
  mealdb_id: string | null;
  mealdb_name: string | null;
  mealdb_ingredients: string[] | null;
};

export type FetchJson = (url: string) => Promise<unknown>;

const MEALDB = "https://www.themealdb.com/api/json/v1/1";

type MealDbMeal = { idMeal: string; strMeal: string; strMealThumb: string | null } & Record<string, string | null>;

export const mealDbImage = (thumb: string) => `${thumb}/small`;
export const mealDbPage = (id: string) => `https://www.themealdb.com/meal/${id}`;

function ingredients(m: MealDbMeal) {
  const out: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const name = m[`strIngredient${i}`]?.trim();
    if (!name) continue;
    const measure = m[`strMeasure${i}`]?.trim();
    out.push(measure ? `${measure} ${name}` : name);
  }
  return out;
}

function fromMealDb(m: MealDbMeal): ImageFacts {
  return {
    image_url: m.strMealThumb ? mealDbImage(m.strMealThumb) : null,
    image_source: m.strMealThumb ? "themealdb" : null,
    image_page_url: mealDbPage(m.idMeal),
    mealdb_id: m.idMeal,
    mealdb_name: m.strMeal,
    mealdb_ingredients: ingredients(m),
  };
}

async function mealDbMeals(fetchJson: FetchJson, url: string): Promise<MealDbMeal[]> {
  const data = (await fetchJson(url).catch(() => null)) as { meals?: MealDbMeal[] | null } | null;
  return Array.isArray(data?.meals) ? data.meals : [];
}

async function wikiImage(fetchJson: FetchJson, lang: string, title: string): Promise<Pick<ImageFacts, "image_url" | "image_source" | "image_page_url"> | null> {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  const data = (await fetchJson(url).catch(() => null)) as {
    type?: string;
    thumbnail?: { source?: string };
    content_urls?: { desktop?: { page?: string } };
  } | null;
  const src = data?.thumbnail?.source;
  // Only Commons images are freely licensed; Wikipedia's own uploads may be fair-use.
  if (!src || data?.type === "disambiguation" || !src.includes("/wikipedia/commons/")) return null;
  return { image_url: src, image_source: "wikimedia", image_page_url: data?.content_urls?.desktop?.page ?? null };
}

// Spanish words in the household's meal names, in the English TheMealDB uses.
const WORDS: Record<string, string> = {
  pollo: "chicken", cordero: "lamb", cerdo: "pork", ternera: "beef", vaca: "beef", carne: "beef", pavo: "turkey",
  salmon: "salmon", atun: "tuna", bacalao: "cod", merluza: "hake", gambas: "prawn", langostinos: "prawn", pescado: "fish",
  cangrejo: "crab", caballa: "mackerel", sardinas: "sardines", lentejas: "lentil", alubias: "beans", garbanzos: "chickpea",
  arroz: "rice", patatas: "potato", boniato: "sweet potato", calabaza: "pumpkin", berenjena: "aubergine", espinacas: "spinach",
  setas: "mushroom", champinones: "mushroom", huevos: "egg", tortilla: "tortilla", ensalada: "salad", sopa: "soup",
  crema: "soup", estofado: "stew", guiso: "stew", asado: "roast", albondigas: "meatballs", hamburguesas: "burger",
  amburguesas: "burger", curry: "curry", pasta: "pasta", espaguetis: "spaghetti", macarrones: "macaroni", lasana: "lasagne",
  pizza: "pizza", tacos: "tacos", fajitas: "fajitas", chili: "chili", risotto: "risotto", risoto: "risotto", paella: "paella",
  ramen: "ramen", fideos: "noodles", quiche: "quiche", pastel: "pie", tarta: "tart",
};
const STOP = new Set(["con", "de", "del", "la", "el", "los", "las", "al", "a", "y", "en", "with", "and", "the", "of", "variants"]);

// The words worth searching for, English first, most specific (the dish) before the protein.
export function searchTerms(name: string): string[] {
  const words = normalise(name.replace(/\(.*?\)/g, " "))
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  const english = words.map((w) => WORDS[w] ?? w);
  const known = words.filter((w) => WORDS[w]).map((w) => WORDS[w]);
  return [...new Set([english.join(" "), ...known.reverse(), ...english])].filter(Boolean);
}

function bestMatch(meals: MealDbMeal[], terms: string[]) {
  const score = (m: MealDbMeal) => terms.filter((t) => normalise(m.strMeal).includes(t)).length;
  return [...meals].sort((a, b) => score(b) - score(a))[0];
}

export async function resolveImage(meal: ImageMeal, fetchJson: FetchJson): Promise<ImageFacts | null> {
  const q = meal.image_query ?? "";
  const id = meal.mealdb_id ?? (q.startsWith("mealdb:") ? q.slice(7) : null);
  if (id) {
    const [m] = await mealDbMeals(fetchJson, `${MEALDB}/lookup.php?i=${encodeURIComponent(id)}`);
    if (m) return fromMealDb(m);
  }
  const wiki = q.match(/^wiki:([a-z]{2}):(.+)$/);
  if (wiki) {
    const found = await wikiImage(fetchJson, wiki[1], wiki[2]);
    if (found) return { ...found, mealdb_id: null, mealdb_name: null, mealdb_ingredients: null };
  }
  if (q && !wiki && !id) return null;

  // A meal with no mapping yet: search TheMealDB by name, then Wikipedia.
  const terms = searchTerms(meal.name);
  for (const term of terms.slice(0, 4)) {
    const meals = await mealDbMeals(fetchJson, `${MEALDB}/search.php?s=${encodeURIComponent(term)}`);
    if (meals.length) return fromMealDb(bestMatch(meals, terms));
  }
  const title = meal.name.replace(/\(.*?\)/g, "").trim();
  const found = (await wikiImage(fetchJson, "es", title)) ?? (terms[0] ? await wikiImage(fetchJson, "en", terms[0]) : null);
  return found ? { ...found, mealdb_id: null, mealdb_name: null, mealdb_ingredients: null } : null;
}
