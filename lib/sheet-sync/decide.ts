import type { Day, Slot } from "../planner/rules";
import type { CellMatch } from "./match";

// Decides what a sync writes. Pure: the snapshot of the sheet at the last sync, the sheet
// now, and what the app holds in, the writes out. The owner's rule:
//   - a cell seen for the first time (no snapshot) that has text: the sheet wins;
//   - a cell whose text changed since the last sync (and is not empty): the sheet wins;
//   - a cell that did not change: the app is left alone, so an edit made in the app stays;
//   - a cell that became empty: the app is left alone.
// The snapshot is always moved on to what the sheet says now, empty cells included.

export const WHY_LINE = "From the family menu sheet";

export type SyncCell = { weekStart: string; day: Day; slot: Slot; text: string; match: CellMatch };
export type AppSlot = { meal_id: string | null; as_written: string | null; is_leftover: boolean; is_takeaway: boolean };

export type SlotValues = AppSlot & {
  status: "proposed";
  changed_by_user: false;
  why_line: string;
  from_freezer_id: null;
};
export type SlotWrite = { weekStart: string; day: Day; slot: Slot; kind: CellMatch["kind"]; reason: "new" | "changed"; values: SlotValues };
export type SnapshotWrite = { weekStart: string; day: Day; slot: Slot; text: string };

export type Decision = {
  slotWrites: SlotWrite[];
  snapshotWrites: SnapshotWrite[];
  // Cells left alone, by why.
  unchanged: number; // same text as last time: the app's version stays
  emptied: number; // the cell was cleared in the sheet: the app's version stays
  sameAsApp: number; // the sheet changed but the app already shows the same thing
};

export const cellId = (c: { weekStart: string; day: string; slot: string }) => `${c.weekStart}|${c.day}|${c.slot}`;

export function slotValues(match: CellMatch): AppSlot {
  return {
    meal_id: match.kind === "meal" ? match.mealId : null,
    as_written: match.asWritten,
    is_leftover: match.kind === "leftover",
    is_takeaway: match.kind === "takeaway",
  };
}

const sameContent = (a: AppSlot, b: AppSlot) =>
  a.meal_id === b.meal_id && (a.as_written ?? null) === (b.as_written ?? null) && a.is_leftover === b.is_leftover && a.is_takeaway === b.is_takeaway;

export function decideSync(
  cells: SyncCell[],
  snapshot: Map<string, string>, // cellId -> cell text at the last sync
  app: Map<string, AppSlot>, // cellId -> what plan_slots holds now
): Decision {
  const out: Decision = { slotWrites: [], snapshotWrites: [], unchanged: 0, emptied: 0, sameAsApp: 0 };
  for (const c of cells) {
    const id = cellId(c);
    const before = snapshot.get(id);
    out.snapshotWrites.push({ weekStart: c.weekStart, day: c.day, slot: c.slot, text: c.text });

    if (c.match.kind === "empty") {
      if (before !== undefined && before !== "") out.emptied++;
      continue;
    }
    if (before !== undefined && before === c.text) {
      out.unchanged++;
      continue;
    }
    const values = slotValues(c.match);
    const now = app.get(id);
    if (now && sameContent(now, values)) {
      out.sameAsApp++;
      continue;
    }
    out.slotWrites.push({
      weekStart: c.weekStart,
      day: c.day,
      slot: c.slot,
      kind: c.match.kind,
      reason: before === undefined ? "new" : "changed",
      values: { ...values, status: "proposed", changed_by_user: false, why_line: WHY_LINE, from_freezer_id: null },
    });
  }
  return out;
}
