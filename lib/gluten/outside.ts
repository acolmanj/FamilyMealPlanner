import { normalise, screenMeal } from "./gate";

// Stricter screening for recipes from outside the household (El País). Nobody here has
// cooked them gluten-free, so any sign of gluten, even one with a GF swap, keeps them
// out of the plan, and so does a recipe whose ingredients we could not read.
//   "gluten"    - any gluten word or swap: not added at all
//   "unchecked" - no ingredient list from the recipe itself: may be listed, never planned
//   "ok"        - ingredients read and nothing found: may be planned, flagged to check

export type OutsideVerdict = "gluten" | "unchecked" | "ok";

// Flour is fine only when the recipe names a gluten-free one.
const GF_FLOUR = "(maiz|arroz|garbanzos?|almendras?|patata|tapioca|yuca|castanas?|coco)";
const WORDS = [
  `harinas?(?! (de )?${GF_FLOUR})`,
  "salsa de soja",
  "soja",
  "pasta(?! de (tomate|pimiento|aceitunas|sesamo))",
  "pastas",
  "espaguetis?",
  "spaghetti",
  "macarrones",
  "macaroni",
  "penne",
  "fusilli",
  "rigatoni",
  "tallarines",
  "tagliatelle",
  "lasagn[ae]",
  "canelones",
  "cannelloni",
  "ravioli",
  "tortellini",
  "lasanas?",
  "fideos?",
  "fideua",
  "avena",
  "picatostes?",
  "masa quebrada",
  "masa brisa",
  "masa de hojaldre",
  "hojaldre",
  "masa de pizza",
  "pan rallado",
  "panko",
  "pan",
  "panes",
  "tostadas?",
  "cuscus",
  "couscous",
  "bulgur",
  "cerveza",
  "trigo",
  "cebada",
  "centeno",
  "espelta",
  "seitan",
  "galletas?",
  "bizcochos?",
  "rebozad[oa]s?",
  "empanad[oa]s?",
  "empanadillas?",
  "tempura",
  "bechamel",
  "croquetas?",
  "noodles",
  "ramen",
  "udon",
  "flour",
  "breadcrumbs",
  "soy sauce",
];
const COVERED = new Set(["gf-flour", "pasta"]);
const GLUTEN = new RegExp(`(?<= )(${WORDS.join("|")})(?= )`);

export function outsideVerdict(name: string, ingredients: string[]): OutsideVerdict {
  const text = [name, ...ingredients].join(" · ");
  if (GLUTEN.test(normalise(text))) return "gluten";
  // Then every other finding of the household gate. Its flour and pasta rules are left to the
  // word list above, which knows the gluten-free flours and tomato paste.
  const gate = screenMeal({ name, ingredients: ingredients.join(" · ") });
  const doubtful = gate.findings.filter((f) => !COVERED.has(f.rule));
  if (doubtful.some((f) => f.status === "blocked" || f.status === "needs_substitution" || f.tier === "A" || f.tier === "B")) return "gluten";
  return ingredients.length ? "ok" : "unchecked";
}

// An El País recipe the household has not confirmed is planned only when its ingredients
// came from the recipe page and show no sign of gluten at all. Checked again when the
// library is loaded, so a row added by an older version or edited since meets the same rule.
export function outsideNoPlan(m: { source: string | null; gf_confirmed_at: string | null; name: string; name_es?: string | null; ingredients_note: string | null }) {
  if (m.source !== "elpais" || m.gf_confirmed_at) return false;
  const lines = (m.ingredients_note ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return outsideVerdict(m.name_es ?? m.name, lines) !== "ok";
}
