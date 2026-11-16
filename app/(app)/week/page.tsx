import Link from "next/link";
import { getMessages } from "@/lib/i18n/server";
import { DAYS, addDays } from "@/lib/planner/rules";
import { WeekBoard } from "./board";
import { formatDay, loadWeek, weekFromParam } from "./load";
import { WeekSwipe } from "./week-swipe";

export default async function WeekPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const { w } = await searchParams;
  const week = weekFromParam(w);
  const { lang, t } = await getMessages();
  const data = await loadWeek(week, lang);
  if (!data) return null;
  if ("error" in data) return <p className="text-destructive">{t.week.couldNotLoad(data.error ?? "")}</p>;

  const prevHref = `/week?w=${addDays(week, -7)}`;
  const nextHref = `/week?w=${addDays(week, 7)}`;

  return (
    <WeekSwipe prevHref={prevHref} nextHref={nextHref}>
      <div className="flex items-center justify-between gap-2">
        <Link href={prevHref} className="flex h-10 min-w-10 items-center justify-center rounded-full bg-card px-3 text-[15px] font-medium whitespace-nowrap text-primary shadow-card active:scale-95" aria-label={t.week.prevLabel}>
          {t.week.prev}
        </Link>
        <div className="text-center">
          <h1 className="text-xl font-bold tracking-tight">{t.week.weekOf(formatDay(week, lang))}</h1>
          <p className="text-xs text-muted-foreground">
            {t.week.range(formatDay(week, lang), formatDay(addDays(week, DAYS.length - 1), lang))} ·{" "}
            <Link href={`/week/check?w=${week}`} className="font-medium whitespace-nowrap text-primary">
              {t.week.check}
            </Link>
          </p>
        </div>
        <Link href={nextHref} className="flex h-10 min-w-10 items-center justify-center rounded-full bg-card px-3 text-[15px] font-medium whitespace-nowrap text-primary shadow-card active:scale-95" aria-label={t.week.nextLabel}>
          {t.week.next}
        </Link>
      </div>
      <WeekBoard key={`${week}-${lang}`} week={week} cells={data.cells} meals={data.meals} history={data.history} />
    </WeekSwipe>
  );
}
