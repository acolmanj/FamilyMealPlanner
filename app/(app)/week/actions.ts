"use server";

import { revalidatePath } from "next/cache";
import { applyConfirmation, screenMeal } from "@/lib/gluten/gate";
import { getHousehold } from "@/lib/household";
import { DAYS, SLOTS, type Day, type Slot } from "@/lib/planner/rules";

// Every correction on the grid. Anything the owner touches becomes locked, and
// each action is logged in adjustments so the learning phase can count them.

type Result = { ok: true; adjustmentId?: string } | { ok: false; error: string };

const isWeek = (w: string) => /^\d{4}-\d{2}-\d{2}$/.test(w) && new Date(`${w}T00:00:00Z`).getUTCDay() === 1;
const isCell = (d: string, s: string) => DAYS.includes(d as Day) && SLOTS.includes(s as Slot);

async function context() {
  const { supabase, household } = await getHousehold();
  if (!household) throw new Error("No household");
  return { supabase, householdId: household.id };
}

type Ctx = Awaited<ReturnType<typeof context>>;

async function log(
  { supabase, householdId }: Ctx,
  row: { slot_id: string | null; action: string; from_meal?: string | null; to_meal?: string | null },
) {
  const { data } = await supabase
    .from("adjustments")
    .insert({ household_id: householdId, ...row })
    .select("id")
    .single();
  return data?.id as string | undefined;
}

async function getSlot({ supabase, householdId }: Ctx, week: string, day: string, slot: string) {
  const { data } = await supabase
    .from("plan_slots")
    .select("id, meal_id, as_written, is_takeaway")
    .eq("household_id", householdId)
    .eq("week_start", week)
    .eq("day", day)
    .eq("slot", slot)
    .maybeSingle();
  return data as { id: string; meal_id: string | null; as_written: string | null; is_takeaway: boolean } | null;
}

async function writeSlot(
  { supabase, householdId }: Ctx,
  week: string,
  day: string,
  slot: string,
  values: { meal_id: string | null; as_written: string | null; is_takeaway?: boolean; status: string },
) {
  const { data, error } = await supabase
    .from("plan_slots")
    .upsert(
      { household_id: householdId, week_start: week, day, slot, changed_by_user: true, is_takeaway: false, ...values },
      { onConflict: "household_id,week_start,day,slot" },
    )
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

// Put a meal in a cell (fill or swap). Refused only when the meal is blocked for gluten.
export async function setCellMeal(week: string, day: string, slot: string, mealId: string): Promise<Result> {
  if (!isWeek(week) || !isCell(day, slot)) return { ok: false, error: "Unknown cell" };
  const ctx = await context();
  const { data: meal } = await ctx.supabase
    .from("meals")
    .select("id, name, variants_seen, ingredients_note, gf_confirmed_at")
    .eq("household_id", ctx.householdId)
    .eq("id", mealId)
    .maybeSingle();
  if (!meal) return { ok: false, error: "Meal not found" };
  const verdict = applyConfirmation(
    screenMeal({ name: meal.name, variants: meal.variants_seen, ingredients: meal.ingredients_note }),
    Boolean(meal.gf_confirmed_at),
  );
  if (verdict.status === "blocked")
    return { ok: false, error: `${meal.name} is blocked for gluten. Mark it as cooked gluten-free on the Gluten page first.` };

  const before = await getSlot(ctx, week, day, slot);
  const slotId = await writeSlot(ctx, week, day, slot, { meal_id: meal.id, as_written: meal.name, status: "locked" });
  const adjustmentId = await log(ctx, {
    slot_id: slotId,
    action: before?.meal_id ? "swap" : "add",
    from_meal: before?.meal_id ?? null,
    to_meal: meal.id,
  });
  revalidatePath("/week");
  return { ok: true, adjustmentId };
}

// Move a cell's meal to another cell. If that cell has a meal, the two trade places.
export async function moveCell(week: string, from: { day: string; slot: string }, to: { day: string; slot: string }): Promise<Result> {
  if (!isWeek(week) || !isCell(from.day, from.slot) || !isCell(to.day, to.slot)) return { ok: false, error: "Unknown cell" };
  const ctx = await context();
  const a = await getSlot(ctx, week, from.day, from.slot);
  const b = await getSlot(ctx, week, to.day, to.slot);
  if (!a?.meal_id && !a?.as_written) return { ok: false, error: "Nothing to move" };
  const empty = { meal_id: null, as_written: null, is_takeaway: false, status: "proposed" };
  await writeSlot(ctx, week, to.day, to.slot, { meal_id: a.meal_id, as_written: a.as_written, is_takeaway: a.is_takeaway, status: "locked" });
  await writeSlot(
    ctx,
    week,
    from.day,
    from.slot,
    b && (b.meal_id || b.as_written)
      ? { meal_id: b.meal_id, as_written: b.as_written, is_takeaway: b.is_takeaway, status: "locked" }
      : empty,
  );
  const adjustmentId = await log(ctx, { slot_id: a.id, action: "move", from_meal: a.meal_id, to_meal: b?.meal_id ?? null });
  revalidatePath("/week");
  return { ok: true, adjustmentId };
}

export async function setLocked(week: string, day: string, slot: string, locked: boolean): Promise<Result> {
  if (!isWeek(week) || !isCell(day, slot)) return { ok: false, error: "Unknown cell" };
  const ctx = await context();
  const s = await getSlot(ctx, week, day, slot);
  if (!s) return { ok: false, error: "Nothing to lock" };
  const { error } = await ctx.supabase
    .from("plan_slots")
    .update({ status: locked ? "locked" : "proposed", changed_by_user: true })
    .eq("id", s.id);
  if (error) return { ok: false, error: error.message };
  await log(ctx, { slot_id: s.id, action: locked ? "lock" : "unlock", from_meal: s.meal_id });
  revalidatePath("/week");
  return { ok: true };
}

export async function clearCell(week: string, day: string, slot: string): Promise<Result> {
  if (!isWeek(week) || !isCell(day, slot)) return { ok: false, error: "Unknown cell" };
  const ctx = await context();
  const s = await getSlot(ctx, week, day, slot);
  if (!s) return { ok: true };
  const { error } = await ctx.supabase
    .from("plan_slots")
    .update({ meal_id: null, as_written: null, is_takeaway: false, status: "proposed", changed_by_user: true })
    .eq("id", s.id);
  if (error) return { ok: false, error: error.message };
  const adjustmentId = await log(ctx, { slot_id: s.id, action: "remove", from_meal: s.meal_id });
  revalidatePath("/week");
  return { ok: true, adjustmentId };
}

const REASONS = ["too much pasta", "not in the mood", "no time", "guests", "other"];

export async function setReason(adjustmentId: string, reason: string): Promise<Result> {
  if (!REASONS.includes(reason)) return { ok: false, error: "Unknown reason" };
  const ctx = await context();
  await ctx.supabase.from("adjustments").update({ reason_chip: reason }).eq("household_id", ctx.householdId).eq("id", adjustmentId);
  return { ok: true };
}

export type TagEdit = {
  protein: "meat" | "fish" | "veg";
  starch: string;
  is_pasta: boolean;
  is_processed: boolean;
  effort: "quick" | "normal" | "long" | "";
};

// Correct a meal's facts in the library; the planner uses these over its guess.
export async function saveMealTags(mealId: string, tags: TagEdit): Promise<Result> {
  const ctx = await context();
  if (!["meat", "fish", "veg"].includes(tags.protein)) return { ok: false, error: "Pick meat, fish or veg" };
  const { error } = await ctx.supabase
    .from("meals")
    .update({
      protein: tags.protein,
      starch: ["pasta", "potatoes", "rice", "noodles", "bread", "none"].includes(tags.starch) ? tags.starch : null,
      is_pasta: tags.is_pasta,
      is_processed: tags.is_processed,
      effort: tags.effort || null,
    })
    .eq("household_id", ctx.householdId)
    .eq("id", mealId);
  if (error) return { ok: false, error: error.message };
  await log(ctx, { slot_id: null, action: "tags", from_meal: mealId, to_meal: mealId });
  revalidatePath("/week");
  return { ok: true };
}

// Add a meal the library does not have yet, then put it in the cell.
export async function addNewMeal(week: string, day: string, slot: string, name: string): Promise<Result> {
  const clean = name.trim().replace(/\s+/g, " ");
  if (clean.length < 2 || clean.length > 120) return { ok: false, error: "Type the meal's name" };
  if (/\b(sobras?|leftovers?)\b/i.test(clean)) return { ok: false, error: "Sobras are leftovers, not a meal" };
  const ctx = await context();
  const { data: existing } = await ctx.supabase
    .from("meals")
    .select("id")
    .eq("household_id", ctx.householdId)
    .ilike("name_group", clean.replace(/[%_\\]/g, "\\$&"))
    .maybeSingle();
  if (existing) return setCellMeal(week, day, slot, existing.id);
  const { data, error } = await ctx.supabase
    .from("meals")
    .insert({ household_id: ctx.householdId, name: clean, name_group: clean, variants_seen: [clean], source: "menu" })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return setCellMeal(week, day, slot, data.id);
}
