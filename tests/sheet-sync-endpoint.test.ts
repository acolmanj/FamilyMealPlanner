import { generateKeyPairSync, createVerify } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseServiceAccount, signJwt } from "../lib/sheet-sync/google";
import { SHEET_HOUSEHOLD_ID, bearerMatches, runSync, sheetSyncSettings, type SyncSettings } from "../lib/sheet-sync/run";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY_JSON = JSON.stringify({
  type: "service_account",
  client_email: "menu-reader@example.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
});

describe("sheet sync settings", () => {
  it("is off unless both the secret and the Google key are set", () => {
    expect(sheetSyncSettings({})).toBeNull();
    expect(sheetSyncSettings({ SHEET_SYNC_SECRET: "s" })).toBeNull();
    expect(sheetSyncSettings({ GOOGLE_SERVICE_ACCOUNT_JSON: KEY_JSON })).toBeNull();
    expect(sheetSyncSettings({ SHEET_SYNC_SECRET: "s", GOOGLE_SERVICE_ACCOUNT_JSON: "not json" })).toBeNull();
    const on = sheetSyncSettings({ SHEET_SYNC_SECRET: "s", GOOGLE_SERVICE_ACCOUNT_JSON: KEY_JSON });
    expect(on?.fileId).toBe("1ID3hf0eSLux3TiLlOUTdVNREMbuQWfdTP3yBYXGEWvU");
    expect(sheetSyncSettings({ SHEET_SYNC_SECRET: "s", GOOGLE_SERVICE_ACCOUNT_JSON: KEY_JSON, SHEET_SYNC_FILE_ID: "other" })?.fileId).toBe("other");
  });

  it("reads a key pasted with real line breaks", () => {
    const pasted = KEY_JSON.replace(/\\n/g, "\n");
    expect(parseServiceAccount(pasted)?.private_key).toContain("\n");
  });

  it("checks the bearer key", () => {
    expect(bearerMatches("Bearer abc", "abc")).toBe(true);
    expect(bearerMatches("bearer  abc ", "abc")).toBe(true);
    expect(bearerMatches("Bearer abd", "abc")).toBe(false);
    expect(bearerMatches("abc", "abc")).toBe(false);
    expect(bearerMatches(null, "abc")).toBe(false);
    expect(bearerMatches("Bearer ", "")).toBe(false);
  });

  it("signs a Google token request the key can verify", () => {
    const jwt = signJwt(parseServiceAccount(KEY_JSON)!, 1_700_000_000);
    const [h, c, sig] = jwt.split(".");
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claims).toMatchObject({
      iss: "menu-reader@example.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.metadata.readonly",
      aud: "https://oauth2.googleapis.com/token",
      exp: 1_700_003_600,
    });
    expect(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
  });
});

describe("the endpoint", () => {
  afterEach(() => vi.unstubAllEnvs());
  const post = async (auth?: string) => {
    const { POST } = await import("../app/api/sheet-sync/route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("https://example.com/api/sheet-sync", { method: "POST", headers: auth ? { authorization: auth } : {} });
    return POST(req);
  };

  it("does nothing on a deployment without the sheet settings", async () => {
    vi.stubEnv("SHEET_SYNC_SECRET", "");
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "");
    const res = await post("Bearer anything");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ enabled: false });
  });

  it("refuses a wrong or missing key", async () => {
    vi.stubEnv("SHEET_SYNC_SECRET", "right");
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", KEY_JSON);
    expect((await post("Bearer wrong")).status).toBe(401);
    expect((await post()).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// runSync against a pretend database and a pretend Google Drive
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>, failSlot?: (r: Row) => boolean) {
  const upserts: { table: string; rows: Row[] }[] = [];
  const keys: Record<string, string[]> = {
    plan_slots: ["household_id", "week_start", "day", "slot"],
    sheet_sync_cells: ["household_id", "week_start", "day", "slot"],
    sheet_sync_state: ["household_id"],
  };
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let single = false;
    let payload: Row[] | null = null;
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      returns: () => q,
      maybeSingle: () => ((single = true), q),
      upsert: (rows: Row | Row[]) => ((payload = Array.isArray(rows) ? rows : [rows]), q),
      then: (resolve: (v: unknown) => void) => {
        if (payload) {
          if (table === "plan_slots" && payload.some((r) => failSlot?.(r))) return resolve({ data: null, error: { message: "write refused" } });
          upserts.push({ table, rows: payload });
          const t = (tables[table] ??= []);
          for (const r of payload) {
            const i = t.findIndex((x) => keys[table].every((k) => x[k] === r[k]));
            if (i >= 0) t[i] = { ...t[i], ...r };
            else t.push({ ...r });
          }
          return resolve({ data: null, error: null });
        }
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        resolve({ data: single ? (rows[0] ?? null) : rows, error: null });
      },
    };
    return q;
  };
  return { client: { from } as unknown as SupabaseClient, upserts, tables };
}

// The "Menu" tab as the Sheets API gives it: text only, blank cells at the end of a row left out.
const days = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHEET: string[][] = [
  ["Weekly menu"],
  ["Write each meal in its box. Each week runs Monday to Sunday."],
  [],
  ["Week of Monday 26 October 2026"], // history: outside the weeks that sync
  days,
  ["Lunch", "Old week"],
  ["Dinner"],
  [],
  ["Week of Monday 2 November 2026"],
  days,
  ["Lunch"],
  ["Dinner"],
  [],
  ["Week of Monday 9 November 2026"],
  days,
  ["Lunch"],
  ["Dinner"],
  [],
  ["Week of Monday 16 November 2026"],
  days,
  ["Lunch", "Lentils", "", "", "Fish Pie"],
  ["Dinner", "Salchichas"],
  [],
  ["Week of Monday 23 November 2026"],
  days,
  ["Lunch", "Pasta boloñesa", "Curry con lentejas"],
  ["Dinner", "Sobras", "", "Bainas con patatas"],
  [],
  ["Week of Monday 1 December 2026"], // a Tuesday: skipped and listed as a problem
  days,
  ["Lunch", "Pizza"],
];

const settings: SyncSettings = { secret: "s", account: parseServiceAccount(KEY_JSON)!, fileId: "file1" };

function fakeDrive(modifiedTime = "2026-11-26T10:00:00.000Z", values: string[][] = SHEET) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(String(url));
    if (String(url).includes("oauth2")) return Response.json({ access_token: "tok" });
    if (String(url).startsWith("https://sheets.googleapis.com/")) return Response.json({ range: "Menu!A1:H31", majorDimension: "ROWS", values });
    return Response.json({ name: "Weekly Menu", modifiedTime });
  }) as typeof fetch;
  return { f, calls };
}
const readsSheet = (calls: string[]) => calls.some((u) => u.startsWith("https://sheets.googleapis.com/"));

const library = () => [
  { id: "pie", household_id: SHEET_HOUSEHOLD_ID, name: "Pastel de pescado", name_group: "Pastel de pescado", name_en: "Fish pie", name_es: null, variants_seen: [], retired: false, blacklisted: false },
  { id: "bolo", household_id: SHEET_HOUSEHOLD_ID, name: "Pasta boloñesa (variants)", name_group: "Pasta boloñesa (variants)", name_en: null, name_es: null, variants_seen: ["Pasta boloñesa"], retired: false, blacklisted: false },
  { id: "salch", household_id: SHEET_HOUSEHOLD_ID, name: "Salchichas", name_group: "Salchichas", name_en: "Sausages", name_es: null, variants_seen: [], retired: false, blacklisted: false },
  { id: "gone", household_id: SHEET_HOUSEHOLD_ID, name: "Lentils", name_group: "Lentils", name_en: null, name_es: null, variants_seen: [], retired: true, blacklisted: false },
];

const opts = (db: ReturnType<typeof fakeDb>, drive: ReturnType<typeof fakeDrive>, extra: Partial<Parameters<typeof runSync>[0]> = {}) => ({
  supabase: db.client,
  householdId: SHEET_HOUSEHOLD_ID,
  settings,
  today: "2026-11-26",
  dryRun: false,
  force: false,
  fetch: drive.f,
  ...extra,
});

describe("a sync run", () => {
  it("copies the weeks that sync and saves a snapshot of every cell", async () => {
    const db = fakeDb({ meals: library() });
    const drive = fakeDrive();
    const r = await runSync(opts(db, drive));
    expect(r.ok).toBe(true);
    expect(r.weeks).toEqual(["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]);
    // Only the Menu tab is asked for, so the Ideas tab is never read.
    expect(drive.calls).toContain("https://sheets.googleapis.com/v4/spreadsheets/file1/values/Menu!A1%3AH?valueRenderOption=FORMATTED_VALUE");
    expect(drive.calls).toContain("https://www.googleapis.com/drive/v3/files/file1?fields=modifiedTime,name&supportsAllDrives=true");
    expect(r.problems).toEqual(["Week header 'Week of Monday 1 December 2026' (row 29) is not a Monday, so that week was skipped"]);
    expect(r.message).toMatch(/1 problem/);
    expect(r.checked).toBe(56);
    const slots = db.tables.plan_slots;
    expect(slots).toHaveLength(7);
    expect(slots.some((s) => s.week_start === "2026-10-26")).toBe(false);
    const at = (w: string, d: string, s: string) => slots.find((x) => x.week_start === w && x.day === d && x.slot === s);
    expect(at("2026-11-16", "thu", "lunch")).toMatchObject({ meal_id: "pie", as_written: "Fish Pie", status: "proposed", changed_by_user: true, why_line: "From the family menu sheet" });
    // A retired (deleted) meal is never matched.
    expect(at("2026-11-16", "mon", "lunch")).toMatchObject({ meal_id: null, as_written: "Lentils" });
    expect(at("2026-11-23", "mon", "dinner")).toMatchObject({ meal_id: null, is_leftover: true, as_written: "Sobras" });
    expect(r.unmatched.map((u) => u.text)).toEqual(["Lentils", "Curry con lentejas", "Bainas con patatas"]);
    expect(db.tables.sheet_sync_cells).toHaveLength(56);
    expect(db.tables.sheet_sync_state[0]).toMatchObject({ file_modified_at: "2026-11-26T10:00:00.000Z", last_error: null });
  });

  it("does not read the sheet when Drive says it has not changed", async () => {
    const db = fakeDb({ meals: library(), sheet_sync_state: [{ household_id: SHEET_HOUSEHOLD_ID, file_modified_at: "2026-11-26T10:00:00.000Z" }] });
    const drive = fakeDrive("2026-11-26T10:00:00.000Z");
    const r = await runSync(opts(db, drive));
    expect(r).toMatchObject({ ok: true, fileChanged: false, changed: 0 });
    expect(readsSheet(drive.calls)).toBe(false);
    expect(db.upserts.map((u) => u.table)).toEqual(["sheet_sync_state"]);
    // force=1 reads it anyway.
    const forced = await runSync(opts(db, drive, { force: true }));
    expect(forced.fileChanged).toBe(true);
  });

  it("a dry run lists the changes and saves nothing", async () => {
    const db = fakeDb({
      meals: library(),
      plan_slots: [{ household_id: SHEET_HOUSEHOLD_ID, week_start: "2026-11-16", day: "thu", slot: "lunch", meal_id: "salch", as_written: "Salchichas", is_leftover: false, is_takeaway: false, meals: { name: "Salchichas" } }],
    });
    const r = await runSync(opts(db, fakeDrive(), { dryRun: true }));
    expect(db.upserts).toEqual([]);
    expect(r.changes).toContainEqual({ week_start: "2026-11-16", day: "thu", slot: "lunch", before: "Salchichas", after: "Pastel de pescado", kind: "meal" });
    expect(r.changed).toBe(7);
  });

  it("keeps the old snapshot for a slot that failed to save, and retries the file next time", async () => {
    const db = fakeDb({ meals: library() }, (r) => r.day === "tue" && r.week_start === "2026-11-23");
    const r = await runSync(opts(db, fakeDrive()));
    expect(r.ok).toBe(false);
    expect(r.failed).toBe(1);
    expect(r.changed).toBe(6);
    expect(db.tables.sheet_sync_cells).toHaveLength(55);
    expect(db.tables.sheet_sync_cells.some((c) => c.week_start === "2026-11-23" && c.day === "tue" && c.slot === "lunch")).toBe(false);
    expect(db.tables.sheet_sync_state[0].file_modified_at).toBeUndefined();
    expect(db.tables.sheet_sync_state[0].last_error).toMatch(/write refused/);
  });

  it("stops and writes nothing to the plan when the sheet has no weeks", async () => {
    const db = fakeDb({ meals: library() });
    const r = await runSync(opts(db, fakeDrive(undefined, [["Weekly menu"], ["Lunch", "Pizza"]])));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Could not find any week/);
    expect(db.upserts.map((u) => u.table)).toEqual(["sheet_sync_state"]);
    expect(db.tables.sheet_sync_state[0].last_error).toMatch(/Could not find any week/);
  });

  it("says in plain words when the sheet is not shared with the sync account, and writes nothing", async () => {
    for (const [status, at] of [[404, "drive"], [403, "sheets"]] as const) {
      const db = fakeDb({ meals: library() });
      const f = (async (url: string) => {
        if (String(url).includes("oauth2")) return Response.json({ access_token: "tok" });
        const isSheets = String(url).startsWith("https://sheets.googleapis.com/");
        if ((at === "sheets") === isSheets) return Response.json({ error: { code: status, message: "File not found" } }, { status });
        return Response.json({ name: "Weekly Menu", modifiedTime: "2026-11-26T10:00:00.000Z" });
      }) as typeof fetch;
      const r = await runSync(opts(db, { f, calls: [] }));
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/Share the sheet with the sync's Google account \(.+@.+\)/);
      expect(db.upserts.map((u) => u.table)).toEqual(["sheet_sync_state"]);
      expect(db.tables.sheet_sync_state[0].file_modified_at).toBeUndefined();
    }
  });

  it("does not mention problems in old weeks outside the window", async () => {
    const db = fakeDb({ meals: library() });
    const old = [["Week of Monday 6 October 2026"], ["Week of Monday 6 October 2026"], ["Week of Tuesday 13 October 2026"], ...SHEET.slice(18, 27)];
    const r = await runSync(opts(db, fakeDrive(undefined, old)));
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.weeks).toEqual(["2026-11-16", "2026-11-23"]);
  });
});

describe("the sheet sync tables", () => {
  it("let a household see only its own rows", async () => {
    const root = join(__dirname, "..");
    const db = new PGlite();
    await db.exec(`
      create schema if not exists auth;
      create or replace function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
      $$;
      do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
      grant usage on schema public to authenticated;
    `);
    for (const f of readdirSync(join(root, "supabase/migrations")).sort()) await db.exec(readFileSync(join(root, "supabase/migrations", f), "utf8"));
    await db.exec(`
      insert into public.households (id, name) values ('${SHEET_HOUSEHOLD_ID}', 'Ours'), ('00000000-0000-4000-8000-000000000002', 'Friends');
      insert into public.household_members values ('${SHEET_HOUSEHOLD_ID}', 'us@example.com'), ('00000000-0000-4000-8000-000000000002', 'them@example.com');
      insert into public.sheet_sync_cells (household_id, week_start, day, slot, cell_text) values ('${SHEET_HOUSEHOLD_ID}', '2026-11-23', 'mon', 'lunch', 'Pizza');
      insert into public.sheet_sync_state (household_id, file_modified_at) values ('${SHEET_HOUSEHOLD_ID}', now());
    `);
    const as = async (email: string, sql: string) => {
      await db.exec(`set role authenticated; select set_config('request.jwt.claims', '{"email":"${email}"}', false);`);
      try {
        return await db.query<Row>(sql);
      } finally {
        await db.exec("reset role;");
      }
    };
    expect((await as("us@example.com", "select * from public.sheet_sync_cells")).rows).toHaveLength(1);
    expect((await as("us@example.com", "select * from public.sheet_sync_state")).rows).toHaveLength(1);
    expect((await as("them@example.com", "select * from public.sheet_sync_cells")).rows).toHaveLength(0);
    expect((await as("them@example.com", "select * from public.sheet_sync_state")).rows).toHaveLength(0);
    await expect(
      as("them@example.com", `insert into public.sheet_sync_cells (household_id, week_start, day, slot) values ('${SHEET_HOUSEHOLD_ID}', '2026-11-23', 'tue', 'lunch')`),
    ).rejects.toThrow();
    await as("us@example.com", `insert into public.sheet_sync_cells (household_id, week_start, day, slot) values ('${SHEET_HOUSEHOLD_ID}', '2026-11-23', 'tue', 'lunch')`);
  });
});
