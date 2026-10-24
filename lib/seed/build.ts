import { parse } from "csv-parse/sync";

// Builds an idempotent SQL script from the four files in /Seed.
// Pure: same files in, same SQL out. Re-running the SQL updates rows in place
// instead of adding duplicates (every insert has an ON CONFLICT target).

export const HOUSEHOLD_ID = "00000000-0000-4000-8000-000000000001";
export const HOUSEHOLD_NAME = "Our household";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const DAY_CODES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const SOBRAS_GROUP = "Sobras";
const TAKEAWAY_GROUP = "Take-away / eating out";

export type SeedFiles = {
  menuCsv: string;
  favouritesCsv: string;
  receiptsCsv: string;
  glutenMd: string;
};

export type SeedOptions = {
  householdEmails?: string[];
};

type MenuRow = {
  week_no: string;
  sheet_date_label: string;
  in_last_8_weeks: string;
  day: string;
  slot: string;
  meal_as_written: string;
  name_group: string;
  ingredients_after_colon: string;
  source_note: string;
  slot_type: string;
  gluten_keyword_flag: string;
};

export type SlotSeed = {
  weekNo: number;
  weekStart: string;
  day: (typeof DAY_CODES)[number];
  slot: "lunch" | "dinner";
  asWritten: string | null;
  nameGroup: string | null;
  isLeftover: boolean;
  isTakeaway: boolean;
};

export type MealSeed = {
  nameGroup: string;
  variants: string[];
  ingredientsNote: string | null;
  recipeSource: string | null;
  glutenKeywordFlag: string | null;
  lastEaten: string;
  isFavourite: boolean;
  favouriteSeenCount: number | null;
};

export type PurchaseSeed = Record<string, string | number | null> & { order_date: string; line_no: number };

export type GlutenTierSeed = { tier: string; label: string; rule: string; items: string[] };

export type SeedData = {
  slots: SlotSeed[];
  meals: MealSeed[];
  purchases: PurchaseSeed[];
  glutenTiers: GlutenTierSeed[];
};

function readCsv<T>(text: string): T[] {
  return parse(text, { columns: true, bom: true, skip_empty_lines: true, trim: false }) as T[];
}

function blank(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Sheet dates are not reliable, but week order is. The last week's label is
// correct, so anchor on it and count back by week_no.
export function weekStarts(rows: { week_no: string; sheet_date_label: string }[]): Map<number, string> {
  const lastWeek = Math.max(...rows.map((r) => Number(r.week_no)));
  const label = rows.find((r) => Number(r.week_no) === lastWeek)!.sheet_date_label;
  const [dd, mm, yyyy] = label.split("/").map(Number);
  const anchor = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (anchor.getUTCDay() !== 1) throw new Error(`Week ${lastWeek} label ${label} is not a Monday`);
  const anchorIso = anchor.toISOString().slice(0, 10);
  const out = new Map<number, string>();
  for (let w = 1; w <= lastWeek; w++) out.set(w, addDays(anchorIso, (w - lastWeek) * 7));
  return out;
}

const CONFIRM_VALUES = new Set(["yes", "y", "true", "1", "x", "si", "sí"]);

export function parseSeedData(files: SeedFiles): SeedData {
  const menu = readCsv<MenuRow>(files.menuCsv);
  const starts = weekStarts(menu);

  const slots: SlotSeed[] = menu.map((r) => {
    const dayIdx = DAYS.indexOf(r.day as (typeof DAYS)[number]);
    if (dayIdx < 0) throw new Error(`Unknown day "${r.day}"`);
    const slot = r.slot.toLowerCase();
    if (slot !== "lunch" && slot !== "dinner") throw new Error(`Unknown slot "${r.slot}"`);
    const group = blank(r.name_group);
    return {
      weekNo: Number(r.week_no),
      weekStart: starts.get(Number(r.week_no))!,
      day: DAY_CODES[dayIdx],
      slot,
      asWritten: blank(r.meal_as_written),
      nameGroup: group === SOBRAS_GROUP || group === TAKEAWAY_GROUP ? null : group,
      isLeftover: group === SOBRAS_GROUP || r.slot_type === "Sobras",
      isTakeaway: group === TAKEAWAY_GROUP || r.slot_type === "Take-away",
    };
  });

  const favourites = readCsv<{
    name_group: string;
    times_in_last_8_weeks: string;
    confirm_as_favourite: string;
  }>(files.favouritesCsv);
  const favByGroup = new Map(favourites.map((f) => [f.name_group, f]));

  const meals = new Map<string, MealSeed>();
  menu.forEach((r, i) => {
    const s = slots[i];
    if (!s.nameGroup) return;
    const dayIdx = DAY_CODES.indexOf(s.day);
    const eaten = addDays(s.weekStart, dayIdx);
    const variant = (r.meal_as_written.split(":")[0] ?? "").trim();
    let m = meals.get(s.nameGroup);
    if (!m) {
      const fav = favByGroup.get(s.nameGroup);
      m = {
        nameGroup: s.nameGroup,
        variants: [],
        ingredientsNote: null,
        recipeSource: null,
        glutenKeywordFlag: null,
        lastEaten: eaten,
        isFavourite: fav ? CONFIRM_VALUES.has(fav.confirm_as_favourite.trim().toLowerCase()) : false,
        favouriteSeenCount: fav ? Number(fav.times_in_last_8_weeks) : null,
      };
      meals.set(s.nameGroup, m);
    }
    if (variant && !m.variants.includes(variant)) m.variants.push(variant);
    m.ingredientsNote ??= blank(r.ingredients_after_colon);
    m.recipeSource ??= blank(r.source_note);
    m.glutenKeywordFlag ??= blank(r.gluten_keyword_flag);
    if (eaten > m.lastEaten) m.lastEaten = eaten;
  });

  for (const f of favourites) {
    if (!meals.has(f.name_group)) throw new Error(`Favourite group "${f.name_group}" is not in the menu`);
  }

  const receipts = readCsv<Record<string, string>>(files.receiptsCsv);
  const lineNos = new Map<string, number>();
  const purchases: PurchaseSeed[] = receipts.map((r) => {
    const n = (lineNos.get(r.order_date) ?? 0) + 1;
    lineNos.set(r.order_date, n);
    const num = (v: string) => (blank(v) === null ? null : Number(v));
    return {
      order_date: r.order_date,
      line_no: n,
      store_section: blank(r.store_section),
      item_type: blank(r.item_type),
      product_ordered: blank(r.product_ordered),
      qty_ordered: num(r.qty_ordered),
      unit_price_eur: num(r.unit_price_eur),
      outcome: blank(r.outcome),
      product_delivered: blank(r.product_delivered),
      qty_delivered: num(r.qty_delivered),
      delivered_unit_price_eur: num(r.delivered_unit_price_eur),
      line_total_eur: num(r.line_total_paid_eur),
      gluten_screen_draft: blank(r.gluten_screen_draft),
    };
  });

  return { slots, meals: [...meals.values()], purchases, glutenTiers: parseGlutenTiers(files.glutenMd) };
}

// Reads the "| A. Never | rule | items |" rows of the tier table.
export function parseGlutenTiers(md: string): GlutenTierSeed[] {
  const tiers: GlutenTierSeed[] = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^\|\s*([A-D])\.\s*([^|]+)\|([^|]+)\|([^|]+)\|\s*$/);
    if (!m) continue;
    tiers.push({
      tier: m[1],
      label: m[2].trim(),
      rule: m[3].trim(),
      items: splitItems(m[4]),
    });
  }
  if (tiers.length !== 4) throw new Error(`Expected 4 gluten tiers, found ${tiers.length}`);
  return tiers;
}

// Splits on commas and semicolons that are not inside brackets.
function splitItems(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if ((ch === "," || ch === ";") && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// SQL output
// ---------------------------------------------------------------------------

function q(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  return `'${v.replace(/'/g, "''")}'`;
}

function qArr(vs: string[]): string {
  return vs.length ? `array[${vs.map(q).join(", ")}]::text[]` : "'{}'::text[]";
}

export function buildSeedSql(files: SeedFiles, opts: SeedOptions = {}): string {
  const data = parseSeedData(files);
  const h = q(HOUSEHOLD_ID);
  const out: string[] = [];

  out.push("-- Seed data generated by `npm run seed` from the /Seed folder. Safe to re-run.");
  out.push("begin;");
  out.push(
    `insert into public.households (id, name) values (${h}, ${q(HOUSEHOLD_NAME)})\n  on conflict (id) do nothing;`,
  );

  for (const email of opts.householdEmails ?? []) {
    out.push(
      `insert into public.household_members (household_id, email) values (${h}, ${q(email.trim().toLowerCase())})\n  on conflict do nothing;`,
    );
  }

  out.push("\n-- Meals (one per name group)");
  for (const m of data.meals) {
    out.push(
      `insert into public.meals (household_id, name, name_group, variants_seen, ingredients_note, recipe_source, gluten_keyword_flag, last_eaten, is_favourite, favourite_seen_count, source)
  values (${h}, ${q(m.nameGroup)}, ${q(m.nameGroup)}, ${qArr(m.variants)}, ${q(m.ingredientsNote)}, ${q(m.recipeSource)}, ${q(m.glutenKeywordFlag)}, ${q(m.lastEaten)}, ${q(m.isFavourite)}, ${q(m.favouriteSeenCount)}, 'menu')
  on conflict (household_id, name_group) do update set
    variants_seen = excluded.variants_seen,
    ingredients_note = excluded.ingredients_note,
    recipe_source = excluded.recipe_source,
    gluten_keyword_flag = excluded.gluten_keyword_flag,
    last_eaten = greatest(meals.last_eaten, excluded.last_eaten),
    is_favourite = meals.is_favourite or excluded.is_favourite,
    favourite_seen_count = excluded.favourite_seen_count;`,
    );
  }

  out.push("\n-- Plan history (every cell of the menu sheet, blanks included)");
  for (const s of data.slots) {
    const mealId = s.nameGroup
      ? `(select id from public.meals where household_id = ${h} and name_group = ${q(s.nameGroup)})`
      : "null";
    out.push(
      `insert into public.plan_slots (household_id, week_start, week_no, day, slot, meal_id, as_written, status, is_leftover, is_takeaway)
  values (${h}, ${q(s.weekStart)}, ${s.weekNo}, ${q(s.day)}, ${q(s.slot)}, ${mealId}, ${q(s.asWritten)}, 'eaten', ${q(s.isLeftover)}, ${q(s.isTakeaway)})
  on conflict (household_id, week_start, day, slot) do update set
    week_no = excluded.week_no, meal_id = excluded.meal_id, as_written = excluded.as_written,
    status = excluded.status, is_leftover = excluded.is_leftover, is_takeaway = excluded.is_takeaway;`,
    );
  }

  out.push("\n-- Tesco receipt lines");
  const cols = [
    "store_section", "item_type", "product_ordered", "qty_ordered", "unit_price_eur", "outcome",
    "product_delivered", "qty_delivered", "delivered_unit_price_eur", "line_total_eur", "gluten_screen_draft",
  ];
  for (const p of data.purchases) {
    out.push(
      `insert into public.purchases (household_id, store, order_date, line_no, ${cols.join(", ")})
  values (${h}, 'tesco', ${q(p.order_date)}, ${p.line_no}, ${cols.map((c) => q(p[c])).join(", ")})
  on conflict (household_id, store, order_date, line_no) do update set
    ${cols.map((c) => `${c} = excluded.${c}`).join(", ")};`,
    );
  }

  out.push("\n-- Gluten tiers as written (not yet confirmed by the owner)");
  for (const t of data.glutenTiers) {
    out.push(
      `insert into public.gluten_rules (household_id, tier, label, rule, items)
  values (${h}, ${q(t.tier)}, ${q(t.label)}, ${q(t.rule)}, ${qArr(t.items)})
  on conflict (household_id, tier) do update set
    label = excluded.label, rule = excluded.rule, items = excluded.items;`,
    );
  }

  out.push("commit;");
  return out.join("\n") + "\n";
}
