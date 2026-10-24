import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getHousehold } from "@/lib/household";
import { cn } from "@/lib/utils";

const DAYS = [
  ["mon", "Mon"],
  ["tue", "Tue"],
  ["wed", "Wed"],
  ["thu", "Thu"],
  ["fri", "Fri"],
  ["sat", "Sat"],
  ["sun", "Sun"],
] as const;

type Slot = {
  id: string;
  week_start: string;
  week_no: number | null;
  day: string;
  slot: string;
  as_written: string | null;
  is_leftover: boolean;
  is_takeaway: boolean;
  meals: { name: string; is_favourite: boolean; favourite_seen_count: number | null } | null;
};

function formatWeek(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "UTC" });
}

export default async function HistoryPage() {
  const { supabase } = await getHousehold();
  const { data, error } = await supabase
    .from("plan_slots")
    .select("id, week_start, week_no, day, slot, as_written, is_leftover, is_takeaway, meals(name, is_favourite, favourite_seen_count)")
    .eq("status", "eaten")
    .order("week_start", { ascending: false })
    .returns<Slot[]>();

  if (error) return <p className="text-destructive">Could not load past weeks: {error.message}</p>;
  const slots = data ?? [];

  const weeks = new Map<string, Slot[]>();
  for (const s of slots) weeks.set(s.week_start, [...(weeks.get(s.week_start) ?? []), s]);
  const blanks = slots.filter((s) => !s.as_written).length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">Past weeks</h1>
        <p className="text-sm text-muted-foreground">
          {slots.length} past slots over {weeks.size} weeks, loaded from the menu sheet ({blanks} left blank).
        </p>
      </div>

      {[...weeks.entries()].map(([weekStart, ws]) => {
        const cell = (day: string, slot: string) => ws.find((s) => s.day === day && s.slot === slot);
        return (
          <Card key={weekStart}>
            <CardHeader>
              <CardTitle>Week of {formatWeek(weekStart)}</CardTitle>
              <CardDescription>
                Week {ws[0]?.week_no} of the sheet · {ws.length} slots
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-x-2 gap-y-1 text-sm">
                <span />
                <span className="text-xs font-semibold text-muted-foreground uppercase">Lunch</span>
                <span className="text-xs font-semibold text-muted-foreground uppercase">Dinner</span>
                {DAYS.map(([code, label]) => (
                  <Row key={code} label={label} lunch={cell(code, "lunch")} dinner={cell(code, "dinner")} />
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Row({ label, lunch, dinner }: { label: string; lunch?: Slot; dinner?: Slot }) {
  return (
    <>
      <span className="py-1.5 text-xs font-semibold text-muted-foreground">{label}</span>
      <Cell slot={lunch} />
      <Cell slot={dinner} />
    </>
  );
}

function Cell({ slot }: { slot?: Slot }) {
  if (!slot || !slot.as_written) {
    return <span className="rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground italic">blank</span>;
  }
  // Show the dish as written, without the ingredient list after the colon.
  const text = slot.as_written.split(":")[0].trim();
  return (
    <span
      className={cn(
        "flex flex-col gap-1 rounded-md bg-secondary/60 px-2 py-1.5 leading-snug",
        slot.is_leftover && "bg-accent/20",
      )}
    >
      <span>{text}</span>
      <span className="flex flex-wrap gap-1">
        {slot.is_leftover && <Badge variant="accent">Sobras</Badge>}
        {slot.is_takeaway && <Badge variant="outline">Take-away</Badge>}
        {slot.meals?.favourite_seen_count != null && (
          <Badge variant={slot.meals.is_favourite ? "default" : "outline"}>
            {slot.meals.is_favourite ? "★ Favourite" : "Favourite?"}
          </Badge>
        )}
      </span>
    </span>
  );
}
