import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LIMITS, checkWeek, type Warning } from "@/lib/planner/rules";
import { cn } from "@/lib/utils";
import { formatDay, loadWeek, weekFromParam } from "../load";

// The week's plain counts and rule warnings, kept off the planner itself.
export default async function WeekCheckPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const { w } = await searchParams;
  const week = weekFromParam(w);
  const data = await loadWeek(week);
  if (!data) return null;
  if ("error" in data) return <p className="text-destructive">Could not load the week: {data.error}</p>;

  const meals = new Map(data.meals.map((m) => [m.id, m]));
  const cells = data.cells.map((c) => ({ day: c.day, slot: c.slot, mealId: c.mealId && meals.has(c.mealId) ? c.mealId : null }));
  const { counts, warnings } = checkWeek({ weekStart: week, cells, meals, history: data.history });

  const items: [string, string, boolean][] = [
    ["Filled", `${counts.filled} of ${counts.toFill}`, false],
    ["Fish", `${counts.fish}`, counts.filled === counts.toFill && counts.fish === 0],
    ["Pulses", `${counts.pulses} of ${LIMITS.pulsesMin}+`, counts.filled === counts.toFill && counts.pulses < LIMITS.pulsesMin],
    ["Meat", `${counts.meat}`, false],
    ["Vegetarian", `${counts.veg}`, false],
    ["Pasta", `${counts.pasta} of ${LIMITS.pasta}`, counts.pasta > LIMITS.pasta],
    ["Processed", `${counts.processed} of ${LIMITS.processed}`, counts.processed > LIMITS.processed],
    ["New meals", `${counts.newMeals} of ~${LIMITS.newMeals}`, counts.newMeals > LIMITS.newMeals],
  ];
  const groups: [Warning["level"], string][] = [
    ["block", "Blocked for gluten"],
    ["hard", "Rules to look at"],
    ["soft", "Nice to have"],
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Week check: {formatDay(week)}</h1>
        <Link href={`/week?w=${week}`} className="text-sm underline">
          Back to the plan
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {items.map(([label, value, over]) => (
          <div key={label} className={cn("rounded-md border bg-card px-3 py-2", over && "border-warning bg-warning/10")}>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={cn("text-lg font-semibold", over && "text-warning")}>{value}</div>
          </div>
        ))}
      </div>
      {groups.map(([level, title]) => {
        const ws = warnings.filter((x) => x.level === level);
        if (ws.length === 0) return null;
        return (
          <Card key={level}>
            <CardHeader>
              <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1.5 text-sm">
                {ws.map((x, i) => (
                  <li key={i}>{x.text}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
      {warnings.length === 0 && <p className="text-sm text-muted-foreground">Nothing to flag this week.</p>}
      <p className="text-xs text-muted-foreground">
        Plain counts, never a score. Only gluten blocks; everything else is for you to decide. Fish, meat, pulses and pasta
        are guessed from each meal&apos;s name until you fix them in the planner.
      </p>
    </div>
  );
}
