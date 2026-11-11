import { newIdeaVerdict, normalise, screenMeal, type Status } from "../gluten/gate";
import { isSobras } from "../planner/generate";
import type { SlotPref } from "../planner/slot-pref";
import { guessProtein, type Protein } from "../planner/tags";
import { hasRecipeSchema, parseRecipeHtml } from "./parse";

// New meal ideas from El País's food section: its RSS feed, then each recipe page's
// schema.org Recipe for the ingredients. Everything goes through the gluten gate:
// a recipe with clear gluten (wheat flour, breadcrumbs, couscous, beer...) is left out,
// and the rest come in as "Needs your check" until the household confirms them.
// Any network failure gives { ok: false }; planning carries on without new ideas.

export const ELPAIS_FEED = "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/gastronomia/portada";
export const ELPAIS_SOURCE = "elpais";
export const MAX_NEW = 3;
const MAX_AGE_DAYS = 30;
const MAX_PAGES = 8;
const TIMEOUT_MS = 5000;

export type RssItem = { title: string; link: string; description: string; pubDate: string | null; categories: string[]; image: string | null };

export type Idea = {
  name: string;
  url: string;
  ingredients: string[];
  image: string | null;
  status: Status;
  protein: Protein;
  slotPref: SlotPref;
  published: string | null;
};

export type IdeasResult = { ok: true; ideas: Idea[]; skippedGluten: string[] } | { ok: false; reason: "unreachable" | "bad-feed" };

export type FetchText = (url: string) => Promise<string | null>;

const decode = (s: string) =>
  s
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
};

// Standard RSS 2.0 items. Unknown tags are ignored; an item without a title or link is dropped.
export function parseRss(xml: string): RssItem[] {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
    .map(([, x]) => ({
      title: tag(x, "title"),
      link: tag(x, "link"),
      description: tag(x, "description"),
      pubDate: tag(x, "pubDate") || null,
      categories: [...x.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)].map((m) => decode(m[1])).filter(Boolean),
      image: x.match(/<media:content[^>]*url=["']([^"']+)["']/i)?.[1] ?? x.match(/<enclosure[^>]*url=["']([^"']+)["']/i)?.[1] ?? null,
    }))
    .filter((i) => i.title && i.link);
}

// Only El País pages, over https: the feed must not point the server anywhere else.
export function isElPaisUrl(raw: string) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (u.hostname === "elpais.com" || u.hostname.endsWith(".elpais.com")) && !u.port && !u.username;
  } catch {
    return false;
  }
}

const looksLikeRecipe = (i: RssItem) => /\brecetas?\b/i.test(i.link) || i.categories.some((c) => /\brecetas?\b/i.test(c));

// Sweets, drinks and preserves are not a lunch or a dinner.
const NOT_A_MEAL = /\b(postres?|tartas?|bizcochos?|galletas?|helados?|flan|natillas|magdalenas?|brownies?|cookies?|turron|roscon|panettone|bombones|chocolate|mermeladas?|confitura|cocteles?|cocktails?|bebidas?|batidos?|smoothies?|licor|vermu)\b/;
export const isMeal = (title: string, categories: string[] = []) => !NOT_A_MEAL.test(normalise([title, ...categories].join(" ")));

// "Receta de garbanzos con espinacas" -> "Garbanzos con espinacas".
export function cleanName(title: string) {
  const t = title
    .replace(/\s*[|·–—-]\s*(El País|EL PAÍS|El Comidista).*$/i, "")
    .replace(/^(la\s+)?receta\s+(de|del)\s+/i, "")
    .replace(/^receta:\s*/i, "")
    .replace(/[.:]+$/, "")
    .trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function slotFromText(text: string): SlotPref {
  const t = normalise(text);
  if (/ (desayunos?|brunch|breakfast) /.test(t)) return "breakfast";
  if (/ (cenas?|para cenar) /.test(t)) return "supper";
  return "either";
}

function ageDays(pubDate: string | null, now: Date) {
  const t = pubDate ? Date.parse(pubDate) : NaN;
  return Number.isNaN(t) ? Infinity : (now.getTime() - t) / 86_400_000;
}

export async function defaultFetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FamilyMealPlanner/1.0)", Accept: "application/rss+xml, text/html;q=0.9" },
      cache: "no-store",
    });
    if (!res.ok || !isElPaisUrl(res.url || url)) return null;
    return (await res.text()).slice(0, 3_000_000);
  } catch {
    return null;
  }
}

export async function fetchElPaisIdeas({
  now = new Date(),
  knownUrls = new Set<string>(),
  knownNames = new Set<string>(),
  fetchText = defaultFetchText,
  max = MAX_NEW,
}: {
  now?: Date;
  knownUrls?: Set<string>;
  // Library names, already normalised with the gluten gate's normalise().
  knownNames?: Set<string>;
  fetchText?: FetchText;
  max?: number;
} = {}): Promise<IdeasResult> {
  const xml = await fetchText(ELPAIS_FEED);
  if (xml === null) return { ok: false, reason: "unreachable" };
  if (!/<rss[\s>]|<channel[\s>]/i.test(xml)) return { ok: false, reason: "bad-feed" };

  const names = new Set(knownNames);
  const fresh = parseRss(xml)
    .filter((i) => isElPaisUrl(i.link) && !knownUrls.has(i.link))
    .filter((i) => ageDays(i.pubDate, now) <= MAX_AGE_DAYS && ageDays(i.pubDate, now) > -2)
    .filter((i) => !isSobras(i.title) && isMeal(i.title, i.categories))
    .sort((a, b) => Date.parse(b.pubDate!) - Date.parse(a.pubDate!));
  // Items marked as recipes first; others only if their page turns out to hold a Recipe.
  const candidates = [...fresh.filter(looksLikeRecipe), ...fresh.filter((i) => !looksLikeRecipe(i))].slice(0, MAX_PAGES);
  const pages = await Promise.all(candidates.map((i) => fetchText(i.link).catch(() => null)));

  const ideas: Idea[] = [];
  const skippedGluten: string[] = [];
  candidates.forEach((item, k) => {
    if (ideas.length >= max) return;
    const html = pages[k];
    const structured = html ? hasRecipeSchema(html) : false;
    if (!looksLikeRecipe(item) && !structured) return;
    const recipe = html && structured ? parseRecipeHtml(html, item.link) : null;
    const name = cleanName(recipe?.name || item.title);
    const key = normalise(name).trim();
    if (!key || names.has(key) || isSobras(name) || !isMeal(name)) return;
    const ingredients = recipe?.ingredients ?? [];
    // The gate reads the name, the ingredients, and the summary when there are no ingredients.
    const verdict = screenMeal({ name, ingredients: ingredients.length ? ingredients.join(" · ") : item.description });
    if (verdict.status === "blocked") {
      skippedGluten.push(name);
      return;
    }
    names.add(key);
    ideas.push({
      name,
      url: item.link,
      ingredients,
      image: recipe?.image ?? item.image,
      status: newIdeaVerdict(verdict, false).status,
      protein: guessProtein(name, ingredients),
      slotPref: slotFromText([name, item.title, ...item.categories].join(" ")),
      published: item.pubDate ? new Date(Date.parse(item.pubDate)).toISOString().slice(0, 10) : null,
    });
  });
  return { ok: true, ideas, skippedGluten };
}

// Reads the feed and pages from saved files instead of the network: for tests, and for
// local runs where elpais.com cannot be reached (ELPAIS_FIXTURE_DIR, never in production).
export function fixtureFetchText(read: (file: string) => string | null): FetchText {
  return async (url) => {
    if (url === ELPAIS_FEED) return read("feed.xml");
    const slug = new URL(url).pathname.split("/").pop()?.replace(/\.html$/, "");
    return slug ? read(`${slug}.html`) : null;
  };
}
