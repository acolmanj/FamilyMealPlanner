import { applyConfirmation, screenMeal } from "@/lib/gluten/gate";
import { getHousehold } from "@/lib/household";
import { addDays, cellDate, type Day, type Slot, type Use } from "@/lib/planner/rules";
import { mealTags, type Tags } from "@/lib/planner/tags";
import type { Status } from "@/lib/gluten/gate";

export type MealImage = { url: string; source: string | null; page: string | null };
// A recipe idea from TheMealDB, with what the gluten gate finds in its ingredient list as written.
export type RecipeIdea = { name: string; url: string; gluten: { term: string; swap?: string }[] };
export type BoardMeal = { id: string; name: string; pinned: boolean; tags: Tags; gluten: Status; image: MealImage | null; recipe: RecipeIdea | null };
export type BoardCell = { day: Day; slot: Slot; mealId: string | null; text: string | null; locked: boolean; leftover: boolean };

type MealRow = {
  id: string;
  name: string;
  variants_seen: string[];
  ingredients_note: string | null;
  protein: string | null;
  starch: string | null;
  is_pasta: boolean | null;
  is_processed: boolean | null;
  effort: string | null;
  pinned: boolean;
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
};

export function mondayOf(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

// The week being planned: this week, or next week from Saturday on.
export function defaultWeek(now = new Date()) {
  const monday = mondayOf(now);
  return now.getUTCDay() === 6 || now.getUTCDay() === 0 ? addDays(monday, 7) : monday;
}

export function weekFromParam(w?: string) {
  return w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? mondayOf(new Date(`${w}T00:00:00Z`)) : defaultWeek();
}

export function formatDay(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "UTC" });
}

function recipeIdea(m: MealRow): RecipeIdea | null {
  if (!m.mealdb_name || !m.image_page_url?.includes("themealdb.com")) return null;
  const verdict = screenMeal({ name: m.mealdb_name, ingredients: (m.mealdb_ingredients ?? []).join(" · ") });
  const gluten = verdict.findings.filter((f) => f.rule !== "unknown" && f.status !== "safe").map((f) => ({ term: f.term, swap: f.swap }));
  return { name: m.mealdb_name, url: m.image_page_url, gluten };
}

// Everything the planner needs for one week: the meal library (with gluten status and tags),
// the week's cells, and every other week's plan for recency and "new meal".
export async function loadWeek(week: string) {
  const { supabase, household } = await getHousehold();
  if (!household) return null;
  const [{ data: meals, error }, { data: slots }] = await Promise.all([
    supabase
      .from("meals")
      .select("id, name, variants_seen, ingredients_note, protein, starch, is_pasta, is_processed, effort, pinned, gf_confirmed_at, image_url, image_source, image_page_url, mealdb_name, mealdb_ingredients")
      .eq("retired", false)
      .eq("blacklisted", false)
      .order("name")
      .returns<MealRow[]>(),
    supabase.from("plan_slots").select("week_start, day, slot, meal_id, as_written, status, is_leftover").returns<SlotRow[]>(),
  ]);
  if (error) return { error: error.message } as const;

  const boardMeals: BoardMeal[] = (meals ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    pinned: m.pinned,
    tags: mealTags(m),
    gluten: applyConfirmation(
      screenMeal({ name: m.name, variants: m.variants_seen, ingredients: m.ingredients_note }),
      Boolean(m.gf_confirmed_at),
    ).status,
    image: m.image_url ? { url: m.image_url, source: m.image_source, page: m.image_page_url } : null,
    recipe: recipeIdea(m),
  }));

  // Lunch and dinner only: Sobras (leftovers) are not a meal.
  const cells: BoardCell[] = (slots ?? [])
    .filter((s) => s.week_start === week && (s.slot === "lunch" || s.slot === "dinner") && (s.meal_id || s.as_written))
    .map((s) => ({
      day: s.day,
      slot: s.slot as Slot,
      mealId: s.meal_id,
      text: s.as_written ? s.as_written.split(/:\s|: ?https?:/)[0].trim() : null,
      locked: s.status === "locked",
      leftover: s.is_leftover,
    }));

  const history: Use[] = (slots ?? [])
    .filter((s) => s.week_start !== week && s.meal_id)
    .map((s) => ({ mealId: s.meal_id!, date: cellDate(s.week_start, s.day) }));

  return { meals: boardMeals, cells, history } as const;
}
