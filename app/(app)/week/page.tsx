import Link from "next/link";
import { DAYS, addDays } from "@/lib/planner/rules";
import { WeekBoard } from "./board";
import { formatDay, loadWeek, weekFromParam } from "./load";

export default async function WeekPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const { w } = await searchParams;
  const week = weekFromParam(w);
  const data = await loadWeek(week);
  if (!data) return null;
  if ("error" in data) return <p className="text-destructive">Could not load the week: {data.error}</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/week?w=${addDays(week, -7)}`} className="rounded-full px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted" aria-label="Previous week">
          ‹ Prev
        </Link>
        <div className="text-center">
          <h1 className="text-lg font-bold">Week of {formatDay(week)}</h1>
          <p className="text-xs text-muted-foreground">
            {formatDay(week)} to {formatDay(addDays(week, DAYS.length - 1))} ·{" "}
            <Link href={`/week/check?w=${week}`} className="underline">
              Week check
            </Link>
          </p>
        </div>
        <Link href={`/week?w=${addDays(week, 7)}`} className="rounded-full px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted" aria-label="Next week">
          Next ›
        </Link>
      </div>
      <WeekBoard key={week} week={week} cells={data.cells} meals={data.meals} history={data.history} />
    </div>
  );
}
