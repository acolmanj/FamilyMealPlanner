import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalise } from "../lib/gluten/gate";
import { outsideNoPlan, outsideVerdict } from "../lib/gluten/outside";
import { ELPAIS_FEED, cleanName, decode, defaultFetchText, fetchElPaisIdeas, fixtureFetchText, isElPaisUrl, isMeal, parseRss, slotFromText } from "../lib/recipes/elpais";
import { englishName } from "../lib/recipes/name-en";

const dir = join(__dirname, "fixtures/elpais");
const read = (f: string) => {
  try {
    return readFileSync(join(dir, f), "utf8");
  } catch {
    return null;
  }
};
const fixtures = fixtureFetchText(read);
const NOW = new Date("2026-11-11T08:00:00Z");

describe("El País feed", () => {
  it("reads the RSS items: title, link, summary, date, categories and photo", () => {
    const items = parseRss(read("feed.xml")!);
    expect(items).toHaveLength(10);
    expect(items[0]).toEqual({
      title: "Receta de garbanzos con espinacas y huevo",
      link: "https://elpais.com/gastronomia/recetas/2026-11-09/garbanzos-con-espinacas-y-huevo.html",
      description: "Un guiso de cuchara rápido, con garbanzos cocidos, espinacas y un huevo escalfado por encima.",
      pubDate: "Mon, 09 Nov 2026 05:30:00 +0000",
      categories: ["Recetas", "Legumbres"],
      image: "https://imagenes.elpais.com/resizer/v2/garbanzos.jpg",
    });
  });

  it("adds up to 3 recent recipes, newest first, through the gluten gate", async () => {
    const r = await fetchElPaisIdeas({ now: NOW, fetchText: fixtures, knownNames: new Set([normalise("Lentejas estofadas").trim()]) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ideas.map((i) => i.name)).toEqual(["Garbanzos con espinacas y huevo", "Crema de calabaza asada", "Pollo al ajillo con patatas"]);
    // Clear gluten (wheat flour, breadcrumbs) is left out, and said so.
    expect(r.skippedGluten).toEqual(["Merluza en salsa verde con almejas", "Albóndigas en salsa de tomate"]);
    const [garbanzos, crema, pollo] = r.ideas;
    expect(garbanzos).toMatchObject({
      url: "https://elpais.com/gastronomia/recetas/2026-11-09/garbanzos-con-espinacas-y-huevo.html",
      protein: "veg",
      slotPref: "either",
      published: "2026-11-09",
      status: "needs_check",
    });
    expect(garbanzos.ingredients).toContain("400 g de garbanzos cocidos");
    expect(garbanzos.checked).toBe(true);
    expect(garbanzos.nameEn).toBe("Chickpeas with spinach and egg");
    // The recipe page could not be read: added from the feed alone, flagged, never planned.
    expect(crema).toMatchObject({ ingredients: [], status: "needs_check", checked: false, nameEn: "Roasted pumpkin soup" });
    // Not marked as a recipe in the feed, but its page holds a schema.org Recipe.
    expect(pollo).toMatchObject({ protein: "meat", slotPref: "supper", checked: true, nameEn: "Garlic chicken with potatoes" });
    // The gate alone finds nothing in it, but an outside recipe is never Safe until confirmed.
    expect(pollo.status).toBe("needs_check");
  });

  it("never adds Sobras, desserts, articles, old recipes or ones already in the library", async () => {
    const r = await fetchElPaisIdeas({ now: NOW, fetchText: fixtures, max: 10 });
    if (!r.ok) throw new Error("feed");
    const names = r.ideas.map((i) => i.name.toLowerCase());
    expect(names.some((n) => n.includes("sobras"))).toBe(false);
    expect(names.some((n) => n.includes("tarta"))).toBe(false);
    expect(names.some((n) => n.includes("cocidos"))).toBe(false);
    expect(names.some((n) => n.includes("arroz"))).toBe(false); // September, over 30 days old
    const known = await fetchElPaisIdeas({
      now: NOW,
      fetchText: fixtures,
      knownUrls: new Set(["https://elpais.com/gastronomia/recetas/2026-11-09/garbanzos-con-espinacas-y-huevo.html"]),
      knownNames: new Set([normalise("Crema de calabaza asada").trim()]),
    });
    if (!known.ok) throw new Error("feed");
    expect(known.ideas.map((i) => i.name)).toEqual(["Lentejas estofadas", "Pollo al ajillo con patatas"]);
  });

  it("gives up quietly when El País cannot be reached or sends something else", async () => {
    expect(await fetchElPaisIdeas({ now: NOW, fetchText: async () => null })).toEqual({ ok: false, reason: "unreachable" });
    expect(await fetchElPaisIdeas({ now: NOW, fetchText: async () => "<html>Access denied</html>" })).toEqual({ ok: false, reason: "bad-feed" });
    // The feed answers but every recipe page fails: ideas still come from the feed.
    const feedOnly = await fetchElPaisIdeas({ now: NOW, fetchText: async (u) => (u === ELPAIS_FEED ? read("feed.xml") : null) });
    expect(feedOnly.ok && feedOnly.ideas.length).toBe(3);
    const throwing = await fetchElPaisIdeas({ now: NOW, fetchText: async (u) => (u === ELPAIS_FEED ? read("feed.xml") : Promise.reject(new Error("timeout"))) });
    expect(throwing.ok).toBe(true);
  });

  it("only follows links to El País over https", async () => {
    expect(isElPaisUrl("https://elpais.com/gastronomia/recetas/x.html")).toBe(true);
    expect(isElPaisUrl("https://cat.elpais.com/x")).toBe(true);
    expect(isElPaisUrl("http://elpais.com/x")).toBe(false);
    expect(isElPaisUrl("https://elpais.com.evil.example/x")).toBe(false);
    expect(isElPaisUrl("https://169.254.169.254/latest")).toBe(false);
    const feed = read("feed.xml")!.replace(/https:\/\/elpais\.com\/gastronomia\/recetas\/2026-11-09/g, "https://127.0.0.1/recetas/2026-11-09");
    const seen: string[] = [];
    await fetchElPaisIdeas({ now: NOW, fetchText: async (u) => (seen.push(u), u === ELPAIS_FEED ? feed : null) });
    expect(seen.some((u) => u.includes("127.0.0.1"))).toBe(false);
  });

  it("tidies names and reads the slot from the words", () => {
    expect(cleanName("Receta de garbanzos con espinacas | EL PAÍS")).toBe("Garbanzos con espinacas");
    expect(cleanName("la receta del cocido.")).toBe("Cocido");
    expect(slotFromText("Huevos rotos para el desayuno")).toBe("breakfast");
    expect(slotFromText("Una crema para cenar")).toBe("supper");
    expect(slotFromText("Lentejas con chorizo")).toBe("either");
    expect(isMeal("Tarta de queso")).toBe(false);
    expect(isMeal("Merluza al vino blanco")).toBe(true);
    expect(isMeal("Pastel de pescado")).toBe(true);
  });

  it("reads numeric, hex and named accent entities, and CDATA anywhere", () => {
    expect(decode("Alb&#xF3;ndigas &amp; m&aacute;s")).toBe("Albóndigas & más");
    expect(decode("&iquest;Lentejas? &iexcl;S&iacute;! Pi&ntilde;a, ping&uuml;ino, caf&eacute;, ma&iacute;z, at&uacute;n, mel&oacute;n")).toBe(
      "¿Lentejas? ¡Sí! Piña, pingüino, café, maíz, atún, melón",
    );
    expect(decode("Crema &#225;rabe &#xe9;")).toBe("Crema árabe é");
    expect(decode("Antes <![CDATA[de <b>la</b> cena]]> y despu&eacute;s")).toBe("Antes de la cena y después");
    expect(decode("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;");
    expect(decode("&unknown; ok")).toBe("&unknown; ok");
    const items = parseRss(`<rss><channel><item>
      <title>Receta de <![CDATA[alb&oacute;ndigas]]> con pur&#xE9;</title>
      <link><![CDATA[https://elpais.com/gastronomia/recetas/x.html]]></link>
      <description>&lt;p&gt;Para cenar&lt;/p&gt;</description>
    </item></channel></rss>`);
    expect(items[0]).toMatchObject({ title: "Receta de albóndigas con puré", link: "https://elpais.com/gastronomia/recetas/x.html", description: "Para cenar" });
  });

  it("follows a redirect only to another El País address, and only a few times", async () => {
    const calls: string[] = [];
    const fake = (routes: Record<string, { status: number; location?: string; body?: string }>) =>
      (async (u: string | URL | Request, init?: RequestInit) => {
        calls.push(String(u));
        expect(init?.redirect).toBe("manual");
        const r = routes[String(u)] ?? { status: 404 };
        return new Response(r.body ?? null, { status: r.status, headers: r.location ? { location: r.location } : {} });
      }) as typeof fetch;
    const ok = fake({
      "https://elpais.com/a": { status: 301, location: "/b" },
      "https://elpais.com/b": { status: 302, location: "https://cat.elpais.com/c" },
      "https://cat.elpais.com/c": { status: 200, body: "<rss></rss>" },
    });
    expect(await defaultFetchText("https://elpais.com/a", ok)).toBe("<rss></rss>");
    calls.length = 0;
    const away = fake({ "https://elpais.com/a": { status: 302, location: "http://169.254.169.254/latest" } });
    expect(await defaultFetchText("https://elpais.com/a", away)).toBeNull();
    expect(calls).toEqual(["https://elpais.com/a"]);
    const loop = fake({ "https://elpais.com/a": { status: 302, location: "https://elpais.com/a" } });
    calls.length = 0;
    expect(await defaultFetchText("https://elpais.com/a", loop)).toBeNull();
    expect(calls.length).toBe(4);
    expect(await defaultFetchText("https://example.com/", ok)).toBeNull();
  });

  it("gives a best-effort English name, or keeps the Spanish one", () => {
    expect(englishName("Merluza en salsa verde con almejas")).toBe("Hake in green sauce with clams");
    expect(englishName("Lentejas estofadas")).toBe("Stewed lentils");
    expect(englishName("Estofado de ternera")).toBe("Beef stew");
    expect(englishName("Pollo al horno con patatas")).toBe("Baked chicken with potatoes");
    expect(englishName("Marmitako de bonito")).toBe("Marmitako de bonito");
    expect(englishName("Pisto manchego")).toBe("Pisto manchego");
  });
});

describe("gluten in outside recipes", () => {
  const withIngredient = (line: string) => outsideVerdict("Guiso de la casa", ["2 patatas", line, "Sal"]);
  it.each([
    "1 cucharada de harina",
    "50 g de harinas variadas",
    "harina de trigo",
    "30 ml de salsa de soja",
    "200 g de pasta corta",
    "Láminas de lasaña",
    "100 g de fideos finos",
    "40 g de copos de avena",
    "Picatostes",
    "1 lámina de masa quebrada",
    "1 lámina de masa brisa",
    "Pan rallado",
    "Un trozo de pan del día anterior",
    "1 lámina de hojaldre",
    "Cuscús",
    "Una cerveza",
    "Tostadas",
    "200 g de macarrones",
    "Espaguetis",
    "Canelones",
  ])("leaves out a recipe with %s", (line) => {
    expect(withIngredient(line)).toBe("gluten");
  });

  it.each(["2 cucharadas de harina de maíz", "Harina de arroz", "harina de garbanzo", "Harina de almendra", "Harina de garbanzos", "Pasta de tomate", "Una pizca de pimentón", "Panceta"])(
    "keeps a recipe with %s",
    (line) => {
      expect(withIngredient(line)).toBe("ok");
    },
  );

  it("looks at the name too, and needs the recipe's own ingredient list", () => {
    expect(outsideVerdict("Lasaña de verduras", [])).toBe("gluten");
    expect(outsideVerdict("Fideuá de marisco", ["Gambas"])).toBe("gluten");
    expect(outsideVerdict("Crema de calabaza asada", [])).toBe("unchecked");
    expect(outsideVerdict("Pollo al ajillo con patatas", ["1 pollo", "6 dientes de ajo"])).toBe("ok");
  });

  it("is checked again when the library loads: unread or doubtful ideas are never planned", () => {
    const row = { source: "elpais", gf_confirmed_at: null, name: "Pollo al ajillo", name_es: "Pollo al ajillo", ingredients_note: "1 pollo\n6 dientes de ajo" };
    expect(outsideNoPlan(row)).toBe(false);
    expect(outsideNoPlan({ ...row, ingredients_note: null })).toBe(true);
    expect(outsideNoPlan({ ...row, ingredients_note: "1 pollo\n1 cucharada de harina" })).toBe(true);
    expect(outsideNoPlan({ ...row, ingredients_note: "1 pollo\n2 cucharadas de salsa de soja" })).toBe(true);
    // Once the household confirms it, it is planned like any other meal.
    expect(outsideNoPlan({ ...row, ingredients_note: null, gf_confirmed_at: "2026-11-10" })).toBe(false);
    expect(outsideNoPlan({ ...row, source: "menu_sheet", ingredients_note: null })).toBe(false);
  });
});
