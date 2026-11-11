// The gluten gate. Pure functions only: same text in, same verdict out.
//
// Source: gluten_list_for_review.md (Tiers A to D) and the owner's answers to its
// questions (11 November 2026): tinned food needs a label check, tinned fish and fish
// pie are safe, anything labelled gluten free (Tesco Free From counts) is safe, tortilla
// chips need a label check, and take-away and eating out are not meals. Nothing here
// can turn a Blocked meal into Safe: a GF label never clears a Tier A item.

export type Tier = "A" | "B" | "C" | "D";

export type Status = "safe" | "needs_substitution" | "needs_check" | "blocked";

export const STATUS_LABEL: Record<Status, string> = {
  safe: "Safe",
  needs_substitution: "Needs substitution",
  needs_check: "Needs your check",
  blocked: "Blocked",
};

// Worst first. A meal takes the worst status of anything found in it.
const SEVERITY: Status[] = ["blocked", "needs_check", "needs_substitution", "safe"];

export type Rule = {
  id: string;
  tier: Tier;
  status: Status;
  // Whole words or phrases, lower case, accents removed. English and Spanish.
  terms: string[];
  // What to do instead, written next to the meal.
  swap?: string;
  // Why it is in this tier or status, in plain words.
  note: string;
};

// Words for a tin, English and Spanish. Tinned food is Tier C (check the label)...
const TIN_WORDS = ["tinned", "canned", "tin", "tins", "lata", "latas", "en lata", "de lata", "de bote", "en conserva", "conserva"];
// ...but tinned fish is safe. Every "tin + fish" phrase, both ways round, is longer than
// the tin word alone, so it wins ("tinned tuna" is safe, "tin of beans" needs a check).
// Brands count as fish here, so "1 tin John West tuna" is tinned fish too.
const FISH = [
  "tuna", "atun", "sardine", "sardines", "sardina", "sardinas", "salmon", "mackerel", "caballa",
  "anchovy", "anchovies", "anchoa", "anchoas", "bonito", "mussels", "mejillones", "berberechos",
  "pilchards", "cockles", "almejas", "fish", "pescado", "john west", "parmentier", "rio mare", "ortiz",
  "princes", "glenryck", "calvo", "isabel", "nixe", "albo",
];
const TIN_BEFORE = ["tinned", "canned", "tin", "tins", "tin of", "tins of", "can of", "cans of", "lata de", "latas de", "conserva de", "bote de"];
const TIN_AFTER = [
  "in oil", "in olive oil", "in sunflower oil", "in water", "in spring water", "in brine",
  "en lata", "de lata", "en conserva", "de bote", "en aceite", "en aceite de oliva", "en aceite de girasol", "al natural",
];
const TINNED_FISH = [...new Set(FISH.flatMap((f) => [...TIN_BEFORE.map((t) => `${t} ${f}`), ...TIN_AFTER.map((t) => `${f} ${t}`)]))];
// Both at once ("1 tin tuna in sunflower oil"), so the "tin" is not left behind on its own.
const alt = (xs: string[]) => [...xs].sort((a, b) => b.length - a.length).join("|");
const TIN_FISH_TIN = new RegExp(` (?:${alt(TIN_BEFORE)}) (?:${alt(FISH)}) (?:${alt(TIN_AFTER)}) `, "g");

// Order matters only for display. Phrases that must not trigger a rule are in NOT_GLUTEN.
export const RULES: Rule[] = [
  // Tier A: never, even in small amounts. Blocked, with a GF swap where one exists.
  {
    id: "ramen",
    tier: "A",
    status: "blocked",
    terms: ["ramen", "udon", "soba", "yakisoba", "fideos chinos"],
    swap: "Use GF-labelled rice noodles, and tamari labelled GF instead of soy sauce",
    note: "Ramen and other wheat noodles are Tier A",
  },
  {
    id: "fideos",
    tier: "A",
    status: "blocked",
    terms: ["fideos", "fideo", "fideua", "vermicelli"],
    swap: "Use GF-labelled fideos, or thin rice vermicelli labelled GF",
    note: "Fideos are Tier A",
  },
  {
    id: "gnocchi",
    tier: "A",
    status: "blocked",
    terms: ["gnocchi", "noquis", "noqui", "gnoquis", "gnoqui", "nocchi"],
    swap: "Use GF-labelled gnocchi, or make them with potato and GF flour",
    note: "Gnocchi are Tier A",
  },
  {
    id: "couscous",
    tier: "A",
    status: "blocked",
    terms: ["couscous", "cuscus", "bulgur", "bulgar", "tabule", "tabbouleh", "freekeh", "farro", "espelta", "spelt", "semolina", "semola", "kamut", "durum", "triticale"],
    swap: "Use quinoa, rice or GF-labelled couscous instead",
    note: "Wheat grains are Tier A",
  },
  {
    id: "barley-rye-malt",
    tier: "A",
    status: "blocked",
    terms: ["barley", "cebada", "rye", "centeno", "malt", "malta", "malt vinegar"],
    swap: "Leave it out, or use rice or a GF-labelled alternative",
    note: "Barley, rye and malt are Tier A",
  },
  {
    id: "seitan",
    tier: "A",
    status: "blocked",
    terms: ["seitan"],
    swap: "Use tofu or tempeh labelled GF",
    note: "Seitan is pure wheat gluten (Tier A)",
  },
  {
    id: "breaded",
    tier: "A",
    status: "blocked",
    terms: ["breadcrumbs", "pan rallado", "panko", "rebozado", "rebozada", "rebozados", "empanado", "empanada", "empanadas", "empanadillas", "batter", "battered", "tempura", "croquetas", "croqueta", "croquettes", "san jacobo", "flamenquin"],
    swap: "Use GF breadcrumbs or a GF-labelled ready-made version",
    note: "Breadcrumbs and batter are Tier A",
  },
  {
    id: "pancakes",
    tier: "A",
    status: "blocked",
    terms: ["pancakes", "pancake", "crepes", "crepe", "tortitas", "blinis", "waffles", "gofres"],
    swap: "Use GF-labelled pancakes, or make them with GF flour",
    note: "Pancakes are Tier A",
  },
  {
    id: "pastry",
    tier: "A",
    status: "blocked",
    terms: ["pastry", "hojaldre", "pie", "pies", "quiche", "cake", "cakes", "bizcocho", "tarta", "magdalenas", "muffins", "brownies", "galletas", "biscuits", "cookies"],
    swap: "Use GF-labelled pastry or a GF-labelled bake",
    note: "Pastry, pies and cakes are Tier A",
  },
  {
    id: "beer",
    tier: "A",
    status: "blocked",
    terms: ["beer", "cerveza", "lager", "ale", "stout", "guinness"],
    swap: "Use a GF-labelled beer, or stock labelled GF",
    note: "Beer, lager, ale and stout are Tier A",
  },
  {
    id: "flour",
    tier: "A",
    status: "blocked",
    terms: ["wheat", "trigo", "harina de trigo", "plain flour", "self raising flour", "bechamel", "besamel", "roux"],
    swap: "Use GF flour or cornflour",
    note: "Wheat flour is Tier A",
  },

  // Tier B: only the product labelled gluten free, same brand and type.
  {
    id: "pasta",
    tier: "B",
    status: "needs_substitution",
    terms: ["pasta", "espaguetis", "espagueti", "spaghetti", "macarrones", "macaroni", "penne", "fusilli", "rigatoni", "tallarines", "tagliatelle", "lasana", "lasagna", "lasagne", "canelones", "cannelloni", "ravioli", "tortellini", "noodles"],
    swap: "GF-labelled pasta (Barilla Gluten Free or Tesco Free From)",
    note: "Pasta is Tier B: GF label only",
  },
  {
    id: "pizza",
    tier: "B",
    status: "needs_substitution",
    terms: ["pizza", "pizzas", "calzone"],
    swap: "GF pizza base (Goodfella's Gluten Free, or a GF-labelled base)",
    note: "Pizza bases are Tier B: GF label only",
  },
  {
    id: "bread",
    tier: "B",
    status: "needs_substitution",
    terms: ["bread", "pan", "tostada", "tostadas", "tosatada", "toast", "tosti", "tostis", "tosties", "toastie", "toasties", "sandwich", "sandwiches", "sandwichs", "bocadillo", "bocadillos", "rolls", "buns", "bollos", "brioche", "bagel", "bagels", "focaccia", "naan", "pitta", "pita", "burrito", "burritos", "wrap", "wraps", "fajitas", "quesadilla", "quesadillas", "tacos", "picatostes", "croutons"],
    swap: "GF-labelled bread or wraps (Promise Gluten Free loaf, Schär rolls)",
    note: "Bread, rolls and wraps are Tier B: GF label only",
  },
  {
    id: "breaded-frozen",
    tier: "B",
    status: "needs_substitution",
    terms: ["fish fingers", "fish finger", "nuggets", "nugget", "breaded fish", "breaded chicken", "chicken tenders", "tenders", "goujons", "palitos de pescado"],
    swap: "GF-labelled version (Birds Eye Gluten Free fish fingers or breaded fillets), or coat at home with GF breadcrumbs",
    note: "Fish fingers, nuggets and breaded chicken are Tier B: GF label only",
  },
  {
    id: "soy",
    tier: "B",
    status: "needs_substitution",
    terms: ["soy sauce", "salsa de soja", "soja", "teriyaki"],
    swap: "Tamari labelled GF (Kikkoman Tamari Gluten Free)",
    note: "Soy sauce is Tier B: use tamari labelled GF",
  },
  {
    id: "cereal",
    tier: "B",
    status: "needs_substitution",
    terms: ["oats", "avena", "porridge", "granola", "muesli", "cereal", "cereales", "weetabix", "corn flakes", "cornflakes"],
    swap: "Certified gluten-free oats or a GF-labelled cereal",
    note: "Oats and cereals are Tier B: GF label only",
  },
  {
    id: "gf-flour",
    tier: "B",
    status: "needs_substitution",
    terms: ["flour", "harina"],
    swap: "GF-labelled flour, or cornflour",
    note: "Flour is Tier B: GF label only",
  },

  // Tier C: check the label. Unreadable labels go to "Needs your check".
  {
    id: "sausages",
    tier: "C",
    status: "needs_check",
    terms: ["sausages", "sausage", "salchichas", "salchicha", "chorizo", "morcilla", "burgers", "burger", "hamburguesa", "amburguesa", "meatballs", "albondigas", "bacon", "beicon", "jamon", "ham", "salami", "salchichon", "lomo embuchado", "cured meat", "hot dog", "hot dogs", "frankfurt"],
    note: "Sausages, burgers, meatballs and cured meats are Tier C: check the label for wheat, barley, rye, oats and \"may contain\"",
  },
  {
    id: "stock",
    tier: "C",
    status: "needs_check",
    terms: ["stock", "caldo", "pastilla de caldo", "stock cube", "stock pot", "gravy", "bovril", "oxo", "knorr", "avecrem"],
    note: "Stock and gravy are Tier C: use a GF-labelled stock or cornflour",
  },
  {
    id: "sauces",
    tier: "C",
    status: "needs_check",
    terms: ["curry", "currys", "curri", "tikka", "masala", "korma", "rogan josh", "jalfrezi", "pesto", "ketchup", "mustard", "mostaza", "mayonesa", "mayonnaise", "bbq", "barbacoa", "sauce", "salsa", "spice mix", "seasoning", "sazonador", "fajita seasoning", "taco seasoning", "chili", "chilli", "worcestershire"],
    note: "Sauces, curry pastes and spice mixes are Tier C: check the label",
  },
  {
    id: "stews-soups",
    tier: "C",
    status: "needs_check",
    terms: ["estofado", "estofada", "guiso", "stew", "sopa", "soup", "crema de", "puchero", "cocido", "fabada", "bourguignon", "bourginon", "risotto", "risoto", "paella", "pisto"],
    note: "Stews, soups, pisto and curries depend on the stock and paste: use a GF-labelled stock and check the paste label",
  },
  {
    id: "tinned",
    tier: "C",
    status: "needs_check",
    terms: ["alubias", "judias", "beans", "haricot", "kidney", "baked beans", "frijoles", ...TIN_WORDS],
    note: "Tinned food is Tier C: check the label",
  },
  {
    id: "ready-meals",
    tier: "C",
    status: "needs_check",
    terms: ["ready meal", "precocinado", "precocinada", "crisps", "patatas fritas de bolsa", "processed cheese", "queso fundido", "chocolate", "sweets", "chuches", "yoghurt with cereal"],
    note: "Ready meals, crisps and processed foods are Tier C: check the label",
  },
  {
    id: "nachos",
    tier: "C",
    status: "needs_check",
    terms: ["nachos", "tortilla chips", "totopos", "doritos"],
    note: "Tortilla chips and nachos: check the label",
  },
  {
    id: "fish-pie",
    tier: "D",
    status: "safe",
    terms: ["pastel de pescado", "fish pie"],
    note: "Fish pie is safe (your answer): thicken the sauce with cornflour, potato topping, no pastry",
    swap: "Thicken the sauce with cornflour; potato topping, no pastry",
  },
  {
    id: "takeaway",
    tier: "C",
    status: "needs_check",
    terms: ["take away", "takeaway", "take-away", "nandos", "eating out", "restaurante", "restaurant", "chipper"],
    note: "Take-away and eating out are not meals, so there is no recipe to check",
  },

  {
    id: "tinned-fish",
    tier: "D",
    status: "safe",
    terms: TINNED_FISH,
    note: "Tinned fish is safe (your answer)",
  },
  // Tier D: naturally gluten-free when plain. Recorded so the screen can say what it recognised.
  {
    id: "naturally-gf",
    tier: "D",
    status: "safe",
    terms: ["lentejas", "lentils", "garbanzos", "chickpeas", "arroz", "rice", "patatas", "patata", "potatoes", "potato", "polenta", "huevos", "huevo", "eggs", "egg", "tortilla de patatas", "salmon", "pescado", "fish", "atun", "tuna", "sardinas", "pollo", "chicken", "cordero", "lamb", "ternera", "beef", "cerdo", "pork", "ensalada", "salad", "verduras", "vegetables", "aguacate", "avocado", "queso", "cheese", "calabaza", "brocoli", "berenjena", "quinoa", "solomillo", "vaca", "steak", "stakes", "chuletas", "pechugas", "alitas", "alcachofas", "boniato", "pure", "zanahoria", "zanahorias", "naranja", "tomate", "tomates", "pepino", "rucula", "espinacas", "champinones", "setas", "calabacin", "pimientos", "cebolla", "ajo", "gengibre", "jengibre", "edamame", "adamame"],
    note: "Naturally gluten-free when plain and fresh",
  },
];

// Phrases that contain a trigger word but are not gluten: removed before matching.
const NOT_GLUTEN = [
  "tortilla de patatas",
  "tortilla de patata",
  "tortilla de berenjena",
  "tortilla de brocoli",
  "tortilla de calabacin",
  "tortilla espanola",
  "spanish omelette",
  "pan de higo",
  "harina de maiz",
  "maicena",
  // A tin to cook in, not tinned food.
  "roasting tin",
  "baking tin",
  "cake tin",
  "loaf tin",
  "muffin tin",
  "tin foil",
];

export function normalise(text: string): string {
  return ` ${text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

export type Finding = {
  rule: string;
  term: string;
  tier: Tier;
  status: Status;
  note: string;
  swap?: string;
};

export type Verdict = {
  status: Status;
  findings: Finding[];
  swaps: string[];
  // Set when the household has confirmed they cook this meal gluten-free.
  confirmed?: boolean;
  // What the gate found before that confirmation.
  screened?: Status;
};

export type ScreenInput = {
  name: string;
  variants?: string[];
  ingredients?: string | null;
  isTakeaway?: boolean;
};

// Longest terms first, so "fish fingers" wins over "fish", "pastel de pescado" over "pescado"
// and "tinned tuna" over "tinned". Whole words, with an optional plural ending
// ("estofada" also finds "estofadas").
const TERMS = RULES.flatMap((r) => r.terms.map((term) => ({ r, term, n: normalise(term) })))
  .sort((a, b) => b.n.length - a.n.length)
  .map((x) => ({ ...x, re: new RegExp(` ${x.n.trim()}(?:s|es)? `, "g") }));

// "Tortilla de patatas" is GF (Tier D) even though "tortilla" wraps are not:
// strip the safe phrases out, then look for whole-word terms.
function matchTerms(text: string): Finding[] {
  let t = normalise(text);
  const findings: Finding[] = [];
  const safeHits: string[] = [];
  for (const phrase of NOT_GLUTEN) {
    const p = normalise(phrase);
    if (t.includes(p)) {
      safeHits.push(phrase);
      t = t.split(p).join(" ");
    }
  }
  const both = t.match(TIN_FISH_TIN);
  if (both) {
    const r = RULES.find((x) => x.id === "tinned-fish")!;
    findings.push({ rule: r.id, term: both[0].trim(), tier: r.tier, status: r.status, note: r.note });
    t = t.replace(TIN_FISH_TIN, "  ");
  }
  for (const { r, term, re } of TERMS) {
    re.lastIndex = 0;
    if (re.test(t)) {
      findings.push({ rule: r.id, term, tier: r.tier, status: r.status, note: r.note, swap: r.swap });
      t = t.replace(re, "  ");
    }
  }
  if (safeHits.some((p) => p.startsWith("tortilla de") || p.startsWith("tortilla esp") || p === "spanish omelette")) {
    const r = RULES.find((x) => x.id === "naturally-gf")!;
    findings.push({ rule: r.id, term: "tortilla de patatas", tier: "D", status: "safe", note: "Spanish omelette, not a wheat tortilla" });
  }
  return findings;
}

// Anything labelled gluten free is safe, and Tesco Free From counts (the owner's answer).
// The label covers the words after "Free From", "gluten free" or "GF", or before "sin gluten",
// up to a comma, a new line, "&", "+", "/" or a joining word, and never past the first item
// the gate would flag: in "GF pasta with sausages" and "GF pasta sausages" only the pasta is
// labelled. A label never clears a Tier A item: "GF ramen" stays Blocked.
const LABELS: { words: string[]; covers: "after" | "before" }[] = [
  { words: ["free", "from", "gluten"], covers: "before" },
  { words: ["sin", "gluten"], covers: "before" },
  { words: ["tesco", "free", "from"], covers: "after" },
  { words: ["free", "from"], covers: "after" },
  { words: ["gluten", "free"], covers: "after" },
  { words: ["gf"], covers: "after" },
];
const JOINERS = new Set(["with", "and", "or", "plus", "con", "y", "o"]);
export const LABELLED_NOTE = "Labelled gluten free (Tesco Free From counts)";

// How many things in these words the gate would not call Safe.
const flagged = (words: string[]) => matchTerms(words.join(" ")).filter((f) => f.status !== "safe").length;

// Takes the labelled words out of one part of a meal, and keeps them in spans.
function unlabel(words: string[], spans: string[]): string[] {
  for (let i = 0; i < words.length; i++) {
    const label = LABELS.find((l) => l.words.every((w, k) => words[i + k] === w));
    if (!label) continue;
    const before = words.slice(0, i);
    const after = words.slice(i + label.words.length);
    // "Pasta GF" or "sin gluten pasta": when nothing is on the usual side, take the other.
    const takeAfter = label.covers === "after" ? after.length > 0 : before.length === 0;
    // The n words next to the label, in reading order.
    const near = (n: number) => (takeAfter ? after.slice(0, n) : before.slice(before.length - n));
    // Walk away from the label and stop before a second flagged item, so one label clears one thing.
    let n = 0;
    while (n < (takeAfter ? after : before).length && flagged(near(n + 1)) <= 1) n++;
    const span = near(n);
    if (!span.length || matchTerms(span.join(" ")).some((f) => f.tier === "A")) return words;
    spans.push(span.join(" "));
    return takeAfter ? [...before, ...unlabel(after.slice(n), spans)] : [...before.slice(0, before.length - n), ...unlabel(after, spans)];
  }
  return words;
}

function findTerms(text: string): Finding[] {
  const spans: string[] = [];
  const rest = text
    .split(/[\n,;·&+/]/)
    .map((piece) => {
      const out: string[] = [];
      let part: string[] = [];
      for (const w of normalise(piece).trim().split(" ").filter(Boolean)) {
        if (JOINERS.has(w)) {
          out.push(...unlabel(part, spans), w);
          part = [];
        } else part.push(w);
      }
      return [...out, ...unlabel(part, spans)].join(" ");
    })
    .join(" · ");
  const findings = matchTerms(rest);
  if (spans.length) findings.push({ rule: "labelled-gf", term: spans.join(", "), tier: "D", status: "safe", note: LABELLED_NOTE });
  return findings;
}

export function screenMeal(input: ScreenInput): Verdict {
  const text = [input.name, ...(input.variants ?? []), input.ingredients ?? ""].join(" · ");
  const findings = dedupe(findTerms(text));
  if (input.isTakeaway && !findings.some((f) => f.rule === "takeaway")) {
    const r = RULES.find((x) => x.id === "takeaway")!;
    findings.push({ rule: r.id, term: "take-away", tier: r.tier, status: r.status, note: r.note });
  }
  if (findings.length === 0) {
    // When unsure, do not include it: a name the gate cannot read is not Safe.
    findings.push({
      rule: "unknown",
      term: input.name,
      tier: "C",
      status: "needs_check",
      note: "The gate recognises nothing in this name. Check what goes in it",
    });
  }
  findings.sort((a, b) => SEVERITY.indexOf(a.status) - SEVERITY.indexOf(b.status));
  const status = findings[0]?.status ?? "safe";
  const swaps = [...new Set(findings.map((f) => f.swap).filter((s): s is string => Boolean(s)))];
  return { status, findings, swaps };
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    if (seen.has(f.rule)) return false;
    seen.add(f.rule);
    return true;
  });
}

// The household knows how they cook a meal; the gate only reads its name.
// A confirmed meal is Safe, but keeps its swaps so the shopping list still buys the GF products.
export function applyConfirmation(verdict: Verdict, confirmed: boolean): Verdict {
  if (!confirmed) return verdict;
  return { ...verdict, status: "safe", confirmed: true, screened: verdict.status };
}

// A recipe from outside (El País) is never Safe until the household confirms it: the gate
// only reads words, and nobody here has cooked it gluten-free yet. Blocked stays blocked.
export function newIdeaVerdict(verdict: Verdict, confirmed: boolean): Verdict {
  if (confirmed) return applyConfirmation(verdict, true);
  if (verdict.status === "safe" || verdict.status === "needs_substitution") return { ...verdict, status: "needs_check", screened: verdict.status };
  return verdict;
}

// The status the app shows for a meal row: screened, then the household's confirmation.
export function mealStatus(m: {
  name: string;
  variants_seen?: string[] | null;
  ingredients_note?: string | null;
  gf_confirmed_at?: string | null;
  source?: string | null;
}): Status {
  const verdict = screenMeal({ name: m.name, variants: m.variants_seen ?? [], ingredients: m.ingredients_note });
  const confirmed = Boolean(m.gf_confirmed_at);
  return (m.source === "elpais" ? newIdeaVerdict(verdict, confirmed) : applyConfirmation(verdict, confirmed)).status;
}
