"use server";

import { revalidatePath } from "next/cache";
import { getHousehold } from "@/lib/household";
import { getMessages } from "@/lib/i18n/server";
import { fetchRecipe } from "@/lib/recipes/fetch";
import { isSobras, isTakeaway } from "@/lib/planner/not-a-meal";
import { DAYS, cellDate, type Day } from "@/lib/planner/rules";
import { isSlotPref, type SlotPref } from "@/lib/planner/slot-pref";
import { dublinToday, mondayOf } from "@/lib/planner/week";
import type { ParsedRecipe } from "@/lib/recipes/parse";

// The meal library: edit a meal's names, group and ingredients, or add a new one.

type Result = { ok: true; id?: string } | { ok: false; error: string };

export type MealEdit = {
  name_en: string;
  name_es: string;
  protein: "meat" | "fish" | "veg";
  slot_preference: SlotPref;
  // Weekends only: the planner puts it only on Saturday or Sunday.
  weekend_only: boolean;
  // "We cook this gluten-free": the household's own word, which makes the meal Safe.
  gf_confirmed: boolean;
  ingredients: string[];
};

export type NewMeal = MealEdit & { image: string | null; url: string | null };

const clean = (s: string) => s.trim().replace(/\s+/g, " ").slice(0, 120);
const PROTEINS = ["meat", "fish", "veg"];

async function context() {
  const { supabase, household, user } = await getHousehold();
  if (!household) throw new Error("No household");
  const { t } = await getMessages();
  return { supabase, householdId: household.id, t, who: user.email ?? "household" };
}

const confirmedBy = (who: string) => ({ gf_confirmed_at: new Date().toISOString(), gf_confirmed_by: who });
const notConfirmed = { gf_confirmed_at: null, gf_confirmed_by: null };

type Fields = {
  name_en: string | null;
  name_es: string | null;
  protein: string;
  slot_preference: SlotPref;
  weekend_only: boolean;
  ingredients_note: string | null;
};

function fields(e: MealEdit, t: Awaited<ReturnType<typeof context>>["t"]): { error: string } | { values: Fields } {
  const name_en = clean(e.name_en);
  const name_es = clean(e.name_es);
  if (!name_en && !name_es) return { error: t.meals.needName };
  // Sobras (leftovers), take-away and eating out are not meals.
  if (isSobras(name_en) || isSobras(name_es)) return { error: t.actions.sobras };
  if (isTakeaway(name_en) || isTakeaway(name_es)) return { error: t.actions.takeaway };
  if (!PROTEINS.includes(e.protein)) return { error: t.actions.pickProtein };
  const lines = e.ingredients.map(clean).filter(Boolean).slice(0, 60);
  return {
    values: {
      name_en: name_en || null,
      name_es: name_es || null,
      protein: e.protein,
      slot_preference: isSlotPref(e.slot_preference) ? e.slot_preference : "either",
      weekend_only: e.weekend_only === true,
      ingredients_note: lines.length ? lines.join("\n") : null,
    },
  };
}

function refresh() {
  revalidatePath("/meals");
  revalidatePath("/week");
  revalidatePath("/gluten");
}

export async function updateMeal(id: string, edit: MealEdit): Promise<Result> {
  const { supabase, householdId, t, who } = await context();
  const f = fields(edit, t);
  if ("error" in f) return { ok: false, error: f.error };
  // Only touch the gluten confirmation when the box changed, so the first date it was confirmed is kept.
  const { data: now } = await supabase.from("meals").select("gf_confirmed_at").eq("household_id", householdId).eq("id", id).maybeSingle();
  if (!now) return { ok: false, error: t.actions.mealNotFound };
  const wants = edit.gf_confirmed === true;
  const gf = wants === Boolean(now.gf_confirmed_at) ? {} : wants ? confirmedBy(who) : notConfirmed;
  const { error } = await supabase.from("meals").update({ ...f.values, ...gf }).eq("household_id", householdId).eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id };
}

// What an emptied slot held, so deleting a meal can be undone.
export type EmptiedSlot = { id: string; as_written: string | null; status: string; why_line: string | null; changed_by_user: boolean };

type DeleteResult = { ok: true; emptied: EmptiedSlot[] } | { ok: false; error: string };

// Delete a meal: it leaves the meal list and the planner (the row is kept, marked retired,
// so weeks already eaten still show it in the history). Slots from today on that hold it are emptied.
export async function deleteMeal(id: string): Promise<DeleteResult> {
  const { supabase, householdId, t } = await context();
  const { data: meal } = await supabase.from("meals").select("id").eq("household_id", householdId).eq("id", id).maybeSingle();
  if (!meal) return { ok: false, error: t.actions.mealNotFound };

  const today = dublinToday();
  const { data: slots } = await supabase
    .from("plan_slots")
    .select("id, week_start, day, as_written, status, why_line, changed_by_user")
    .eq("household_id", householdId)
    .eq("meal_id", id)
    .neq("status", "eaten")
    .gte("week_start", mondayOf(new Date(`${today}T00:00:00Z`)))
    .returns<(EmptiedSlot & { week_start: string; day: string })[]>();
  const ahead = (slots ?? []).filter((s) => DAYS.includes(s.day as Day) && cellDate(s.week_start, s.day as Day) >= today);

  const { error } = await supabase.from("meals").update({ retired: true }).eq("household_id", householdId).eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (ahead.length) {
    const { error: slotError } = await supabase
      .from("plan_slots")
      .update({ meal_id: null, as_written: null, why_line: null })
      .eq("household_id", householdId)
      .in("id", ahead.map((s) => s.id));
    if (slotError) {
      // Leave nothing half done: the meal stays in the list.
      await supabase.from("meals").update({ retired: false }).eq("household_id", householdId).eq("id", id);
      return { ok: false, error: slotError.message };
    }
  }
  refresh();
  return {
    ok: true,
    emptied: ahead.map((s) => ({ id: s.id, as_written: s.as_written, status: s.status, why_line: s.why_line, changed_by_user: s.changed_by_user })),
  };
}

// Undo a delete: the meal comes back, and so does each slot it was taken from, if that slot is still empty.
export async function restoreMeal(id: string, emptied: EmptiedSlot[]): Promise<Result> {
  const { supabase, householdId } = await context();
  const { error } = await supabase.from("meals").update({ retired: false }).eq("household_id", householdId).eq("id", id);
  if (error) return { ok: false, error: error.message };
  const str = (x: unknown) => (typeof x === "string" ? x.slice(0, 2000) : null);
  for (const s of (Array.isArray(emptied) ? emptied : []).slice(0, 60)) {
    if (typeof s?.id !== "string") continue;
    await supabase
      .from("plan_slots")
      .update({
        meal_id: id,
        as_written: str(s.as_written),
        status: s.status === "locked" ? "locked" : "proposed",
        why_line: str(s.why_line),
        changed_by_user: s.changed_by_user === true,
      })
      .eq("household_id", householdId)
      .eq("id", s.id)
      .is("meal_id", null)
      .is("as_written", null);
  }
  refresh();
  return { ok: true, id };
}

export async function createMeal(meal: NewMeal): Promise<Result> {
  const { supabase, householdId, t, who } = await context();
  const f = fields(meal, t);
  if ("error" in f) return { ok: false, error: f.error };
  const name = (f.values.name_en ?? f.values.name_es)!;
  const { data: existing } = await supabase
    .from("meals")
    .select("id, retired")
    .eq("household_id", householdId)
    .ilike("name_group", name.replace(/[%_\\]/g, "\\$&"))
    .maybeSingle();
  if (existing && !existing.retired) return { ok: false, error: t.meals.exists(name) };
  const gf = meal.gf_confirmed === true ? confirmedBy(who) : notConfirmed;
  // A meal deleted earlier under the same name comes back, with what was just typed.
  if (existing) {
    const { error } = await supabase
      .from("meals")
      .update({ ...f.values, ...gf, retired: false })
      .eq("household_id", householdId)
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    refresh();
    return { ok: true, id: existing.id };
  }

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
      ...gf,
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
  refresh();
  return { ok: true, id: data.id };
}

export async function importRecipe(url: string): Promise<{ ok: true; recipe: ParsedRecipe; url: string } | { ok: false; error: string }> {
  const { t } = await context();
  const r = await fetchRecipe(url);
  if (r.ok) return r;
  return { ok: false, error: r.reason === "bad-url" ? t.meals.badUrl : r.reason === "no-recipe" ? t.meals.noRecipe : t.meals.unreachable };
}
