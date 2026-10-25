import Link from "next/link";
import { applyConfirmation, screenMeal } from "@/lib/gluten/gate";
import { getHousehold } from "@/lib/household";
import { DAYS, addDays, cellDate, type Day, type Slot } from "@/lib/planner/rules";
import { mealTags } from "@/lib/planner/tags";
import { WeekBoard, type BoardCell, type BoardMeal } from "./board";

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
};

type SlotRow = {
  id: string;
  week_start: string;
  day: Day;
  slot: Slot | "lunchbox";
  meal_id: string | null;
  as_written: string | null;
  status: string;
};

function mondayOf(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

// The week being planned: this week, or next week from Saturday on.
function defaultWeek(now = new Date()) {
  const monday = mondayOf(now);
  return now.getUTCDay() === 6 || now.getUTCDay() === 0 ? addDays(monday, 7) : monday;
}

function formatDay(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "UTC" });
}

export default async function WeekPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const { supabase, household } = await getHousehold();
  if (!household) return null;
  const { w } = await searchParams;
  const week = w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? mondayOf(new Date(`${w}T00:00:00Z`)) : defaultWeek();

  const [{ data: meals, error }, { data: slots }] = await Promise.all([
    supabase
      .from("meals")
      .select("id, name, variants_seen, ingredients_note, protein, starch, is_pasta, is_processed, effort, pinned, gf_confirmed_at")
      .eq("retired", false)
      .eq("blacklisted", false)
      .order("name")
      .returns<MealRow[]>(),
    supabase.from("plan_slots").select("id, week_start, day, slot, meal_id, as_written, status").returns<SlotRow[]>(),
  ]);
  if (error) return <p className="text-destructive">Could not load the week: {error.message}</p>;

  const boardMeals: BoardMeal[] = (meals ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    pinned: m.pinned,
    tags: mealTags(m),
    gluten: applyConfirmation(
      screenMeal({ name: m.name, variants: m.variants_seen, ingredients: m.ingredients_note }),
      Boolean(m.gf_confirmed_at),
    ).status,
  }));

  const cells: BoardCell[] = (slots ?? [])
    .filter((s) => s.week_start === week && s.slot !== "lunchbox" && (s.meal_id || s.as_written))
    .map((s) => ({
      day: s.day,
      slot: s.slot as Slot,
      mealId: s.meal_id,
      text: s.as_written ? s.as_written.split(/:\s|: ?https?:/)[0].trim() : null,
      locked: s.status === "locked",
    }));

  // Every other week's plan, for recency and "new meal".
  const history = (slots ?? [])
    .filter((s) => s.week_start !== week && s.meal_id)
    .map((s) => ({ mealId: s.meal_id!, date: cellDate(s.week_start, s.day) }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/week?w=${addDays(week, -7)}`} className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted" aria-label="Previous week">
          ‹ Prev
        </Link>
        <div className="text-center">
          <h1 className="text-xl font-bold">Week of {formatDay(week)}</h1>
          <p className="text-xs text-muted-foreground">
            {formatDay(week)} to {formatDay(addDays(week, DAYS.length - 1))}
          </p>
        </div>
        <Link href={`/week?w=${addDays(week, 7)}`} className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted" aria-label="Next week">
          Next ›
        </Link>
      </div>
      <WeekBoard key={week} week={week} cells={cells} meals={boardMeals} history={history} />
    </div>
  );
}
