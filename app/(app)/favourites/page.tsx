import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getHousehold } from "@/lib/household";
import { formatDate, mealName } from "@/lib/i18n/messages";
import { getMessages } from "@/lib/i18n/server";

type Meal = {
  id: string;
  name: string;
  name_en: string | null;
  name_es: string | null;
  variants_seen: string[];
  is_favourite: boolean;
  favourite_seen_count: number;
  last_eaten: string | null;
  gluten_keyword_flag: string | null;
};

export default async function FavouritesPage() {
  const { supabase } = await getHousehold();
  const { lang, t } = await getMessages();
  const { data, error } = await supabase
    .from("meals")
    .select("id, name, name_en, name_es, variants_seen, is_favourite, favourite_seen_count, last_eaten, gluten_keyword_flag")
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
        <h1 className="text-xl font-bold">{t.favourites.title}</h1>
        <p className="text-sm text-muted-foreground">{t.favourites.intro(meals.length, confirmed)}</p>
      </div>

      {confirmed === 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <strong>{t.gluten.openDecision}</strong> {t.favourites.openText}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {meals.map((m) => (
          <Card key={m.id}>
            <CardHeader className="flex-row items-start justify-between gap-2">
              <CardTitle>{mealName(m, lang)}</CardTitle>
              <Badge variant={m.is_favourite ? "default" : "outline"}>
                {m.is_favourite ? t.favourites.favourite : t.favourites.awaiting}
              </Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              <p>
                {t.favourites.eaten(m.favourite_seen_count)}
                {m.last_eaten && t.favourites.lastOn(formatDate(m.last_eaten, lang))}.
              </p>
              {m.variants_seen.length > 1 && (
                <p className="text-muted-foreground">{t.favourites.writtenAs(m.variants_seen.join(" · "))}</p>
              )}
              {m.gluten_keyword_flag && (
                <p className="text-xs text-warning">{t.favourites.hint(m.gluten_keyword_flag)}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
