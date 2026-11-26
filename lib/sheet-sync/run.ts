import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SLOTS, type Day, type Slot } from "../planner/rules";
import { cellId, decideSync, type AppRow, type SlotWrite, type SyncCell } from "./decide";
import { downloadXlsx, getAccessToken, getFileInfo, parseServiceAccount, type ServiceAccount } from "./google";
import { makeMatcher, type LibraryMeal } from "./match";
import { inWindow, parseMenu, syncWindow, type SheetRow } from "./parse";

// One sync run: check the Drive file, and if it changed copy the menu into plan_slots.
// The endpoint (app/api/sheet-sync/route.ts) handles sign-in; this does the work.

export const DEFAULT_FILE_ID = "1nX1VREv-8kqeDtTbLRbI2VhkRkpQwLm6";
// The only household this sync may write to (the family's, from the seed).
export const SHEET_HOUSEHOLD_ID = "00000000-0000-4000-8000-000000000001";

export type SyncSettings = { secret: string; account: ServiceAccount; fileId: string };

// Null when this deployment has no sheet sync (the friend family's copy has none of these).
export function sheetSyncSettings(env: Record<string, string | undefined> = process.env): SyncSettings | null {
  const secret = env.SHEET_SYNC_SECRET ?? "";
  const account = parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (!secret || !account) return null;
  return { secret, account, fileId: env.SHEET_SYNC_FILE_ID || DEFAULT_FILE_ID };
}

// "Authorization: Bearer <secret>", compared in constant time.
export function bearerMatches(header: string | null, secret: string): boolean {
  if (!secret) return false;
  const m = (header ?? "").match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(m[1].trim()), h(secret));
}

export type Change = { week_start: string; day: Day; slot: Slot; before: string | null; after: string | null; kind: SlotWrite["kind"] };
export type Unmatched = { week_start: string; day: Day; slot: Slot; text: string };

export type SyncResult = {
  ok: boolean;
  dryRun: boolean;
  fileChanged: boolean;
  fileName?: string;
  fileModifiedAt?: string;
  message: string;
  weeks?: string[];
  checked: number; // sheet cells looked at, in the weeks that sync
  changed: number; // slots written (or that would be, in a dry run)
  unchangedKept: number;
  emptiedKept: number;
  alreadySame: number;
  failed: number;
  unmatched: Unmatched[];
  changes: Change[];
  error?: string;
};

type SlotRow = AppRow & { week_start: string; day: Day; slot: Slot; meals: { name: string } | null };

const empty = (dryRun: boolean, message: string): SyncResult => ({
  ok: true, dryRun, fileChanged: false, message, checked: 0, changed: 0, unchangedKept: 0, emptiedKept: 0, alreadySame: 0, failed: 0, unmatched: [], changes: [],
});

export type RunOptions = {
  supabase: SupabaseClient;
  householdId: string;
  settings: SyncSettings;
  today: string;
  dryRun: boolean;
  force: boolean;
  fetch?: typeof fetch;
  // Reads the downloaded file. Passed in so the xlsx reader loads only when a file is read.
  readRows: (data: Buffer) => Promise<SheetRow[]>;
};

export async function runSync(o: RunOptions): Promise<SyncResult> {
  const { supabase, householdId: hid, dryRun } = o;
  const now = new Date().toISOString();
  const saveState = async (values: Record<string, unknown>) => {
    if (dryRun) return;
    await supabase.from("sheet_sync_state").upsert({ household_id: hid, last_checked_at: now, ...values }, { onConflict: "household_id" });
  };

  try {
    const { data: state, error: stateError } = await supabase
      .from("sheet_sync_state")
      .select("file_modified_at")
      .eq("household_id", hid)
      .maybeSingle<{ file_modified_at: string | null }>();
    if (stateError) throw new Error(`Reading the last sync: ${stateError.message}`);

    const token = await getAccessToken(o.settings.account, o.fetch);
    const info = await getFileInfo(token, o.settings.fileId, o.fetch);
    const last = state?.file_modified_at ? Date.parse(state.file_modified_at) : null;
    // A dry run is a preview, so it always reads the file.
    if (!dryRun && !o.force && last !== null && Date.parse(info.modifiedTime) <= last) {
      await saveState({});
      return { ...empty(dryRun, "The sheet has not changed since the last sync."), fileName: info.name, fileModifiedAt: info.modifiedTime };
    }

    const rows = await o.readRows(await downloadXlsx(token, o.settings.fileId, info.mimeType, o.fetch));
    const parsed = parseMenu(rows, o.today);
    const window = syncWindow(o.today);
    const weeks = parsed.weeks.filter((w) => inWindow(w.weekStart, window));
    const weekStarts = weeks.map((w) => w.weekStart);

    const [meals, snap, slots] = await Promise.all([
      supabase
        .from("meals")
        .select("id, name, name_group, name_en, name_es, variants_seen")
        .eq("household_id", hid)
        // Deleted meals are retired; meals marked never-plan are hidden from the week too.
        .eq("retired", false)
        .eq("blacklisted", false)
        .returns<LibraryMeal[]>(),
      supabase
        .from("sheet_sync_cells")
        .select("week_start, day, slot, cell_text")
        .eq("household_id", hid)
        .in("week_start", weekStarts.length ? weekStarts : ["1900-01-01"])
        .returns<{ week_start: string; day: Day; slot: Slot; cell_text: string }[]>(),
      supabase
        .from("plan_slots")
        .select("week_start, day, slot, meal_id, as_written, is_leftover, is_takeaway, status, changed_by_user, meals(name)")
        .eq("household_id", hid)
        .in("week_start", weekStarts.length ? weekStarts : ["1900-01-01"])
        .in("slot", [...SLOTS])
        .returns<SlotRow[]>(),
    ]);
    for (const r of [meals, snap, slots]) if (r.error) throw new Error(`Reading the app's data: ${r.error.message}`);

    const library = meals.data ?? [];
    const nameOf = new Map(library.map((m) => [m.id, m.name]));
    const match = makeMatcher(library);
    const snapshot = new Map((snap.data ?? []).map((r) => [cellId({ weekStart: r.week_start, day: r.day, slot: r.slot }), r.cell_text]));
    const app = new Map((slots.data ?? []).map((r) => [cellId({ weekStart: r.week_start, day: r.day, slot: r.slot }), r]));
    const cells: SyncCell[] = weeks.flatMap((w) =>
      w.cells.map((c) => {
        const at = { weekStart: w.weekStart, day: c.day, slot: c.slot };
        return { ...at, text: c.text, match: match(c.text, app.get(cellId(at))?.meal_id) };
      }),
    );
    const decision = decideSync(cells, snapshot, app);

    const describe = (w: SlotWrite): Change => {
      const before = app.get(cellId(w));
      return {
        week_start: w.weekStart,
        day: w.day,
        slot: w.slot,
        before: before ? (before.meals?.name ?? before.as_written) : null,
        after: w.values.meal_id ? (nameOf.get(w.values.meal_id) ?? w.values.as_written) : w.values.as_written,
        kind: w.kind,
      };
    };
    const unmatched: Unmatched[] = cells
      .filter((c) => c.match.kind === "unmatched")
      .map((c) => ({ week_start: c.weekStart, day: c.day, slot: c.slot, text: c.match.asWritten ?? c.text }));

    const base = {
      dryRun,
      fileChanged: true,
      fileName: info.name,
      fileModifiedAt: info.modifiedTime,
      weeks: weekStarts,
      checked: cells.length,
      unchangedKept: decision.unchanged,
      emptiedKept: decision.emptied,
      alreadySame: decision.sameAsApp,
      unmatched,
    };

    if (dryRun) {
      const changes = decision.slotWrites.map(describe);
      return {
        ...base,
        ok: true,
        changed: changes.length,
        failed: 0,
        changes,
        message: `Dry run: ${changes.length} of ${cells.length} slots would change. Nothing was saved.`,
      };
    }

    // Slots first. A slot that fails keeps its old snapshot, so the next run tries it again.
    const failed = new Set<string>();
    const errors: string[] = [];
    const written: Change[] = [];
    for (const w of decision.slotWrites) {
      const { error } = await supabase
        .from("plan_slots")
        .upsert({ household_id: hid, week_start: w.weekStart, day: w.day, slot: w.slot, ...w.values }, { onConflict: "household_id,week_start,day,slot" });
      if (error) {
        failed.add(cellId(w));
        errors.push(`${w.weekStart} ${w.day} ${w.slot}: ${error.message}`);
      } else written.push(describe(w));
    }
    const snapRows = decision.snapshotWrites
      .filter((s) => !failed.has(cellId(s)))
      .map((s) => ({ household_id: hid, week_start: s.weekStart, day: s.day, slot: s.slot, cell_text: s.text, synced_at: now }));
    if (snapRows.length) {
      const { error } = await supabase.from("sheet_sync_cells").upsert(snapRows, { onConflict: "household_id,week_start,day,slot" });
      if (error) errors.push(`Saving what the sheet said: ${error.message}`);
    }

    const ok = errors.length === 0;
    const result: SyncResult = {
      ...base,
      ok,
      changed: written.length,
      failed: failed.size,
      changes: written,
      message: ok
        ? `Synced: ${written.length} of ${cells.length} slots changed.`
        : `Synced with problems: ${written.length} slots changed, ${failed.size} could not be saved.`,
      ...(ok ? {} : { error: errors.join("; ") }),
    };
    const { changes: _c, ...summary } = result;
    // The file's time only moves on when everything saved, so a failed run is retried.
    await saveState({
      ...(ok ? { file_modified_at: info.modifiedTime } : {}),
      last_synced_at: now,
      last_result: { ...summary, changes: written.length },
      last_error: ok ? null : result.error,
    });
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await saveState({ last_error: message }).catch(() => undefined);
    return { ...empty(dryRun, `The sync stopped and saved nothing new: ${message}`), ok: false, error: message };
  }
}
