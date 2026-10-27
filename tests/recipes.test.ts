import { describe, expect, it } from "vitest";
import { parseRecipeHtml, splitIngredients } from "../lib/recipes/parse";

const page = (ld: unknown, head = "") =>
  `<html><head>${head}<script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`;

describe("recipe links", () => {
  it("reads a schema.org Recipe inside an @graph", () => {
    const html = page({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebPage", name: "Page" },
        {
          "@type": ["Recipe"],
          name: "Chickpea &amp; spinach curry",
          recipeIngredient: ["400g tin chickpeas", " 1 onion, chopped ", ""],
          image: [{ "@type": "ImageObject", url: "/img/curry.jpg" }],
        },
      ],
    });
    expect(parseRecipeHtml(html, "https://example.com/recipes/curry")).toEqual({
      name: "Chickpea & spinach curry",
      ingredients: ["400g tin chickpeas", "1 onion, chopped"],
      image: "https://example.com/img/curry.jpg",
    });
  });

  it("falls back to the page title and share image when there is no recipe data", () => {
    const html = `<html><head><meta property="og:title" content="Lentil soup"><meta property="og:image" content="https://cdn.example.com/soup.jpg"></head></html>`;
    expect(parseRecipeHtml(html, "https://example.com/soup")).toEqual({ name: "Lentil soup", ingredients: [], image: "https://cdn.example.com/soup.jpg" });
  });

  it("skips broken JSON and finds nothing on an empty page", () => {
    expect(parseRecipeHtml(`<script type="application/ld+json">{oops</script>`, "https://example.com")).toBeNull();
  });

  it("splits stored ingredients by line, and old comma lists, keeping decimal commas", () => {
    expect(splitIngredients("1,5 kg patatas, 2 cebollas\n sal ")).toEqual(["1,5 kg patatas", "2 cebollas", "sal"]);
    expect(splitIngredients(null)).toEqual([]);
  });
});
