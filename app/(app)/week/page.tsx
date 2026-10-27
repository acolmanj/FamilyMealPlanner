import Link from "next/link";
import { getMessages } from "@/lib/i18n/server";
import { DAYS, addDays } from "@/lib/planner/rules";
import { WeekBoard } from "./board";
import { formatDay, loadWeek, weekFromParam } from "./load";

export default async function WeekPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const { w } = await searchParams;
  const week = weekFromParam(w);
  const { lang, t } = await getMessages();
  const data = await loadWeek(week, lang);
  if (!data) return null;
  if ("error" in data) return <p className="text-destructive">{t.week.couldNotLoad(data.error ?? "")}</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/week?w=${addDays(week, -7)}`} className="rounded-full px-2 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:bg-muted" aria-label={t.week.prevLabel}>
          {t.week.prev}
        </Link>
        <div className="text-center">
          <h1 className="text-lg font-bold">{t.week.weekOf(formatDay(week, lang))}</h1>
          <p className="text-xs text-muted-foreground">
            {t.week.range(formatDay(week, lang), formatDay(addDays(week, DAYS.length - 1), lang))} ·{" "}
            <Link href={`/week/check?w=${week}`} className="underline">
              {t.week.check}
            </Link>
          </p>
        </div>
        <Link href={`/week?w=${addDays(week, 7)}`} className="rounded-full px-2 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:bg-muted" aria-label={t.week.nextLabel}>
          {t.week.next}
        </Link>
      </div>
      <WeekBoard key={`${week}-${lang}`} week={week} cells={data.cells} meals={data.meals} history={data.history} />
    </div>
  );
}
