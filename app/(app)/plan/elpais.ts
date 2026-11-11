import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalise } from "@/lib/gluten/gate";
import { ELPAIS_SOURCE, defaultFetchText, fetchElPaisIdeas, fixtureFetchText, type FetchText } from "@/lib/recipes/elpais";
import type { createClient } from "@/lib/supabase/server";

// Adds new El País recipes to the meal library, at most once every few hours.
// A failure is remembered for a shorter time, so a later tap tries again.

type Supabase = Awaited<ReturnType<typeof createClient>>;
// `unread`: added without an ingredient list from the recipe page, so never planned.
export type ElPaisOutcome = { status: "added" | "recent" | "down"; added: string[]; unread: number; skippedGluten: number };

const FEED = "elpais";
const FRESH_MS = 6 * 3_600_000;
const RETRY_MS = 30 * 60_000;

// Saved pages for local runs where elpais.com cannot be reached. Never used in production.
function fetcher(): FetchText {
  const dir = process.env.NODE_ENV !== "production" ? process.env.ELPAIS_FIXTURE_DIR : undefined;
  if (!dir) return defaultFetchText;
  return fixtureFetchText((f) => {
    try {
      return readFileSync(join(process.cwd(), dir, f.replace(/[^a-z0-9.-]/gi, "")), "utf8");
    } catch {
      return null;
    }
  });
}

export async function addElPaisIdeas(supabase: Supabase, householdId: string, now = new Date()): Promise<ElPaisOutcome> {
  const { data: check } = await supabase
    .from("feed_checks")
    .select("checked_at, ok")
    .eq("household_id", householdId)
    .eq("feed", FEED)
    .maybeSingle();
  if (check) {
    const age = now.getTime() - Date.parse(check.checked_at);
    if (check.ok && age < FRESH_MS) return { status: "recent", added: [], unread: 0, skippedGluten: 0 };
    if (!check.ok && age < RETRY_MS) return { status: "down", added: [], unread: 0, skippedGluten: 0 };
  }

  // Every meal ever added, retired or not, so a recipe is never added twice.
  const { data: known } = await supabase
    .from("meals")
    .select("name, name_group, name_en, name_es, source_url")
    .eq("household_id", householdId)
    .returns<{ name: string; name_group: string; name_en: string | null; name_es: string | null; source_url: string | null }[]>();
  const knownNames = new Set(
    (known ?? []).flatMap((m) => [m.name, m.name_group, m.name_en, m.name_es]).filter((n): n is string => Boolean(n)).map((n) => normalise(n).trim()),
  );
  const knownUrls = new Set((known ?? []).map((m) => m.source_url).filter((u): u is string => Boolean(u)));

  const result = await fetchElPaisIdeas({ now, knownNames, knownUrls, fetchText: fetcher() });
  await supabase
    .from("feed_checks")
    .upsert({ household_id: householdId, feed: FEED, checked_at: now.toISOString(), ok: result.ok }, { onConflict: "household_id,feed" });
  if (!result.ok) return { status: "down", added: [], unread: 0, skippedGluten: 0 };

  const added: string[] = [];
  let unread = 0;
  for (const idea of result.ideas) {
    const { error } = await supabase.from("meals").insert({
      household_id: householdId,
      name: idea.name,
      name_group: idea.name,
      name_es: idea.name,
      name_en: idea.nameEn,
      variants_seen: [idea.name],
      ingredients_note: idea.ingredients.length ? idea.ingredients.join("\n") : null,
      protein: idea.protein,
      slot_preference: idea.slotPref,
      source: ELPAIS_SOURCE,
      source_url: idea.url,
      recipe_source: idea.url,
      // Not confirmed gluten-free: it shows "New · check gluten" until the household says so.
      // With no ingredient list from the recipe page, ingredients_note stays empty and the
      // planner never picks it (see week/load.ts).
      gf_confirmed_at: null,
      ...(idea.image ? { image_url: idea.image, image_source: "web", image_page_url: idea.url, image_checked_at: now.toISOString() } : {}),
    });
    if (error) continue;
    added.push(idea.name);
    if (!idea.checked) unread++;
  }
  return { status: "added", added, unread, skippedGluten: result.skippedGluten.length };
}
