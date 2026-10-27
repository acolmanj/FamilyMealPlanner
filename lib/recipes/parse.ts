// Reads a recipe web page: the schema.org Recipe that most recipe sites publish
// for search engines, falling back to the page's title and share image.

export type ParsedRecipe = { name: string; ingredients: string[]; image: string | null };

type Json = Record<string, unknown>;

const isRecipe = (x: Json) => {
  const t = x["@type"];
  return t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"));
};

function findRecipe(node: unknown): Json | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipe(n);
      if (r) return r;
    }
    return null;
  }
  const o = node as Json;
  if (isRecipe(o)) return o;
  return findRecipe(o["@graph"]) ?? findRecipe(o.mainEntity);
}

function imageOf(img: unknown): string | null {
  if (!img) return null;
  if (typeof img === "string") return img;
  if (Array.isArray(img)) return imageOf(img[0]);
  if (typeof img === "object") return imageOf((img as Json).url);
  return null;
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

function meta(html: string, prop: string) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
  const m = html.match(re);
  return m ? decode(m[1] ?? m[2] ?? "") : null;
}

function absolute(src: string | null, base: string) {
  if (!src) return null;
  try {
    const u = new URL(src, base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function parseRecipeHtml(html: string, url: string): ParsedRecipe | null {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const r = findRecipe(data);
    if (!r) continue;
    const raw = r.recipeIngredient ?? r.ingredients;
    const ingredients = (Array.isArray(raw) ? raw : []).filter((x): x is string => typeof x === "string").map(decode).filter(Boolean);
    const name = typeof r.name === "string" ? decode(r.name) : "";
    if (name) return { name, ingredients, image: absolute(imageOf(r.image), url) };
  }
  const title = meta(html, "og:title") ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  if (!title) return null;
  return { name: decode(title), ingredients: [], image: absolute(meta(html, "og:image"), url) };
}

// Ingredients are stored one per line. Older meals wrote them on one line with commas.
export function splitIngredients(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\n|,\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
