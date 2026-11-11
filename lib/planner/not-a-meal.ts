// Things written in a meal slot that are not a meal and have no recipe: Sobras (leftovers),
// take-away and eating out. The planner never suggests them, the library never adds them,
// and the gluten page does not list them. No imports, so anything can use it.

// Sobras (leftovers) are never a meal, whatever the library holds.
export const isSobras = (name: string) => /\b(sobras?|leftovers?)\b/i.test(name);

// Take-away and eating out (the owner's answer, 11 November 2026).
const TAKEAWAY = /\b(take[\s-]?aways?|eat(?:ing)? out|comer fuera|cenar fuera|cena fuera|comida fuera|comida para llevar|nando'?s|chippers?)\b/i;
export const isTakeaway = (name: string) => TAKEAWAY.test(name);

export const isNotAMeal = (name: string) => isSobras(name) || isTakeaway(name);
