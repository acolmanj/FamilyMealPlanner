import { normalise } from "../gluten/gate";

// The facts the planner rules need about a meal. Guessed from its name when the
// library has nothing yet; whatever the owner saves on the meal wins.

export type Protein = "meat" | "fish" | "veg";
export type Effort = "quick" | "normal" | "long";
export type Starch = "pasta" | "potatoes" | "rice" | "noodles" | "bread";

export type Tags = {
  protein: Protein;
  starch: Starch | null;
  isPasta: boolean;
  isProcessed: boolean;
  effort: Effort | null;
  isRoast: boolean;
  isPizza: boolean;
  // True for each field that came from the name, not from the library.
  guessed: { protein: boolean; starch: boolean; isPasta: boolean; isProcessed: boolean; effort: boolean };
};

export type MealAttrs = {
  name: string;
  protein?: string | null;
  starch?: string | null;
  is_pasta?: boolean | null;
  is_processed?: boolean | null;
  effort?: string | null;
};

const FISH = [
  "pescado", "salmon", "atun", "merluza", "bacalao", "fish", "cangrejo", "crab", "berdel", "caballa", "mackerel",
  "anchoillas", "anchoas", "anchovies", "gambas", "prawns", "langostinos", "sardinas", "trucha", "lubina", "dorada",
];
const MEAT = [
  "pollo", "chicken", "cordero", "lamb", "cerdo", "pork", "chuletas", "vaca", "ternera", "beef", "carne", "salchichas",
  "sausages", "chorizo", "bacon", "jamon", "albondigas", "bolonesa", "bolognesa", "carbonara", "amburguesas",
  "hamburguesas", "smash burgers", "stakes", "steak", "solomillos", "alitas", "nuggets", "pavo", "turkey", "lomo",
];
const STARCH: [Starch, string[]][] = [
  ["noodles", ["ramen", "fideos", "noodles"]],
  ["pasta", ["pasta", "espaguetis", "spaghetti", "macarrones", "lasana", "lasagne", "gnocchi", "gnoquis", "tortellini"]],
  ["rice", ["arroz", "rice", "risotto", "risoto", "paella"]],
  ["potatoes", ["patatas", "patata", "potatoes", "wedges", "pure de patatas", "tortilla de patatas", "tortilla rapida de patatas", "chips"]],
  ["bread", ["tostada", "tostadas", "tosatada", "tostis", "tosties", "burgers", "amburguesas", "fajitas", "wraps", "pizza", "bunsens"]],
];
const PROCESSED = ["fish fingers", "nuggets", "chicken tenders", "salchichas", "sausages", "fish burgers", "croquetas", "ready meal"];
const QUICK = ["ensalada verde", "tostada", "tostadas", "tosatada", "tostis", "tosties", "fish fingers", "salchichas", "sausages", "chicken tenders", "nachos", "pesto"];
const LONG = ["asado", "asada", "roast", "estofado", "estofadas", "bourginon", "bourguignon", "rogan josh", "chili", "pastel"];
const ROAST = ["asado", "asada", "roast"];

function has(text: string, terms: string[]) {
  return terms.some((t) => text.includes(normalise(t)));
}

export function guessTags(name: string): Omit<Tags, "guessed"> {
  const t = normalise(name);
  const protein: Protein = has(t, FISH) ? "fish" : has(t, MEAT) ? "meat" : "veg";
  const starch = STARCH.find(([, terms]) => has(t, terms))?.[0] ?? null;
  const effort: Effort | null = has(t, LONG) ? "long" : has(t, QUICK) ? "quick" : null;
  return {
    protein,
    starch,
    isPasta: starch === "pasta",
    isProcessed: has(t, PROCESSED),
    effort,
    isRoast: has(t, ROAST),
    isPizza: has(t, ["pizza"]),
  };
}

const PROTEINS = ["meat", "fish", "veg"];
const EFFORTS = ["quick", "normal", "long"];

export function mealTags(meal: MealAttrs): Tags {
  const g = guessTags(meal.name);
  const protein = PROTEINS.includes(meal.protein ?? "") ? (meal.protein as Protein) : null;
  const effort = EFFORTS.includes(meal.effort ?? "") ? (meal.effort as Effort) : null;
  const starch = meal.starch ? (meal.starch === "none" ? null : (meal.starch as Starch)) : undefined;
  return {
    protein: protein ?? g.protein,
    starch: starch === undefined ? g.starch : starch,
    isPasta: meal.is_pasta ?? g.isPasta,
    isProcessed: meal.is_processed ?? g.isProcessed,
    effort: effort ?? g.effort,
    isRoast: g.isRoast,
    isPizza: g.isPizza,
    guessed: {
      protein: !protein,
      starch: !meal.starch,
      isPasta: meal.is_pasta == null,
      isProcessed: meal.is_processed == null,
      effort: !effort,
    },
  };
}
