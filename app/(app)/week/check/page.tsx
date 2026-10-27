import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMessages } from "@/lib/i18n/server";
import { LIMITS, checkWeek, type Warning } from "@/lib/planner/rules";
import { cn } from "@/lib/utils";
import { formatDay, loadWeek, weekFromParam } from "../load";

// The week's plain counts and rule warnings, kept off the planner itself.
export default async function WeekCheckPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const { w } = await searchParams;
  const week = weekFromParam(w);
  const { lang, t } = await getMessages();
  const data = await loadWeek(week, lang);
  if (!data) return null;
  if ("error" in data) return <p className="text-destructive">{t.week.couldNotLoad(data.error ?? "")}</p>;

  const meals = new Map(data.meals.map((m) => [m.id, m]));
  const cells = data.cells.map((c) => ({ day: c.day, slot: c.slot, mealId: c.mealId && meals.has(c.mealId) ? c.mealId : null }));
  const { counts, warnings } = checkWeek({ weekStart: week, cells, meals, history: data.history, lang });

  const items: [string, string, boolean][] = [
    [t.check.filled, t.check.of(counts.filled, counts.toFill), false],
    [t.protein.fish, `${counts.fish}`, counts.filled === counts.toFill && counts.fish === 0],
    [t.check.pulses, t.check.of(counts.pulses, `${LIMITS.pulsesMin}+`), counts.filled === counts.toFill && counts.pulses < LIMITS.pulsesMin],
    [t.protein.meat, `${counts.meat}`, false],
    [t.protein.veg, `${counts.veg}`, false],
    [t.check.pasta, t.check.of(counts.pasta, LIMITS.pasta), counts.pasta > LIMITS.pasta],
    [t.check.processed, t.check.of(counts.processed, LIMITS.processed), counts.processed > LIMITS.processed],
    [t.check.newMeals, t.check.of(counts.newMeals, `~${LIMITS.newMeals}`), counts.newMeals > LIMITS.newMeals],
  ];
  const groups: [Warning["level"], string][] = [
    ["block", t.check.blockGroup],
    ["hard", t.check.hardGroup],
    ["soft", t.check.softGroup],
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t.check.title(formatDay(week, lang))}</h1>
        <Link href={`/week?w=${week}`} className="text-sm underline">
          {t.check.back}
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
      {warnings.length === 0 && <p className="text-sm text-muted-foreground">{t.check.nothing}</p>}
      <p className="text-xs text-muted-foreground">{t.check.footer}</p>
    </div>
  );
}
