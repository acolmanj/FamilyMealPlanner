import { localiseFinding } from "@/lib/gluten/es";
import { mealStatus, screenMeal } from "@/lib/gluten/gate";
import { needsGfStock, outsideNoPlan } from "@/lib/gluten/outside";
import { getHousehold } from "@/lib/household";
import { mealName, type Lang } from "@/lib/i18n/messages";
import { cellDate, type Day, type PlanMeal, type Slot, type Use } from "@/lib/planner/rules";
import { isSlotPref } from "@/lib/planner/slot-pref";
import { mealTags, type Tags } from "@/lib/planner/tags";
import { defaultWeek, mondayOf } from "@/lib/planner/week";
import type { Status } from "@/lib/gluten/gate";

export type MealImage = { url: string; source: string | null; page: string | null };
// A recipe idea from TheMealDB, with what the gluten gate finds in its ingredient list as written.
export type RecipeIdea = { name: string; url: string; gluten: { term: string; swap?: string }[] };
// gfStock: an El País recipe that uses stock, so the stock must be a gluten-free one.
export type BoardMeal = PlanMeal & { tags: Tags; gluten: Status; image: MealImage | null; recipe: RecipeIdea | null; gfStock?: boolean };
export type BoardCell = { day: Day; slot: Slot; mealId: string | null; text: string | null; leftover: boolean; why: string | null };

type MealRow = {
  id: string;
  name: string;
  name_en: string | null;
  name_es: string | null;
  variants_seen: string[];
  ingredients_note: string | null;
  protein: string | null;
  starch: string | null;
  is_pasta: boolean | null;
  is_processed: boolean | null;
  effort: string | null;
  pinned: boolean;
  is_favourite: boolean;
  slot_preference: string | null;
  weekend_only: boolean | null;
  source: string | null;
  gf_confirmed_at: string | null;
  image_url: string | null;
  image_source: string | null;
  image_page_url: string | null;
  mealdb_name: string | null;
  mealdb_ingredients: string[] | null;
};

type SlotRow = {
  week_start: string;
  day: Day;
  slot: string;
  meal_id: string | null;
  as_written: string | null;
  status: string;
  is_leftover: boolean;
  why_line: string | null;
};

export function weekFromParam(w?: string) {
  return w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? mondayOf(new Date(`${w}T00:00:00Z`)) : defaultWeek();
}

export { formatDate as formatDay } from "@/lib/i18n/messages";

function recipeIdea(m: MealRow, lang: Lang): RecipeIdea | null {
  if (!m.mealdb_name || !m.image_page_url?.includes("themealdb.com")) return null;
  const verdict = screenMeal({ name: m.mealdb_name, ingredients: (m.mealdb_ingredients ?? []).join(" · ") });
  const gluten = verdict.findings    .filter((f) => f.rule !== "unknown" && f.status !== "safe")
    .map((f) => localiseFinding(f, lang))
    .map((f) => ({ term: f.term, swap: f.swap }));
  return { name: m.mealdb_name, url: m.image_page_url, gluten };
}

// Everything the planner needs for one week: the meal library (with gluten status and tags),
// the week's cells, and every other week's plan for recency and "new meal".
export async function loadWeek(week: string, lang: Lang = "en") {
  const data = await loadWeeks([week], lang);
  if (!data) return null;
  if ("error" in data) return { error: data.error } as const;
  return { meals: data.meals, cells: data.cells[week], history: data.history } as const;
}

// The same for several weeks at once: each week's cells, and the history of every other week.
export async function loadWeeks(weeks: string[], lang: Lang = "en") {
  const { supabase, household } = await getHousehold();
  if (!household) return null;
  const [{ data: meals, error }, { data: slots }] = await Promise.all([
    supabase
      .from("meals")
      .select(
        "id, name, name_en, name_es, variants_seen, ingredients_note, protein, starch, is_pasta, is_processed, effort, pinned, is_favourite, slot_preference, weekend_only, source, gf_confirmed_at, image_url, image_source, image_page_url, mealdb_name, mealdb_ingredients",
      )
      .eq("retired", false)
      .eq("blacklisted", false)
      .order("name")
      .returns<MealRow[]>(),
    supabase.from("plan_slots").select("week_start, day, slot, meal_id, as_written, status, is_leftover, why_line").returns<SlotRow[]>(),
  ]);
  if (error) return { error: error.message } as const;

  const boardMeals: BoardMeal[] = (meals ?? []).map((m) => ({
    id: m.id,
    name: mealName(m, lang),
    pinned: m.pinned,
    favourite: m.is_favourite,
    slotPref: isSlotPref(m.slot_preference) ? m.slot_preference : "either",
    weekendOnly: Boolean(m.weekend_only),
    idea: m.source === "elpais" && !m.gf_confirmed_at,
    noPlan: outsideNoPlan(m),
    gfStock: m.source === "elpais" && needsGfStock(m.name_es ?? m.name, m.ingredients_note),
    tags: mealTags(m),
    gluten: mealStatus(m),
    image: m.image_url ? { url: m.image_url, source: m.image_source, page: m.image_page_url } : null,
    recipe: recipeIdea(m, lang),
  }));

  // Lunch and dinner only: Sobras (leftovers) are not a meal.
  const cellsOf = (week: string): BoardCell[] => (slots ?? [])
    .filter((s) => s.week_start === week && (s.slot === "lunch" || s.slot === "dinner") && (s.meal_id || s.as_written))
    .map((s) => ({
      day: s.day,
      slot: s.slot as Slot,
      mealId: s.meal_id,
      text: s.as_written ? s.as_written.split(/:\s|: ?https?:/)[0].trim() : null,
      leftover: s.is_leftover,
      why: s.why_line,
    }));
  const cells: Record<string, BoardCell[]> = Object.fromEntries(weeks.map((w) => [w, cellsOf(w)]));

  const history: Use[] = (slots ?? [])
    .filter((s) => !weeks.includes(s.week_start) && s.meal_id)
    .map((s) => ({ mealId: s.meal_id!, date: cellDate(s.week_start, s.day) }));

  return { meals: boardMeals, cells, history } as const;
}
