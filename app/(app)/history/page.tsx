import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getHousehold } from "@/lib/household";
import { formatDate, mealName, type Lang, type Messages } from "@/lib/i18n/messages";
import { getMessages } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

type Slot = {
  id: string;
  week_start: string;
  week_no: number | null;
  day: string;
  slot: string;
  as_written: string | null;
  is_leftover: boolean;
  is_takeaway: boolean;
  meals: { name: string; name_en: string | null; name_es: string | null; is_favourite: boolean; favourite_seen_count: number | null } | null;
};

export default async function HistoryPage() {
  const { supabase } = await getHousehold();
  const { lang, t } = await getMessages();
  const { data, error } = await supabase
    .from("plan_slots")
    .select("id, week_start, week_no, day, slot, as_written, is_leftover, is_takeaway, meals(name, name_en, name_es, is_favourite, favourite_seen_count)")
    .eq("status", "eaten")
    .order("week_start", { ascending: false })
    .returns<Slot[]>();

  if (error) return <p className="text-destructive">{t.history.couldNotLoad(error.message)}</p>;
  const slots = data ?? [];

  const weeks = new Map<string, Slot[]>();
  for (const s of slots) weeks.set(s.week_start, [...(weeks.get(s.week_start) ?? []), s]);
  const blanks = slots.filter((s) => !s.as_written).length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.history.title}</h1>
        <p className="text-sm text-muted-foreground">{t.history.intro(slots.length, weeks.size, blanks)}</p>
      </div>

      {[...weeks.entries()].map(([weekStart, ws]) => {
        const cell = (day: string, slot: string) => ws.find((s) => s.day === day && s.slot === slot);
        return (
          <Card key={weekStart}>
            <CardHeader>
              <CardTitle>{t.week.weekOf(formatDate(weekStart, lang))}</CardTitle>
              <CardDescription>{t.history.sheetWeek(ws[0]?.week_no ?? null, ws.length)}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-x-2 gap-y-1 text-sm">
                <span />
                <span className="text-xs font-semibold text-muted-foreground uppercase">{t.slots.lunch}</span>
                <span className="text-xs font-semibold text-muted-foreground uppercase">{t.slots.dinner}</span>
                {DAYS.map((code) => (
                  <Row key={code} label={t.days[code]} lunch={cell(code, "lunch")} dinner={cell(code, "dinner")} lang={lang} t={t} />
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

type Lt = { lang: Lang; t: Messages };

function Row({ label, lunch, dinner, ...lt }: { label: string; lunch?: Slot; dinner?: Slot } & Lt) {
  return (
    <>
      <span className="py-1.5 text-xs font-semibold text-muted-foreground">{label}</span>
      <Cell slot={lunch} {...lt} />
      <Cell slot={dinner} {...lt} />
    </>
  );
}

function Cell({ slot, lang, t }: { slot?: Slot } & Lt) {
  if (!slot || !slot.as_written) {
    return <span className="rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground italic">{t.history.blank}</span>;
  }
  // The library name in the chosen language, else the dish as written without the ingredient list after the colon.
  const text = slot.meals ? mealName(slot.meals, lang) : slot.as_written.split(":")[0].trim();
  return (
    <span
      className={cn(
        "flex flex-col gap-1 rounded-md bg-secondary/60 px-2 py-1.5 leading-snug",
        slot.is_leftover && "bg-accent/20",
      )}
    >
      <span>{text}</span>
      <span className="flex flex-wrap gap-1">
        {slot.is_leftover && <Badge variant="accent">{t.history.leftovers}</Badge>}
        {slot.is_takeaway && <Badge variant="outline">{t.history.takeaway}</Badge>}
        {slot.meals?.favourite_seen_count != null && (
          <Badge variant={slot.meals.is_favourite ? "default" : "outline"}>
            {slot.meals.is_favourite ? t.history.favourite : t.history.favouriteQ}
          </Badge>
        )}
      </span>
    </span>
  );
}
