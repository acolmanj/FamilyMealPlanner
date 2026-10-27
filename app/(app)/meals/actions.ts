"use server";

import { revalidatePath } from "next/cache";
import { getHousehold } from "@/lib/household";
import { getMessages } from "@/lib/i18n/server";
import { fetchRecipe } from "@/lib/recipes/fetch";
import type { ParsedRecipe } from "@/lib/recipes/parse";

// The meal library: edit a meal's names, group and ingredients, or add a new one.

type Result = { ok: true; id?: string } | { ok: false; error: string };

export type MealEdit = {
  name_en: string;
  name_es: string;
  protein: "meat" | "fish" | "veg";
  ingredients: string[];
};

export type NewMeal = MealEdit & { image: string | null; url: string | null };

const clean = (s: string) => s.trim().replace(/\s+/g, " ").slice(0, 120);
const PROTEINS = ["meat", "fish", "veg"];
// Sobras (leftovers) are not a meal.
const isSobras = (s: string) => /\b(sobras?|leftovers?)\b/i.test(s);

async function context() {
  const { supabase, household } = await getHousehold();
  if (!household) throw new Error("No household");
  const { t } = await getMessages();
  return { supabase, householdId: household.id, t };
}

type Fields = { name_en: string | null; name_es: string | null; protein: string; ingredients_note: string | null };

function fields(e: MealEdit, t: Awaited<ReturnType<typeof context>>["t"]): { error: string } | { values: Fields } {
  const name_en = clean(e.name_en);
  const name_es = clean(e.name_es);
  if (!name_en && !name_es) return { error: t.meals.needName };
  if (isSobras(name_en) || isSobras(name_es)) return { error: t.actions.sobras };
  if (!PROTEINS.includes(e.protein)) return { error: t.actions.pickProtein };
  const lines = e.ingredients.map(clean).filter(Boolean).slice(0, 60);
  return {
    values: { name_en: name_en || null, name_es: name_es || null, protein: e.protein, ingredients_note: lines.length ? lines.join("\n") : null },
  };
}

export async function updateMeal(id: string, edit: MealEdit): Promise<Result> {
  const { supabase, householdId, t } = await context();
  const f = fields(edit, t);
  if ("error" in f) return { ok: false, error: f.error };
  const { error } = await supabase.from("meals").update(f.values).eq("household_id", householdId).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/meals");
  revalidatePath("/week");
  return { ok: true, id };
}

export async function createMeal(meal: NewMeal): Promise<Result> {
  const { supabase, householdId, t } = await context();
  const f = fields(meal, t);
  if ("error" in f) return { ok: false, error: f.error };
  const name = (f.values.name_en ?? f.values.name_es)!;
  const { data: existing } = await supabase
    .from("meals")
    .select("id")
    .eq("household_id", householdId)
    .ilike("name_group", name.replace(/[%_\\]/g, "\\$&"))
    .maybeSingle();
  if (existing) return { ok: false, error: t.meals.exists(name) };

  const url = meal.url && /^https?:\/\//.test(meal.url) ? meal.url : null;
  const image = meal.image && /^https?:\/\//.test(meal.image) ? meal.image : null;
  const { data, error } = await supabase
    .from("meals")
    .insert({
      household_id: householdId,
      name,
      name_group: name,
      variants_seen: [name],
      ...f.values,
      source: url ? "imported" : "menu",
      recipe_source: url,
      // With a photo from the recipe page, keep it; otherwise the planner looks one up.
      ...(image
        ? {
            image_url: image,
            image_source: image.includes("themealdb.com") ? "themealdb" : "web",
            image_page_url: url,
            image_checked_at: new Date().toISOString(),
          }
        : {}),
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/meals");
  revalidatePath("/week");
  return { ok: true, id: data.id };
}

export async function importRecipe(url: string): Promise<{ ok: true; recipe: ParsedRecipe; url: string } | { ok: false; error: string }> {
  const { t } = await context();
  const r = await fetchRecipe(url);
  if (r.ok) return r;
  return { ok: false, error: r.reason === "bad-url" ? t.meals.badUrl : r.reason === "no-recipe" ? t.meals.noRecipe : t.meals.unreachable };
}
