import type { Lang } from "../i18n/messages";
import type { Finding, Verdict } from "./gate";

// The gate's notes and swaps in Spanish, by rule id. The gate itself stays in English.
const ES: Record<string, { note: string; swap?: string }> = {
  ramen: { note: "El ramen y otros fideos de trigo son Nivel A", swap: "Usa fideos de arroz etiquetados sin gluten, y tamari sin gluten en vez de salsa de soja" },
  fideos: { note: "Los fideos son Nivel A", swap: "Usa fideos etiquetados sin gluten, o fideos finos de arroz sin gluten" },
  gnocchi: { note: "Los ñoquis son Nivel A", swap: "Usa ñoquis etiquetados sin gluten, o hazlos con patata y harina sin gluten" },
  couscous: { note: "Los cereales de trigo son Nivel A", swap: "Usa quinoa, arroz o cuscús etiquetado sin gluten" },
  "barley-rye-malt": { note: "La cebada, el centeno y la malta son Nivel A", swap: "Quítalo, o usa arroz o una alternativa etiquetada sin gluten" },
  seitan: { note: "El seitán es gluten de trigo puro (Nivel A)", swap: "Usa tofu o tempeh etiquetados sin gluten" },
  breaded: { note: "El pan rallado y el rebozado son Nivel A", swap: "Usa pan rallado sin gluten o una versión preparada etiquetada sin gluten" },
  pancakes: { note: "Las tortitas son Nivel A", swap: "Usa tortitas etiquetadas sin gluten, o hazlas con harina sin gluten" },
  pastry: { note: "La masa, los pasteles y las tartas son Nivel A", swap: "Usa masa etiquetada sin gluten o un horneado sin gluten" },
  beer: { note: "La cerveza es Nivel A", swap: "Usa cerveza etiquetada sin gluten, o caldo sin gluten" },
  flour: { note: "La harina de trigo es Nivel A", swap: "Usa harina sin gluten o maicena" },
  pasta: { note: "La pasta es Nivel B: solo con etiqueta sin gluten", swap: "Pasta etiquetada sin gluten (Barilla Gluten Free, o Tesco Free From con declaración sin gluten)" },
  pizza: { note: "Las bases de pizza son Nivel B: solo con etiqueta sin gluten", swap: "Base de pizza sin gluten (Goodfella's Gluten Free, o una base etiquetada sin gluten)" },
  bread: { note: "El pan, los panecillos y los wraps son Nivel B: solo con etiqueta sin gluten", swap: "Pan o wraps etiquetados sin gluten (pan Promise Gluten Free, panecillos Schär)" },
  "breaded-frozen": {
    note: "Los palitos de pescado, nuggets y pollo rebozado son Nivel B: solo con etiqueta sin gluten",
    swap: "Versión etiquetada sin gluten (palitos o filetes rebozados Birds Eye Gluten Free), o rebózalos en casa con pan rallado sin gluten",
  },
  soy: { note: "La salsa de soja es Nivel B: usa tamari sin gluten", swap: "Tamari etiquetado sin gluten (Kikkoman Tamari Gluten Free)" },
  cereal: { note: "La avena y los cereales son Nivel B: solo con etiqueta sin gluten", swap: "Avena certificada sin gluten o cereales etiquetados sin gluten" },
  "gf-flour": { note: "La harina es Nivel B: solo con etiqueta sin gluten", swap: "Harina etiquetada sin gluten, o maicena" },
  sausages: { note: "Las salchichas, hamburguesas, albóndigas y embutidos son Nivel C: mira en la etiqueta trigo, cebada, centeno, avena y \"puede contener\"" },
  stock: { note: "El caldo y la salsa de asado son Nivel C: usa caldo etiquetado sin gluten o maicena" },
  sauces: { note: "Las salsas, pastas de curry y mezclas de especias son Nivel C: mira la etiqueta" },
  "stews-soups": { note: "Los guisos, sopas, pisto y risotto dependen del caldo y el espesante (pregunta 5): hasta que respondas, necesitan caldo sin gluten y tu revisión" },
  "tinned-beans": { note: "Las alubias de bote van a \"Revísala tú\" hasta que respondas la pregunta 1" },
  "ready-meals": { note: "Los platos preparados, patatas fritas de bolsa y procesados son Nivel C: mira la etiqueta" },
  nachos: { note: "Los nachos aún no están en ningún nivel (pregunta 6), así que necesitan tu revisión" },
  "fish-pie": { swap: "Espesa la salsa con maicena; cubierta de patata, sin masa", note: "La salsa del pastel de pescado suele espesarse con harina (pregunta 4): solo vale con salsa espesada sin gluten y sin masa, cuando lo confirmes" },
  takeaway: { note: "La comida para llevar no tiene receta que revisar (pregunta 7): mira el menú por el gluten" },
  "naturally-gf": { note: "Sin gluten de forma natural si es fresco y sin nada añadido" },
};

export function localiseFinding(f: Finding, lang: Lang): Finding {
  if (lang === "en") return f;
  if (f.rule === "unknown") return { ...f, note: "La revisión no reconoce nada en este nombre. Comprueba qué lleva" };
  if (f.rule === "naturally-gf" && f.term === "tortilla de patatas") return { ...f, note: "Tortilla española, no una tortilla de trigo" };
  const t = ES[f.rule];
  const term = f.rule === "takeaway" && f.term === "take-away" ? "comida para llevar" : f.term;
  return t ? { ...f, term, note: t.note, swap: f.swap ? (t.swap ?? f.swap) : undefined } : f;
}

export function localiseVerdict(v: Verdict, lang: Lang): Verdict {
  if (lang === "en") return v;
  const findings = v.findings.map((f) => localiseFinding(f, lang));
  return { ...v, findings, swaps: [...new Set(findings.map((f) => f.swap).filter((s): s is string => Boolean(s)))] };
}
