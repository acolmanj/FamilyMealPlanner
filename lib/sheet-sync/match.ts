import { isSobras, isTakeaway } from "../planner/not-a-meal";

// Works out which library meal a sheet cell means. Pure. Never adds a meal: a cell that
// matches nothing keeps its text and no meal.

export type LibraryMeal = {
  id: string;
  name: string;
  name_group: string | null;
  name_en: string | null;
  name_es: string | null;
  variants_seen: string[] | null;
};

export type CellMatch =
  | { kind: "empty"; asWritten: null }
  | { kind: "leftover" | "takeaway" | "unmatched"; asWritten: string }
  | { kind: "meal"; mealId: string; asWritten: string };

// What the cell names: cut links glued to the name and notes after a colon.
//   "Tortilla de patatas con ensalada: 1 Cebolla" -> "Tortilla de patatas con ensalada"
//   "Crema de zanahoriahttps://elpais.com/..."     -> "Crema de zanahoria"
export function cleanCell(text: string): string {
  let s = text;
  const link = s.search(/http|www\./i);
  if (link >= 0) s = s.slice(0, link);
  const colon = s.indexOf(":");
  if (colon >= 0) s = s.slice(0, colon);
  return s.replace(/\s+/g, " ").trim();
}

// For comparing names: lower case, no accents, no punctuation, single spaces.
export function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\(variants\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const ratio = (a: string, b: string) => (a.length || b.length ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 1);
const sortTokens = (s: string) => s.split(" ").sort().join(" ");

// 0..1: how alike two normalised names are, ignoring word order. Catches typos
// ("Pasta bolonesa" / "Pasta boloñesa") without letting "Ensalada verde y nachos" pass for "Ensalada verde".
export function similarity(a: string, b: string): number {
  return Math.max(ratio(a, b), ratio(sortTokens(a), sortTokens(b)));
}

export const FUZZY_MIN = 0.86; // a near-certain match only
export const FUZZY_MARGIN = 0.06; // and clearly better than the next meal

// The app's own meal in a slot wins over "unmatched" when every word of the cell is in one of
// that meal's names: the sheet says "Burgers" or "Ensalada de ñoquis" and the app already holds
// "Amburguesas" (also called Burgers) or "Ensalada de gnoquis crujientes". It never picks a
// meal the app did not already have there.
const LITTLE_WORDS = new Set(["de", "del", "con", "y", "e", "a", "al", "la", "el", "los", "las", "en", "and", "with", "the", "of", "in"]);
const words = (key: string) => key.split(" ").filter(Boolean);

export type Matcher = (text: string, appMealId?: string | null) => CellMatch;

export function makeMatcher(meals: LibraryMeal[]): Matcher {
  // Every name a meal goes by, normalised. Main names are tried before old variants.
  const main = new Map<string, Set<string>>();
  const variant = new Map<string, Set<string>>();
  // Names without their bracketed notes: "Pisto con arroz (congelador)" is "Pisto con arroz".
  const bare = new Map<string, Set<string>>();
  const all: { id: string; key: string }[] = [];
  const keysOf = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, id: string) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(id);
    all.push({ id, key });
    if (!keysOf.has(id)) keysOf.set(id, new Set());
    keysOf.get(id)!.add(key);
  };
  const appMealFits = (key: string, id: string) => {
    const cellWords = words(key);
    if (!cellWords.some((w) => !LITTLE_WORDS.has(w))) return false;
    return [...(keysOf.get(id) ?? [])].some((k) => {
      const names = new Set(words(k));
      return cellWords.every((w) => names.has(w));
    });
  };
  for (const m of meals) {
    const names = [m.name, m.name_group, m.name_en, m.name_es].filter((n): n is string => Boolean(n));
    const variants = (m.variants_seen ?? []).map(cleanCell);
    for (const n of names) add(main, normalise(n), m.id);
    for (const v of variants) add(variant, normalise(v), m.id);
    for (const n of [...names, ...variants]) if (/\(.*\)/.test(n)) add(bare, normalise(n.replace(/\([^)]*\)/g, " ")), m.id);
  }

  return (raw: string, appMealId?: string | null) => {
    const asWritten = cleanCell(raw);
    if (!asWritten) return { kind: "empty", asWritten: null };
    // Sobras is never a meal, whatever the library holds.
    if (isSobras(asWritten)) return { kind: "leftover", asWritten };
    if (isTakeaway(asWritten)) return { kind: "takeaway", asWritten };
    const key = normalise(asWritten);
    const unmatched = (): CellMatch =>
      appMealId && appMealFits(key, appMealId) ? { kind: "meal", mealId: appMealId, asWritten } : { kind: "unmatched", asWritten };
    // The whole name first, then without its bracketed note ("Pizza (cumple)" is "Pizza").
    for (const k of new Set([key, normalise(asWritten.replace(/\([^)]*\)/g, " "))])) {
      if (!k) continue;
      for (const map of [main, variant, bare]) {
        const ids = map.get(k);
        if (ids?.size === 1) return { kind: "meal", mealId: [...ids][0], asWritten };
        if (ids && ids.size > 1) return unmatched(); // two meals share the name: don't guess
      }
    }
    // No exact name: the best near match, if one meal clearly wins.
    const best = new Map<string, number>();
    for (const { id, key: k } of all) best.set(id, Math.max(best.get(id) ?? 0, similarity(key, k)));
    const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
    const [first, second] = ranked;
    if (first && first[1] >= FUZZY_MIN && (!second || first[1] - second[1] >= FUZZY_MARGIN))
      return { kind: "meal", mealId: first[0], asWritten };
    return unmatched();
  };
}
