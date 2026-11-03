import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getHousehold } from "@/lib/household";
import { cleanTitle, formatDate, mealName } from "@/lib/i18n/messages";
import { getMessages } from "@/lib/i18n/server";
import { FavouriteButton } from "./favourite-button";

type Meal = {
  id: string;
  name: string;
  name_en: string | null;
  name_es: string | null;
  variants_seen: string[];
  is_favourite: boolean;
  favourite_seen_count: number;
  last_eaten: string | null;
};

const variants = (m: Meal) => [...new Set(m.variants_seen.map(cleanTitle))];

export default async function FavouritesPage() {
  const { supabase } = await getHousehold();
  const { lang, t } = await getMessages();
  const { data, error } = await supabase
    .from("meals")
    .select("id, name, name_en, name_es, variants_seen, is_favourite, favourite_seen_count, last_eaten")
    .not("favourite_seen_count", "is", null)
    .order("favourite_seen_count", { ascending: false })
    .order("name")
    .returns<Meal[]>();

  if (error) return <p className="text-destructive">{t.favourites.couldNotLoad(error.message)}</p>;
  const meals = data ?? [];
  const confirmed = meals.filter((m) => m.is_favourite).length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[28px] leading-tight font-bold tracking-tight">{t.favourites.title}</h1>
        <p className="text-sm text-muted-foreground">{t.favourites.intro(meals.length, confirmed)}</p>
      </div>

      {confirmed === 0 && (
        <div className="rounded-2xl bg-warning/10 p-3.5 text-sm">
          <strong>{t.gluten.openDecision}</strong> {t.favourites.openText}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {meals.map((m) => (
          <Card key={m.id}>
            <CardHeader className="flex-row items-start justify-between gap-2">
              <CardTitle>{mealName(m, lang)}</CardTitle>
              <FavouriteButton id={m.id} name={mealName(m, lang)} favourite={m.is_favourite} />
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              <p>
                {t.favourites.eaten(m.favourite_seen_count)}
                {m.last_eaten && t.favourites.lastOn(formatDate(m.last_eaten, lang))}.
              </p>
              {variants(m).length > 1 && <p className="text-muted-foreground">{t.favourites.writtenAs(variants(m).join(" · "))}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
