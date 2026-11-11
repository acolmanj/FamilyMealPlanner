import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalise } from "../lib/gluten/gate";
import { ELPAIS_FEED, cleanName, fetchElPaisIdeas, fixtureFetchText, isElPaisUrl, isMeal, parseRss, slotFromText } from "../lib/recipes/elpais";

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
    // The recipe page could not be read: added from the feed alone, still to check.
    expect(crema).toMatchObject({ ingredients: [], status: "needs_check" });
    // Not marked as a recipe in the feed, but its page holds a schema.org Recipe.
    expect(pollo).toMatchObject({ protein: "meat", slotPref: "supper" });
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
});
