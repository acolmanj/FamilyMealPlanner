import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { HOUSEHOLD_ID, buildSeedSql, parseSeedData, weekStarts, type SeedFiles } from "../lib/seed/build";

const root = join(__dirname, "..");
const files: SeedFiles = {
  menuCsv: readFileSync(join(root, "Seed/meals_menu_semanal.csv"), "utf8"),
  favouritesCsv: readFileSync(join(root, "Seed/favourites_seed.csv"), "utf8"),
  receiptsCsv: readFileSync(join(root, "Seed/tesco_receipts_clean.csv"), "utf8"),
  glutenMd: readFileSync(join(root, "Seed/gluten_list_for_review.md"), "utf8"),
};
const migrations = readdirSync(join(root, "supabase/migrations"))
  .sort()
  .map((f) => readFileSync(join(root, "supabase/migrations", f), "utf8"));

// Just enough of Supabase's auth schema for the migration and RLS to run.
const AUTH_STUB = `
  create schema if not exists auth;
  create or replace function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  grant usage on schema public to authenticated;
`;

async function freshDb() {
  const db = new PGlite();
  await db.exec(AUTH_STUB);
  for (const m of migrations) await db.exec(m);
  await db.exec("grant select, insert, update, delete on all tables in schema public to authenticated;");
  return db;
}

async function count(db: PGlite, table: string) {
  const r = await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`);
  return r.rows[0].n;
}

describe("seed data parsing", () => {
  const data = parseSeedData(files);

  it("keeps all 154 menu cells, including the 5 blanks", () => {
    expect(data.slots).toHaveLength(154);
    expect(data.slots.filter((s) => s.asWritten === null)).toHaveLength(5);
  });

  it("dates weeks by week_no, anchored on the last week (19 Oct 2026)", () => {
    const starts = weekStarts([
      { week_no: "1", sheet_date_label: "10/8/2026" },
      { week_no: "2", sheet_date_label: "17/08/2024" },
      { week_no: "11", sheet_date_label: "19/10/2026" },
    ]);
    expect(starts.get(11)).toBe("2026-10-19");
    expect(starts.get(2)).toBe("2026-08-17");
    expect(starts.get(1)).toBe("2026-08-10");
  });

  it("marks Sobras and take-away cells without inventing a meal for them", () => {
    expect(data.slots.filter((s) => s.isLeftover)).toHaveLength(6);
    expect(data.slots.filter((s) => s.isTakeaway)).toHaveLength(2);
    expect(data.slots.filter((s) => s.isLeftover || s.isTakeaway).every((s) => s.nameGroup === null)).toBe(true);
  });

  it("loads favourite counts but marks none as favourite until the owner confirms", () => {
    const withCount = data.meals.filter((m) => m.favouriteSeenCount !== null);
    expect(withCount).toHaveLength(11);
    expect(data.meals.some((m) => m.isFavourite)).toBe(false);
  });

  it("marks a favourite when the owner confirms it in the CSV", () => {
    const confirmed = files.favouritesCsv.replace("Pizza,8,Pizza | Pizza y croquetas | Pizza y nuggets,", "Pizza,8,Pizza | Pizza y croquetas | Pizza y nuggets,yes");
    const d = parseSeedData({ ...files, favouritesCsv: confirmed });
    expect(d.meals.filter((m) => m.isFavourite).map((m) => m.nameGroup)).toEqual(["Pizza"]);
  });

  it("reads 97 receipt lines whose totals reconcile per order", () => {
    expect(data.purchases).toHaveLength(97);
    const total = (date: string) =>
      Math.round(data.purchases.filter((p) => p.order_date === date).reduce((s, p) => s + Number(p.line_total_eur ?? 0), 0) * 100) / 100;
    expect(total("2026-10-05")).toBe(216.89);
  });

  it("reads the four gluten tiers as written", () => {
    expect(data.glutenTiers.map((t) => t.tier)).toEqual(["A", "B", "C", "D"]);
    expect(data.glutenTiers[0].items).toContain("seitan");
    expect(data.glutenTiers[0].items).toContain("regular pasta");
  });
});

describe("seed SQL against Postgres", () => {
  it("loads everything and re-running adds no duplicates", async () => {
    const db = await freshDb();
    const sql = buildSeedSql(files, { householdEmails: ["Owner@Example.com"] });
    await db.exec(sql);
    const first = {
      plan_slots: await count(db, "plan_slots"),
      meals: await count(db, "meals"),
      purchases: await count(db, "purchases"),
      gluten_rules: await count(db, "gluten_rules"),
      household_members: await count(db, "household_members"),
    };
    expect(first).toEqual({ plan_slots: 154, meals: 70, purchases: 97, gluten_rules: 4, household_members: 1 });

    for (const m of migrations) await db.exec(m);
    await db.exec(sql);
    expect({
      plan_slots: await count(db, "plan_slots"),
      meals: await count(db, "meals"),
      purchases: await count(db, "purchases"),
      gluten_rules: await count(db, "gluten_rules"),
      household_members: await count(db, "household_members"),
    }).toEqual(first);

    const linked = await db.query<{ n: number }>(
      "select count(*)::int as n from public.plan_slots where meal_id is not null",
    );
    expect(linked.rows[0].n).toBe(154 - 5 - 6 - 2);
  });

  it("row-level security shows data to household members only", async () => {
    const db = await freshDb();
    await db.exec(buildSeedSql(files, { householdEmails: ["owner@example.com"] }));

    const asUser = async (email: string) => {
      await db.exec(`set role authenticated; select set_config('request.jwt.claims', '{"email":"${email}"}', false);`);
      const n = await count(db, "plan_slots");
      const m = await count(db, "meals");
      await db.exec("reset role;");
      return { n, m };
    };

    expect(await asUser("OWNER@example.com")).toEqual({ n: 154, m: 70 });
    expect(await asUser("stranger@example.com")).toEqual({ n: 0, m: 0 });

    await db.exec(`set role authenticated; select set_config('request.jwt.claims', '{"email":"stranger@example.com"}', false);`);
    await expect(
      db.exec(`insert into public.meals (household_id, name, name_group) values ('${HOUSEHOLD_ID}', 'x', 'x')`),
    ).rejects.toThrow(/row-level security/);
    await db.exec("reset role;");
  });
});
