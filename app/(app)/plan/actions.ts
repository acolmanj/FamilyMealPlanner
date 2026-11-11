"use server";

import { revalidatePath } from "next/cache";
import { getHousehold } from "@/lib/household";
import { getMessages } from "@/lib/i18n/server";
import type { Relaxed } from "@/lib/planner/generate";
import { emptySlots, planWeeks } from "@/lib/planner/plan";
import { DAYS, SLOTS, addDays, type Day, type PlanMeal, type Slot } from "@/lib/planner/rules";
import { defaultWeek } from "@/lib/planner/week";
import { loadWeeks } from "../week/load";
import { addElPaisIdeas, type ElPaisOutcome } from "./elpais";

// "Plan week" in the tab bar: fill every empty slot of this week and next, keeping
// everything already planned. New proposals stay 'proposed' so they can be swapped.

export type AddedCell = { week: string; day: Day; slot: Slot; mealId: string };
export type PlanSummary = {
  ok: true;
  filled: number;
  added: AddedCell[];
  weeks: { weekStart: string; empty: number; filled: number; relaxed: Relaxed[]; failed: boolean }[];
  elpais: ElPaisOutcome & { planned: number };
};
type Failure = { ok: false; error: string };

const twoWeeks = () => {
  const a = defaultWeek();
  return [a, addDays(a, 7)];
};

async function context() {
  const { supabase, household } = await getHousehold();
  if (!household) throw new Error("No household");
  return { supabase, householdId: household.id };
}

// How many slots are empty, for the question before anything is written.
export async function previewPlan(): Promise<{ ok: true; weeks: { weekStart: string; empty: number }[]; total: number } | Failure> {
  const { lang, t } = await getMessages();
  const weeks = twoWeeks();
  const data = await loadWeeks(weeks, lang);
  if (!data || "error" in data) return { ok: false, error: data?.error ?? t.plan.error };
  const counts = weeks.map((w) => ({ weekStart: w, empty: emptySlots(data.cells[w]) }));
  return { ok: true, weeks: counts, total: counts.reduce((n, w) => n + w.empty, 0) };
}

export async function planTheWeeks(seed: number): Promise<PlanSummary | Failure> {
  const { lang, t } = await getMessages();
  if (!Number.isInteger(seed)) return { ok: false, error: t.plan.error };
  const ctx = await context();
  const weeks = twoWeeks();

  // New El País ideas first, so they are in the library the planner reads.
  const before = await loadWeeks(weeks, lang);
  if (!before || "error" in before) return { ok: false, error: before?.error ?? t.plan.error };
  const anyEmpty = weeks.some((w) => emptySlots(before.cells[w]) > 0);
  const elpais = anyEmpty
    ? await addElPaisIdeas(ctx.supabase, ctx.householdId).catch((): ElPaisOutcome => ({ status: "down", added: [], skippedGluten: 0 }))
    : { status: "recent" as const, added: [], skippedGluten: 0 };
  const data = elpais.added.length ? await loadWeeks(weeks, lang) : before;
  if (!data || "error" in data) return { ok: false, error: data?.error ?? t.plan.error };

  const meals = new Map<string, PlanMeal>(data.meals.map((m) => [m.id, m]));
  const planned = planWeeks({
    weeks: weeks.map((w) => ({ weekStart: w, cells: data.cells[w].map((c) => ({ day: c.day, slot: c.slot, mealId: c.mealId })) })),
    meals,
    history: data.history,
    seed,
    lang,
  });

  const rows = planned.flatMap((w) =>
    w.failed
      ? []
      : w.cells.map((c) => ({
          household_id: ctx.householdId,
          week_start: w.weekStart,
          day: c.day,
          slot: c.slot,
          meal_id: c.mealId,
          as_written: meals.get(c.mealId)!.name,
          status: "proposed",
          is_leftover: false,
          is_takeaway: false,
          changed_by_user: false,
          why_line: c.why,
        })),
  );
  if (rows.length) {
    const { error } = await ctx.supabase.from("plan_slots").upsert(rows, { onConflict: "household_id,week_start,day,slot" });
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath("/", "layout");

  const added: AddedCell[] = rows.map((r) => ({ week: r.week_start, day: r.day, slot: r.slot, mealId: r.meal_id }));
  return {
    ok: true,
    filled: added.length,
    added,
    weeks: planned.map((w) => ({ weekStart: w.weekStart, empty: w.empty, filled: w.failed ? 0 : w.cells.length, relaxed: w.relaxed, failed: w.failed })),
    elpais: { ...elpais, planned: added.filter((a) => meals.get(a.mealId)?.idea).length },
  };
}

// Undo takes out only what this plan added, and only where it is still as the planner left it.
export async function undoPlan(added: AddedCell[]): Promise<{ ok: true; removed: number } | Failure> {
  const { t } = await getMessages();
  const ctx = await context();
  let removed = 0;
  for (const a of added.slice(0, DAYS.length * SLOTS.length * 2)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.week) || !DAYS.includes(a.day) || !SLOTS.includes(a.slot)) continue;
    const { data, error } = await ctx.supabase
      .from("plan_slots")
      .update({ meal_id: null, as_written: null, why_line: null, status: "proposed" })
      .eq("household_id", ctx.householdId)
      .eq("week_start", a.week)
      .eq("day", a.day)
      .eq("slot", a.slot)
      .eq("meal_id", a.mealId)
      .eq("status", "proposed")
      .eq("changed_by_user", false)
      .select("id");
    if (error) return { ok: false, error: t.plan.error };
    removed += data?.length ?? 0;
  }
  revalidatePath("/", "layout");
  return { ok: true, removed };
}
