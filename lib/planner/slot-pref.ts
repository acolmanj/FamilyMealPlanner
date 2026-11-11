// The slot a meal usually fills. 'supper' is dinner; 'either' fits lunch and dinner;
// 'breakfast' is never planned for lunch or dinner.

// In the order the meal form shows them.
export const SLOT_PREFS = ["lunch", "supper", "either", "breakfast"] as const;
export type SlotPref = (typeof SLOT_PREFS)[number];
export const isSlotPref = (x: unknown): x is SlotPref => SLOT_PREFS.includes(x as SlotPref);

export function slotFits(pref: SlotPref | null | undefined, slot: "lunch" | "dinner") {
  if (!pref || pref === "either") return true;
  if (pref === "breakfast") return false;
  return pref === "supper" ? slot === "dinner" : slot === "lunch";
}
