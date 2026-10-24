// npm run seed
//
// Builds supabase/seed.sql from the files in /Seed. With DATABASE_URL set it
// also runs the migrations and the seed against that database. Safe to re-run.
//
//   HOUSEHOLD_EMAILS   comma-separated logins to add to the household
//   DATABASE_URL       Postgres connection string (Supabase > Project Settings > Database)
//   --setup <file>     also write one file with migrations + seed, to paste into the SQL editor

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSeedSql } from "../lib/seed/build";

const root = join(__dirname, "..");
const seedDir = join(root, "Seed");
const migrationsDir = join(root, "supabase", "migrations");

const sql = buildSeedSql(
  {
    menuCsv: readFileSync(join(seedDir, "meals_menu_semanal.csv"), "utf8"),
    favouritesCsv: readFileSync(join(seedDir, "favourites_seed.csv"), "utf8"),
    receiptsCsv: readFileSync(join(seedDir, "tesco_receipts_clean.csv"), "utf8"),
    glutenMd: readFileSync(join(seedDir, "gluten_list_for_review.md"), "utf8"),
  },
  {
    householdEmails: (process.env.HOUSEHOLD_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean),
  },
);

const seedPath = join(root, "supabase", "seed.sql");
writeFileSync(seedPath, sql);
console.log(`Wrote ${seedPath}`);

const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => `-- ${f}\n${readFileSync(join(migrationsDir, f), "utf8")}`);

const setupIdx = process.argv.indexOf("--setup");
if (setupIdx > 0) {
  const target = process.argv[setupIdx + 1];
  writeFileSync(target, [...migrations, sql].join("\n\n"));
  console.log(`Wrote ${target}`);
}

async function run() {
  if (!process.env.DATABASE_URL) return;
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    for (const m of migrations) await client.query(m);
    await client.query(sql);
    console.log("Migrations and seed applied.");
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
