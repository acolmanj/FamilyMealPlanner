import type { SlotPref } from "../planner/slot-pref";
import type { SlotSeed } from "./build";

// Which slot each meal usually fills, read from the menu sheet's Lunch and Dinner columns.
// A meal is "supper" when at least 70% of its past uses were dinners, "lunch" when at
// least 70% were lunches, and "either" when it is mixed or was never planned.
// "breakfast" is never inferred: the sheet has no breakfast column, the owner sets it.

export const SLOT_SHARE = 0.7;

export type SlotCount = { nameGroup: string; lunch: number; dinner: number; pref: SlotPref };

export function prefFromCounts(lunch: number, dinner: number): SlotPref {
  const total = lunch + dinner;
  if (total === 0) return "either";
  if (dinner / total >= SLOT_SHARE) return "supper";
  if (lunch / total >= SLOT_SHARE) return "lunch";
  return "either";
}

// Sobras and take-away cells have no name group, so they never count.
export function inferSlotPreferences(slots: Pick<SlotSeed, "nameGroup" | "slot">[]): SlotCount[] {
  const counts = new Map<string, { lunch: number; dinner: number }>();
  for (const s of slots) {
    if (!s.nameGroup) continue;
    const c = counts.get(s.nameGroup) ?? { lunch: 0, dinner: 0 };
    c[s.slot] += 1;
    counts.set(s.nameGroup, c);
  }
  return [...counts]
    .map(([nameGroup, c]) => ({ nameGroup, ...c, pref: prefFromCounts(c.lunch, c.dinner) }))
    .sort((a, b) => a.nameGroup.localeCompare(b.nameGroup));
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

// An idempotent UPDATE by name. It only changes meals still on the default 'either',
// so a preference the owner set by hand is never overwritten by a re-run.
export function slotPreferenceSql(counts: SlotCount[]): string {
  const rows = counts.filter((c) => c.pref !== "either");
  return [
    "update public.meals m set slot_preference = v.pref",
    "from (values",
    rows.map((c) => `(${q(c.nameGroup)}, ${q(c.pref)})`).join(",\n"),
    ") as v(name_group, pref)",
    "where m.name_group = v.name_group and m.slot_preference = 'either';",
  ].join("\n");
}
