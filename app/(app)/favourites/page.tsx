import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getHousehold } from "@/lib/household";

type Meal = {
  id: string;
  name: string;
  variants_seen: string[];
  is_favourite: boolean;
  favourite_seen_count: number;
  last_eaten: string | null;
  gluten_keyword_flag: string | null;
};

export default async function FavouritesPage() {
  const { supabase } = await getHousehold();
  const { data, error } = await supabase
    .from("meals")
    .select("id, name, variants_seen, is_favourite, favourite_seen_count, last_eaten, gluten_keyword_flag")
    .not("favourite_seen_count", "is", null)
    .order("favourite_seen_count", { ascending: false })
    .order("name")
    .returns<Meal[]>();

  if (error) return <p className="text-destructive">Could not load favourites: {error.message}</p>;
  const meals = data ?? [];
  const confirmed = meals.filter((m) => m.is_favourite).length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">Favourites</h1>
        <p className="text-sm text-muted-foreground">
          {meals.length} meal groups eaten 3 or more times in the last 8 weeks. {confirmed} confirmed as favourite.
        </p>
      </div>

      {confirmed === 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <strong>Open decision:</strong> none of these are marked as favourites yet. Put <code>yes</code> in the{" "}
          <code>confirm_as_favourite</code> column of <code>Seed/favourites_seed.csv</code> for the ones you want, and
          they will be marked the next time the seed runs.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {meals.map((m) => (
          <Card key={m.id}>
            <CardHeader className="flex-row items-start justify-between gap-2">
              <CardTitle>{m.name}</CardTitle>
              <Badge variant={m.is_favourite ? "default" : "outline"}>
                {m.is_favourite ? "★ Favourite" : "Awaiting your yes"}
              </Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              <p>
                Eaten <strong>{m.favourite_seen_count}</strong> times in the last 8 weeks
                {m.last_eaten && (
                  <>
                    , last on{" "}
                    {new Date(`${m.last_eaten}T00:00:00Z`).toLocaleDateString("en-IE", {
                      day: "numeric",
                      month: "short",
                      timeZone: "UTC",
                    })}
                  </>
                )}
                .
              </p>
              {m.variants_seen.length > 1 && (
                <p className="text-muted-foreground">Written as: {m.variants_seen.join(" · ")}</p>
              )}
              {m.gluten_keyword_flag && (
                <p className="text-xs text-warning">Gluten hint (not a check yet): {m.gluten_keyword_flag}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
