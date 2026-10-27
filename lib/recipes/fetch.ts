import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { parseRecipeHtml, type ParsedRecipe } from "./parse";

// Fetches a recipe page the owner pasted. Only public http(s) addresses: the server
// must never be pointed at itself or at a private network.

const MAX_BYTES = 3_000_000;

function isPrivate(ip: string) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivate(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function publicUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password || (u.port && u.port !== "80" && u.port !== "443")) return null;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0 || addrs.some((a) => isPrivate(a.address))) return null;
  return u;
}

async function readCapped(res: Response) {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export type FetchResult = { ok: true; recipe: ParsedRecipe; url: string } | { ok: false; reason: "bad-url" | "unreachable" | "no-recipe" };

export async function fetchRecipe(raw: string): Promise<FetchResult> {
  let url = await publicUrl(raw);
  if (!url) return { ok: false, reason: "bad-url" };

  // TheMealDB pages have an API; use it rather than the page.
  const mealdb = url.hostname.endsWith("themealdb.com") && url.pathname.match(/\/meal\/(\d+)/);
  if (mealdb) {
    const res = await fetch(`https://www.themealdb.com/api/json/v1/1/lookup.php?i=${mealdb[1]}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    const m = ((await res?.json().catch(() => null)) as { meals?: Record<string, string | null>[] } | null)?.meals?.[0];
    if (!m) return { ok: false, reason: "unreachable" };
    const ingredients: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const n = m[`strIngredient${i}`]?.trim();
      if (n) ingredients.push([m[`strMeasure${i}`]?.trim(), n].filter(Boolean).join(" "));
    }
    return { ok: true, url: url.toString(), recipe: { name: m.strMeal ?? "", ingredients, image: m.strMealThumb ? `${m.strMealThumb}/small` : null } };
  }

  // Follow redirects by hand so each hop is checked too.
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FamilyMealPlanner/1.0)", Accept: "text/html" },
    }).catch(() => null);
    if (!res) return { ok: false, reason: "unreachable" };
    const next = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && next) {
      url = await publicUrl(new URL(next, url).toString());
      if (!url) return { ok: false, reason: "bad-url" };
      continue;
    }
    if (!res.ok) return { ok: false, reason: "unreachable" };
    const recipe = parseRecipeHtml(await readCapped(res), url.toString());
    return recipe ? { ok: true, recipe, url: url.toString() } : { ok: false, reason: "no-recipe" };
  }
  return { ok: false, reason: "unreachable" };
}
