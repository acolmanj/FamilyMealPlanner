import { applyConfirmation, screenMeal } from "@/lib/gluten/gate";
import { getHousehold } from "@/lib/household";
import { mealName } from "@/lib/i18n/messages";
import { getMessages } from "@/lib/i18n/server";
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
};

export default async function MealsPage() {
  const { supabase, household } = await getHousehold();
  if (!household) return null;
  const { lang, t } = await getMessages();
  const { data, error } = await supabase
    .from("meals")
    .select(
      "id, name, name_en, name_es, variants_seen, ingredients_note, protein, starch, is_pasta, is_processed, effort, gf_confirmed_at, image_url, image_source, image_page_url, mealdb_ingredients, recipe_source",
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
      ingredients: splitIngredients(m.ingredients_note),
      recipeIngredients: m.mealdb_ingredients?.length ? m.mealdb_ingredients : null,
      gluten: applyConfirmation(
        screenMeal({ name: m.name, variants: m.variants_seen, ingredients: m.ingredients_note }),
        Boolean(m.gf_confirmed_at),
      ).status,
      image: m.image_url,
      imageSource: m.image_source,
      recipeUrl: m.recipe_source && /^https?:\/\//.test(m.recipe_source) ? m.recipe_source : m.image_page_url,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, lang));

  return <Library meals={meals} />;
}
