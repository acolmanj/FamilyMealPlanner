import { mealStatus } from "@/lib/gluten/gate";
import { outsideNoPlan } from "@/lib/gluten/outside";
import { getHousehold } from "@/lib/household";
import { mealName } from "@/lib/i18n/messages";
import { getMessages } from "@/lib/i18n/server";
import { isSlotPref } from "@/lib/planner/slot-pref";
import { mealTags } from "@/lib/planner/tags";
import { splitIngredients } from "@/lib/recipes/parse";
import { Library, type LibraryMeal } from "./library";

type Row = {
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
  gf_confirmed_at: string | null;
  image_url: string | null;
  image_source: string | null;
  image_page_url: string | null;
  mealdb_ingredients: string[] | null;
  recipe_source: string | null;
  is_favourite: boolean;
  slot_preference: string | null;
  source: string | null;
  source_url: string | null;
};

export default async function MealsPage() {
  const { supabase, household } = await getHousehold();
  if (!household) return null;
  const { lang, t } = await getMessages();
  const { data, error } = await supabase
    .from("meals")
    .select(
      "id, name, name_en, name_es, variants_seen, ingredients_note, protein, starch, is_pasta, is_processed, effort, gf_confirmed_at, image_url, image_source, image_page_url, mealdb_ingredients, recipe_source, is_favourite, slot_preference, source, source_url",
    )
    .eq("retired", false)
    .eq("blacklisted", false)
    .returns<Row[]>();
  if (error) return <p className="text-destructive">{t.gluten.couldNotLoad(error.message)}</p>;

  const meals: LibraryMeal[] = (data ?? [])
    // Sobras (leftovers) are not a meal.
    .filter((m) => !/\b(sobras?|leftovers?)\b/i.test(m.name))
    .map((m) => ({ m, tags: mealTags(m) }))
    .map(({ m, tags }) => ({
      id: m.id,
      name: mealName(m, lang),
      // A meal added before it had translations shows how it was typed, to correct.
      name_en: m.name_en ?? (m.name_es ? "" : m.name),
      name_es: m.name_es ?? "",
      protein: tags.protein,
      starch: tags.isPasta ? "pasta" : tags.starch,
      isPulse: tags.isPulse,
      hasRice: tags.hasRice,
      ingredients: splitIngredients(m.ingredients_note),
      recipeIngredients: m.mealdb_ingredients?.length ? m.mealdb_ingredients : null,
      gluten: mealStatus(m),
      favourite: m.is_favourite,
      slotPref: isSlotPref(m.slot_preference) ? m.slot_preference : "either",
      fromElPais: m.source === "elpais",
      newIdea: m.source === "elpais" && !m.gf_confirmed_at,
      noPlan: outsideNoPlan(m),
      image: m.image_url,
      imageSource: m.image_source,
      recipeUrl: m.source_url ?? (m.recipe_source && /^https?:\/\//.test(m.recipe_source) ? m.recipe_source : m.image_page_url),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, lang));

  return <Library meals={meals} />;
}
