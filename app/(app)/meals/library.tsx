"use client";

import { useState, useTransition } from "react";
import { GlutenBadge } from "@/components/gluten-badge";
import { useLang } from "@/components/lang";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalise, type Status } from "@/lib/gluten/gate";
import type { Protein } from "@/lib/planner/tags";
import { cn } from "@/lib/utils";
import { useResolveImages } from "../week/resolve-images";
import { createMeal, importRecipe, updateMeal, type MealEdit } from "./actions";

export type LibraryMeal = {
  id: string;
  name: string;
  name_en: string;
  name_es: string;
  protein: Protein;
  ingredients: string[];
  recipeIngredients: string[] | null;
  gluten: Status;
  image: string | null;
  imageSource: string | null;
  recipeUrl: string | null;
};

const GROUPS: Protein[] = ["meat", "fish", "veg"];
// The planner's colours: meat dark red, fish blue, vegetarian green.
const GROUP_STYLE: Record<Protein, string> = {
  meat: "border-l-[#8b1a1a] bg-[#f6e4e4]",
  fish: "border-l-[#1d5fb4] bg-[#e3eefb]",
  veg: "border-l-[#2e7d32] bg-[#e6f2e0]",
};
const GROUP_DOT: Record<Protein, string> = { meat: "bg-[#8b1a1a]", fish: "bg-[#1d5fb4]", veg: "bg-[#2e7d32]" };

const sourceName = (src: string | null, url: string | null) =>
  src === "wikimedia" ? "Wikimedia Commons" : src === "themealdb" ? "TheMealDB" : url ? new URL(url).hostname.replace(/^www\./, "") : "";

export function Library({ meals }: { meals: LibraryMeal[] }) {
  const { t } = useLang();
  useResolveImages();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const q = normalise(query).trim();
  const shown = q ? meals.filter((m) => normalise(`${m.name} ${m.name_en} ${m.name_es} ${m.ingredients.join(" ")}`).includes(q)) : meals;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{t.meals.title}</h1>
          <p className="text-sm text-muted-foreground">{t.meals.intro(meals.length)}</p>
        </div>
        {!adding && (
          <Button onClick={() => (setAdding(true), setNotice(null))}>
            + {t.meals.add}
          </Button>
        )}
      </div>

      {notice && <p className="rounded-md bg-primary/10 p-2 text-sm text-primary">{notice}</p>}
      {adding && (
        <AddMeal
          onDone={(name) => {
            setAdding(false);
            if (name) setNotice(t.meals.added(name));
          }}
        />
      )}

      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.meals.search} aria-label={t.meals.search} />

      {GROUPS.map((g) => {
        const list = shown.filter((m) => m.protein === g);
        return (
          <section key={g} className="flex flex-col gap-2">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <span className={cn("inline-block size-3 rounded-sm", GROUP_DOT[g])} />
              {t.protein[g]} <span className="text-sm font-normal text-muted-foreground">{list.length}</span>
            </h2>
            {list.length === 0 && <p className="text-sm text-muted-foreground">{t.meals.empty}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              {list.map((m) => (
                <MealCard key={m.id} meal={m} open={open === m.id} onToggle={() => setOpen((o) => (o === m.id ? null : m.id))} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MealCard({ meal, open, onToggle }: { meal: LibraryMeal; open: boolean; onToggle: () => void }) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  return (
    <div className={cn("flex flex-col rounded-md border border-l-4 text-sm", GROUP_STYLE[meal.protein], open && "sm:col-span-2")}>
      <button onClick={onToggle} aria-expanded={open} className="flex items-center gap-2 p-2 text-left">
        {meal.image ? (
          <img src={meal.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-10 shrink-0 rounded object-cover" />
        ) : (
          <span className="size-10 shrink-0 rounded bg-background/60" />
        )}
        <span className="min-w-0 flex-1 font-medium break-words hyphens-auto">{meal.name}</span>
        <GlutenBadge status={meal.gluten} />
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t bg-card/70 p-2">
          {editing ? (
            <MealForm
              initial={{ name_en: meal.name_en, name_es: meal.name_es, protein: meal.protein, ingredients: meal.ingredients }}
              suggested={meal.recipeIngredients}
              suggestedFrom="TheMealDB"
              onSave={(edit) => updateMeal(meal.id, edit)}
              onDone={() => setEditing(false)}
            />
          ) : (
            <>
              <span className="font-medium">{t.meals.ingredients}</span>
              {meal.ingredients.length > 0 ? (
                <ul className="list-disc pl-5">
                  {meal.ingredients.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t.meals.noIngredients}</p>
              )}
              {meal.ingredients.length === 0 && meal.recipeIngredients && (
                <p className="text-xs text-muted-foreground">
                  {t.meals.recipeIngredients("TheMealDB")} {meal.recipeIngredients.join(", ")}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  {t.meals.edit}
                </Button>
                {meal.recipeUrl && (
                  <a href={meal.recipeUrl} target="_blank" rel="noreferrer" className="text-xs underline">
                    {t.meals.openRecipe}
                  </a>
                )}
                {meal.image && (
                  <span className="text-[10px] text-muted-foreground">{t.meals.photoFrom(sourceName(meal.imageSource, meal.recipeUrl))}</span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// The form for editing a meal and for adding one, by hand or from a recipe link.
function MealForm({
  initial,
  suggested,
  suggestedFrom,
  onSave,
  onDone,
}: {
  initial: MealEdit;
  suggested?: string[] | null;
  suggestedFrom?: string;
  onSave: (edit: MealEdit) => Promise<{ ok: boolean; error?: string }>;
  onDone: (saved: boolean, edit: MealEdit) => void;
}) {
  const { t } = useLang();
  const [f, setF] = useState({ ...initial, text: initial.ingredients.join("\n") });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const edit = (): MealEdit => ({ name_en: f.name_en, name_es: f.name_es, protein: f.protein, ingredients: f.text.split("\n") });
  const save = () =>
    startTransition(async () => {
      setError(null);
      const r = await onSave(edit());
      if (r.ok) onDone(true, edit());
      else setError(r.error ?? t.board.didNotSave);
    });

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="font-medium">{t.meals.nameEn}</span>
        <Input value={f.name_en} onChange={(e) => setF({ ...f, name_en: e.target.value })} lang="en" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">{t.meals.nameEs}</span>
        <Input value={f.name_es} onChange={(e) => setF({ ...f, name_es: e.target.value })} lang="es" />
      </label>
      <span className="font-medium">{t.meals.group}</span>
      <div className="flex flex-wrap gap-1">
        {GROUPS.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setF({ ...f, protein: g })}
            aria-pressed={f.protein === g}
            className={cn("rounded-full border px-3 py-1", f.protein === g ? "border-primary bg-primary text-primary-foreground" : "bg-background")}
          >
            {t.protein[g]}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-medium">
          {t.meals.ingredients} <span className="font-normal text-muted-foreground">{t.meals.ingredientsHelp}</span>
        </span>
        <textarea
          value={f.text}
          onChange={(e) => setF({ ...f, text: e.target.value })}
          rows={Math.min(14, Math.max(5, f.text.split("\n").length + 1))}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        />
      </label>
      {suggested && suggested.length > 0 && !f.text.trim() && (
        <div className="flex flex-col gap-1 rounded-md bg-muted p-2 text-xs">
          <span>
            {t.meals.recipeIngredients(suggestedFrom ?? "")} {suggested.join(", ")}
          </span>
          <Button size="sm" variant="outline" className="self-start" onClick={() => setF({ ...f, text: suggested.join("\n") })}>
            {t.meals.useThese}
          </Button>
        </div>
      )}
      {error && <p className="text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={save}>
          {pending ? t.meals.saving : t.meals.save}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => onDone(false, edit())}>
          {t.meals.cancel}
        </Button>
      </div>
    </div>
  );
}

function AddMeal({ onDone }: { onDone: (name?: string) => void }) {
  const { lang, t } = useLang();
  const [mode, setMode] = useState<"link" | "hand">("link");
  const [url, setUrl] = useState("");
  const [found, setFound] = useState<{ url: string; image: string | null; initial: MealEdit } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const blank: MealEdit = { name_en: "", name_es: "", protein: "veg", ingredients: [] };

  const read = () =>
    startTransition(async () => {
      setError(null);
      const r = await importRecipe(url);
      if (!r.ok) return setError(r.error);
      const name = r.recipe.name;
      setFound({
        url: r.url,
        image: r.recipe.image,
        initial: { name_en: lang === "en" ? name : "", name_es: lang === "es" ? name : "", protein: guessProtein(name, r.recipe.ingredients), ingredients: r.recipe.ingredients },
      });
    });

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 text-sm">
      <div className="flex gap-1">
        {(["link", "hand"] as const).map((m) => (
          <button
            key={m}
            onClick={() => (setMode(m), setFound(null), setError(null))}
            className={cn("rounded-full border px-3 py-1", mode === m ? "border-primary bg-primary text-primary-foreground" : "bg-background")}
          >
            {m === "link" ? t.meals.fromLink : t.meals.byHand}
          </button>
        ))}
      </div>

      {mode === "link" && !found && (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground">{t.meals.linkHelp}</p>
          <div className="flex gap-2">
            <Input
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t.meals.linkPlaceholder}
              aria-label={t.meals.link}
              onKeyDown={(e) => e.key === "Enter" && url.trim() && read()}
            />
            <Button disabled={pending || !url.trim()} onClick={read}>
              {pending ? t.meals.fetching : t.meals.fetch}
            </Button>
          </div>
          {error && <p className="text-destructive">{error}</p>}
          <Button size="sm" variant="ghost" className="self-start" onClick={() => onDone()}>
            {t.meals.cancel}
          </Button>
        </div>
      )}

      {mode === "link" && found && (
        <>
          {found.image && <img src={found.image} alt="" referrerPolicy="no-referrer" className="h-28 w-28 rounded object-cover" />}
          <MealForm
            initial={found.initial}
            onSave={(edit) => createMeal({ ...edit, image: found.image, url: found.url })}
            onDone={(saved, edit) => onDone(saved ? edit.name_en || edit.name_es : undefined)}
          />
        </>
      )}

      {mode === "hand" && (
        <MealForm
          initial={blank}
          onSave={(edit) => createMeal({ ...edit, image: null, url: null })}
          onDone={(saved, edit) => onDone(saved ? edit.name_en || edit.name_es : undefined)}
        />
      )}
      <p className="text-xs text-muted-foreground">{t.meals.newMealNote}</p>
    </div>
  );
}

// A first guess at the group from the recipe's name and ingredients; the owner can change it.
const FISH = /\b(fish|salmon|tuna|cod|hake|prawns?|shrimp|crab|mackerel|sardines?|anchov|pescado|salm[oó]n|at[uú]n|bacalao|merluza|gambas|langostinos|cangrejo)/i;
const MEAT = /\b(chicken|beef|pork|lamb|turkey|bacon|ham|sausages?|chorizo|mince|steak|pollo|ternera|cerdo|cordero|pavo|jam[oó]n|salchichas|carne)/i;
function guessProtein(name: string, ingredients: string[]): Protein {
  const text = `${name} ${ingredients.join(" ")}`;
  return FISH.test(name) ? "fish" : MEAT.test(name) ? "meat" : FISH.test(text) ? "fish" : MEAT.test(text) ? "meat" : "veg";
}
