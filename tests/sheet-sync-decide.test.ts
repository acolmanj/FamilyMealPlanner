import { describe, expect, it } from "vitest";
import { WHY_LINE, cellId, decideSync, type AppSlot, type SyncCell } from "../lib/sheet-sync/decide";
import type { CellMatch } from "../lib/sheet-sync/match";

const W = "2026-11-23";
const cell = (text: string, match: CellMatch, day: SyncCell["day"] = "mon", slot: SyncCell["slot"] = "lunch"): SyncCell => ({
  weekStart: W, day, slot, text, match,
});
const meal = (id: string, asWritten: string): CellMatch => ({ kind: "meal", mealId: id, asWritten });
const EMPTY: CellMatch = { kind: "empty", asWritten: null };
const ID = cellId({ weekStart: W, day: "mon", slot: "lunch" });
const appEdit: AppSlot = { meal_id: "app-meal", as_written: "Chosen in the app", is_leftover: false, is_takeaway: false };

const run = (c: SyncCell, snapshot?: string, app?: AppSlot) =>
  decideSync([c], new Map(snapshot === undefined ? [] : [[ID, snapshot]]), new Map(app ? [[ID, app]] : []));

describe("sheet sync rules", () => {
  it("first time a cell is seen with text: the sheet wins over the app", () => {
    const d = run(cell("Fish Pie", meal("pie", "Fish Pie")), undefined, appEdit);
    expect(d.slotWrites).toEqual([
      {
        weekStart: W, day: "mon", slot: "lunch", kind: "meal", reason: "new",
        values: { meal_id: "pie", as_written: "Fish Pie", is_leftover: false, is_takeaway: false, status: "proposed", changed_by_user: false, why_line: WHY_LINE, from_freezer_id: null },
      },
    ]);
    expect(d.snapshotWrites).toEqual([{ weekStart: W, day: "mon", slot: "lunch", text: "Fish Pie" }]);
  });

  it("first time a cell is seen empty: nothing is written but the snapshot is saved", () => {
    const d = run(cell("", EMPTY), undefined, appEdit);
    expect(d.slotWrites).toEqual([]);
    expect(d.snapshotWrites).toEqual([{ weekStart: W, day: "mon", slot: "lunch", text: "" }]);
  });

  it("a cell whose text changed: the sheet wins (latest change)", () => {
    const d = run(cell("Pizza", meal("pizza", "Pizza")), "Fish Pie", appEdit);
    expect(d.slotWrites).toHaveLength(1);
    expect(d.slotWrites[0]).toMatchObject({ reason: "changed", values: { meal_id: "pizza", as_written: "Pizza" } });
  });

  it("a cell that was empty and now has text counts as a change", () => {
    const d = run(cell("Pizza", meal("pizza", "Pizza")), "");
    expect(d.slotWrites[0]).toMatchObject({ reason: "changed" });
  });

  it("a cell that did not change: the app's edit stays", () => {
    const d = run(cell("Fish Pie", meal("pie", "Fish Pie")), "Fish Pie", appEdit);
    expect(d.slotWrites).toEqual([]);
    expect(d.unchanged).toBe(1);
    expect(d.snapshotWrites).toHaveLength(1);
  });

  it("a cell that became empty: the app is left alone, the snapshot becomes empty", () => {
    const d = run(cell("", EMPTY), "Fish Pie", appEdit);
    expect(d.slotWrites).toEqual([]);
    expect(d.emptied).toBe(1);
    expect(d.snapshotWrites).toEqual([{ weekStart: W, day: "mon", slot: "lunch", text: "" }]);
  });

  it("writes leftovers, take-away and unmatched text without a meal", () => {
    const d = decideSync(
      [
        cell("Sobras: risotto", { kind: "leftover", asWritten: "Sobras" }, "tue"),
        cell("Take-away", { kind: "takeaway", asWritten: "Take-away" }, "wed"),
        cell("Bainas con patatas", { kind: "unmatched", asWritten: "Bainas con patatas" }, "thu"),
      ],
      new Map(),
      new Map(),
    );
    expect(d.slotWrites.map((w) => [w.day, w.kind, w.values.meal_id, w.values.as_written, w.values.is_leftover, w.values.is_takeaway])).toEqual([
      ["tue", "leftover", null, "Sobras", true, false],
      ["wed", "takeaway", null, "Take-away", false, true],
      ["thu", "unmatched", null, "Bainas con patatas", false, false],
    ]);
  });

  it("skips a write when the app already shows the same thing", () => {
    const same: AppSlot = { meal_id: "pie", as_written: "Fish Pie", is_leftover: false, is_takeaway: false };
    const d = run(cell("Fish Pie", meal("pie", "Fish Pie")), undefined, same);
    expect(d.slotWrites).toEqual([]);
    expect(d.sameAsApp).toBe(1);
    expect(d.snapshotWrites).toHaveLength(1);
  });

  it("compares text exactly: a note added after the colon is a change", () => {
    const d = run(cell("Fish Pie: with peas", meal("pie", "Fish Pie")), "Fish Pie", appEdit);
    expect(d.slotWrites).toHaveLength(1);
  });
});
