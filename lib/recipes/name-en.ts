// A best-effort English name for a Spanish dish title, from a small word list:
// "Garbanzos con espinacas y huevo" -> "Chickpeas with spinach and egg".
// If any word is not in the list, the Spanish title is kept as it is.

const NOUNS: Record<string, string> = {
  acelgas: "chard",
  aguacate: "avocado",
  ajo: "garlic",
  albondigas: "meatballs",
  alcachofas: "artichokes",
  almejas: "clams",
  alubias: "beans",
  arroz: "rice",
  atun: "tuna",
  bacalao: "cod",
  berenjenas: "aubergines",
  berenjena: "aubergine",
  boniato: "sweet potato",
  brocoli: "broccoli",
  calabacin: "courgette",
  calabaza: "pumpkin",
  caldo: "broth",
  calamares: "squid",
  carne: "meat",
  cebolla: "onion",
  cerdo: "pork",
  champinones: "mushrooms",
  chorizo: "chorizo",
  coliflor: "cauliflower",
  cordero: "lamb",
  crema: "soup",
  ensalada: "salad",
  espinacas: "spinach",
  estofado: "stew",
  gambas: "prawns",
  garbanzos: "chickpeas",
  guisantes: "peas",
  guiso: "stew",
  habas: "broad beans",
  huevo: "egg",
  huevos: "eggs",
  jamon: "ham",
  judias: "beans",
  langostinos: "king prawns",
  lentejas: "lentils",
  limon: "lemon",
  lomo: "pork loin",
  lubina: "sea bass",
  mejillones: "mussels",
  merluza: "hake",
  patatas: "potatoes",
  patata: "potato",
  pavo: "turkey",
  pescado: "fish",
  pimientos: "peppers",
  pimiento: "pepper",
  pisto: "ratatouille",
  pollo: "chicken",
  puerros: "leeks",
  pure: "mash",
  queso: "cheese",
  salmon: "salmon",
  salsa: "sauce",
  sardinas: "sardines",
  setas: "mushrooms",
  sopa: "soup",
  ternera: "beef",
  tomate: "tomato",
  tomates: "tomatoes",
  tortilla: "omelette",
  verduras: "vegetables",
  zanahorias: "carrots",
  zanahoria: "carrot",
};

const ADJECTIVES: Record<string, string> = {
  asado: "roast",
  asada: "roasted",
  asados: "roast",
  asadas: "roasted",
  "al horno": "baked",
  "a la plancha": "grilled",
  "al ajillo": "garlic",
  "a la cazuela": "casseroled",
  estofado: "stewed",
  estofada: "stewed",
  estofados: "stewed",
  estofadas: "stewed",
  frito: "fried",
  frita: "fried",
  fritos: "fried",
  fritas: "fried",
  guisado: "stewed",
  guisada: "stewed",
  guisados: "stewed",
  guisadas: "stewed",
  picante: "spicy",
  rellenos: "stuffed",
  rellenas: "stuffed",
  relleno: "stuffed",
  rellena: "stuffed",
  salteado: "stir-fried",
  salteada: "stir-fried",
  salteados: "stir-fried",
  salteadas: "stir-fried",
  verde: "green",
  frescas: "fresh",
  frescos: "fresh",
  fresco: "fresh",
  fresca: "fresh",
};

const JOINS: Record<string, string> = { con: "with", y: "and", e: "and", en: "in" };

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// One part with no joining word: "crema de calabaza asada", "pollo al ajillo".
function part(words: string[]): string | null {
  let rest = words.join(" ");
  const adjs: string[] = [];
  // Adjectives come after the noun in Spanish; peel them off the end, longest first.
  const keys = Object.keys(ADJECTIVES).sort((a, b) => b.length - a.length);
  for (let found = true; found && rest; ) {
    found = false;
    for (const k of keys) {
      if (rest === k || rest.endsWith(` ${k}`)) {
        adjs.unshift(ADJECTIVES[k]);
        rest = rest.slice(0, rest.length - k.length).trim();
        found = true;
        break;
      }
    }
  }
  // "crema de calabaza" -> "pumpkin soup"; "salsa de tomate" -> "tomato sauce".
  const nouns = rest.split(/ (?:de|del|de la) /).map((n) => NOUNS[n]);
  if (!rest || nouns.some((n) => !n)) return null;
  return [...adjs, ...nouns.reverse()].join(" ");
}

export function englishName(spanish: string): string {
  const words = plain(spanish).replace(/[^a-z ]+/g, " ").trim().split(/\s+/);
  const out: string[] = [];
  let current: string[] = [];
  for (const w of words) {
    if (JOINS[w] && current.length) {
      const p = part(current);
      if (!p) return spanish;
      out.push(p, JOINS[w]);
      current = [];
    } else current.push(w);
  }
  const last = part(current);
  if (!last) return spanish;
  out.push(last);
  const en = out.join(" ").replace(/\s+/g, " ");
  return en.charAt(0).toUpperCase() + en.slice(1);
}
