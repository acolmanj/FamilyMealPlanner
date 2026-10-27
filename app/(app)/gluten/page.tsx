import { revalidatePath } from "next/cache";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GlutenBadge } from "@/components/gluten-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VerdictDetails } from "@/components/verdict-details";
import { getMessages } from "@/lib/i18n/server";
import { formatDate, mealName, type Messages } from "@/lib/i18n/messages";
import { applyConfirmation, screenMeal, type Status, type Verdict } from "@/lib/gluten/gate";
import { getHousehold } from "@/lib/household";
import { cn } from "@/lib/utils";
import { TryAMeal } from "./try-a-meal";

const ORDER: Status[] = ["blocked", "needs_check", "needs_substitution", "safe"];
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

type Meal = {
  id: string;
  name: string;
  name_en: string | null;
  name_es: string | null;
  variants_seen: string[];
  ingredients_note: string | null;
  is_favourite: boolean;
  gf_confirmed_at: string | null;
};

type Slot = {
  id: string;
  week_start: string;
  day: string;
  slot: string;
  as_written: string | null;
  is_takeaway: boolean;
  is_leftover: boolean;
  meals: { gf_confirmed_at: string | null; name: string; name_en: string | null; name_es: string | null } | null;
};

async function setConfirmed(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const confirm = formData.get("confirm") === "1";
  const { supabase, household, user } = await getHousehold();
  if (!household || !id) return;
  await supabase
    .from("meals")
    .update(
      confirm
        ? { gf_confirmed_at: new Date().toISOString(), gf_confirmed_by: user.email ?? "household" }
        : { gf_confirmed_at: null, gf_confirmed_by: null },
    )
    .eq("household_id", household.id)
    .eq("id", id);
  revalidatePath("/gluten");
}

function mondayOf(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

export default async function GlutenPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { supabase, household } = await getHousehold();
  if (!household) return null;
  const { status: filter } = await searchParams;
  const { lang, t } = await getMessages();

  const [{ data: meals, error }, { data: upcoming }] = await Promise.all([
    supabase
      .from("meals")
      .select("id, name, name_en, name_es, variants_seen, ingredients_note, is_favourite, gf_confirmed_at")
      .eq("retired", false)
      .order("name")
      .returns<Meal[]>(),
    supabase
      .from("plan_slots")
      .select("id, week_start, day, slot, as_written, is_takeaway, is_leftover, meals(gf_confirmed_at, name, name_en, name_es)")
      .gte("week_start", mondayOf(new Date()))
      .neq("status", "eaten")
      .order("week_start")
      .returns<Slot[]>(),
  ]);
  if (error) return <p className="text-destructive">{t.gluten.couldNotLoad(error.message)}</p>;

  const screened = (meals ?? []).map((m) => {
    // The meal itself, then each way it was written (e.g. "Pizza y croquetas").
    const screenedVerdict = screenMeal({ name: m.name, ingredients: m.ingredients_note });
    const confirmed = Boolean(m.gf_confirmed_at);
    const variants = m.variants_seen
      .map((v) => ({ text: v, verdict: screenMeal({ name: v }) }))
      .filter((v) => ORDER.indexOf(v.verdict.status) < ORDER.indexOf(screenedVerdict.status))
      .map((v) => ({ ...v, verdict: applyConfirmation(v.verdict, confirmed) }));
    return { meal: m, label: mealName(m, lang), verdict: applyConfirmation(screenedVerdict, confirmed), variants };
  });
  screened.sort(
    (a, b) => ORDER.indexOf(a.verdict.status) - ORDER.indexOf(b.verdict.status) || a.label.localeCompare(b.label),
  );
  const counts = Object.fromEntries(ORDER.map((s) => [s, screened.filter((x) => x.verdict.status === s).length]));
  const shown = filter && ORDER.includes(filter as Status) ? screened.filter((x) => x.verdict.status === filter) : screened;

  const weeks = new Map<string, Slot[]>();
  for (const s of upcoming ?? []) weeks.set(s.week_start, [...(weeks.get(s.week_start) ?? []), s]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t.gluten.title}</h1>
        <p className="text-sm text-muted-foreground">{t.gluten.intro}</p>
      </div>

      <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
        <strong>{t.gluten.openDecision}</strong> {t.gluten.openText}
      </div>

      {[...weeks.entries()].map(([weekStart, slots]) => (
        <Card key={weekStart}>
          <CardHeader>
            <CardTitle>{t.week.weekOf(formatDate(weekStart, lang))}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {slots
              // Sobras (leftovers) are not a meal, so there is nothing to screen.
              .filter((s) => s.as_written && !s.is_leftover && (s.slot === "lunch" || s.slot === "dinner"))
              .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.slot.localeCompare(b.slot))
              .map((s) => {
                const v = applyConfirmation(
                  screenMeal({ name: s.as_written!, isTakeaway: s.is_takeaway }),
                  Boolean(s.meals?.gf_confirmed_at),
                );
                return (
                  <div key={s.id} className="flex flex-col gap-1 border-b pb-3 last:border-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <span>
                        <span className="text-xs font-semibold text-muted-foreground uppercase">
                          {t.days[s.day as keyof Messages["days"]]} {t.slots[s.slot as keyof Messages["slots"]]}
                        </span>
                        <br />
                        {s.meals ? mealName(s.meals, lang) : s.as_written!.split(/:\s|: ?https?:/)[0]}
                      </span>
                      <GlutenBadge status={v.status} />
                    </div>
                    {(v.status !== "safe" || v.swaps.length > 0) && <VerdictDetails verdict={v} />}
                  </div>
                );
              })}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>{t.gluten.tryMeal}</CardTitle>
        </CardHeader>
        <CardContent>
          <TryAMeal />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <FilterChip href="/gluten" active={!filter} label={t.gluten.all(screened.length)} />
        {ORDER.map((s) => (
          <FilterChip key={s} href={`/gluten?status=${s}`} active={filter === s} label={`${t.status[s]} ${counts[s]}`} />
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {shown.map(({ meal, label, verdict, variants }) => (
          <MealCard key={meal.id} id={meal.id} name={label} verdict={verdict} variants={variants} t={t} />
        ))}
      </div>
    </div>
  );
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm whitespace-nowrap",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground",
      )}
    >
      {label}
    </Link>
  );
}

function MealCard({
  id,
  name,
  verdict,
  variants,
  t,
}: {
  id: string;
  name: string;
  verdict: Verdict;
  variants: { text: string; verdict: Verdict }[];
  t: Messages;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <CardTitle>{name}</CardTitle>
        <GlutenBadge status={verdict.status} />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <VerdictDetails verdict={verdict} />
        {variants.map((v) => (
          <div key={v.text} className="flex flex-col gap-1 rounded-md bg-muted p-2">
            <p className="flex items-start justify-between gap-2 text-sm">
              <span>{t.gluten.writtenAs(v.text)}</span>
              <GlutenBadge status={v.verdict.status} />
            </p>
            <VerdictDetails verdict={v.verdict} />
          </div>
        ))}
        <form action={setConfirmed}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="confirm" value={verdict.confirmed ? "0" : "1"} />
          <Button type="submit" variant="outline" size="sm">
            {verdict.confirmed ? t.gluten.undo : t.gluten.confirm}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
