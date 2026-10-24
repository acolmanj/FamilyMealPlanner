# Family Meal Planner: prediction engine

Oct 24, 2026 · @John

The engine builds a valid, explainable week with deterministic code, uses AI only for notes, new recipes and wording, and learns by proposing visible rules that you approve.

## Pipeline

Each weekly run follows the same five steps. Only step 3 uses AI, and everything it returns is checked by code.

1. **Read inputs.** The meal library, the last 8 weeks of plans, the freezer stock, this week's notes, pinned and blacklisted meals, and the house rules.
2. **Build the candidate pool.** Remove every meal that is unsafe, blacklisted, too recent or out of season.
3. **Parse notes and propose new meals.** AI turns free-text notes into confirmable chips and suggests the 10% new meals. Each must pass the gluten gate.
4. **Solve the week.** Deterministic code fills the 21 slots under the rules below, using a seeded shuffle so a regenerate is different but reproducible.
5. **Explain and publish.** Each cell gets a factual reason, then the plan, balance counts, shopping lists and budget are built from it.

## Candidate pool

A meal enters the pool only if it passes all five tests. These are code checks and the AI cannot override them.

- **Gluten gate.** Every ingredient screened as Safe. Anything unverifiable goes to "Needs your check" and the meal is replaced or marked as a swap.
- **Not blacklisted.**
- **Recency.** Not planned in the last 3 weeks, or 2 weeks if pinned. Frozen portions from an earlier cook are exempt.
- **In season.** Irish seasonal produce by default, Spanish seasonality for Spanish recipes.
- **Attributes known.** Effort, main protein, main starch and vegetarian flag must all be filled in, because the solver needs them.

## Constraint solver

The solver fills Monday to Sunday lunch, dinner and the weekday lunchbox. It searches by backtracking. Hard rules are never broken: if no valid week exists, the solver names the rule that blocked it. Soft rules are tried first and then produce a warning instead of a failure.

| Rule | Type | Value |
| --- | --- | --- |
| Gluten gate | Hard | Only Safe meals |
| Traditions | Hard | Sunday lunch roast with GF gravy; Saturday dinner pizza on a GF base |
| Fish | Hard | At least 1 fish meal a week |
| Repeats | Hard | No meal more than once a week. A leftover slot counts as a second use |
| Daily mix | Hard | One meat meal and one vegetarian meal each day |
| Pasta | Hard | 2 pasta meals or fewer a week |
| Processed or ready meals | Hard | 2 or fewer a week |
| Effort | Hard | Mon-Fri dinner Quick (15-20 min); weekend lunch Elaborate (60+ min); everything else Normal (30-45 min). Busy nights Quick; work-from-home days Normal or better |
| Old to new mix | Hard | 90% past meals, 10% new. About 1 new meal a week; 0 on request |
| Starch spacing | Soft | The same starch (pasta, potatoes, rice or noodles) not twice in any 3-day window |
| Balance targets | Soft | Fish, vegetarian, legume and red-meat counts, shown as plain counts and never as a score |

**Tie-breaks** use plain facts only, in this order: pinned first, then longest since last planned, then the slots the meal has historically filled. The planner computes no scores or ratings.

**Eating out.** Take-away or eating out is a slot with no recipe and no shopping. It is only included on request.

## Leftovers and freezer

Because a leftover slot counts as a second use, a big cook and its leftovers can never fall in the same week. Extra portions go to the freezer and appear in a later week's "Sobras" slot.

- **Freezing.** When a big cook (roast, stew, curry, chili) makes extra portions, the plan records the meal, number of portions and date frozen. Each portion is usable for 30 days from that date.
- **Filling Sobras slots.** The solver uses the oldest eligible frozen portion first.
- **First weeks.** With no freezer stock, Sobras slots stay empty and the solver fills them with other meals.
- **Counting.** Eating a frozen portion counts as a use of that meal in the week it is eaten, so no fresh cook of the same meal that week. It is exempt from the 3-week recency rule, because the cooking already happened.
- **Expiry nudge.** Portions still frozen at about 3 weeks appear under "Needs your attention".
- **Shopping.** A meal served from the freezer adds nothing to the shopping lists.
- **Gluten.** Frozen portions came from Safe meals and need no new screening.
- **Lunchboxes.** Weekday lunchboxes are outside the once-a-week rule, so a lunchbox made from last night's dinner does not count as a second use. This is an assumption to confirm.

## AI layer and explanations

The language model helps with three jobs and has no say in the rules.

- **Parse weekly notes.** Free text such as "football Tuesday, busy Thursday, more fish" becomes chips (busy night, work from home, event, request) that you confirm.
- **Propose new meals.** About 10% of the week comes from your sources (BBC Good Food, Jamie Oliver, El Comidista, Serious Eats, NYT Cooking). Every ingredient line is screened as Safe, Needs substitution or Blocked, and Blocked recipes are dropped.
- **Write the why line.** Each meal gets a short factual reason, such as "pinned, last planned 5 weeks ago" or "gives the week its second fish meal".

All model output must match a fixed schema and then pass the gluten gate and the solver. If it fails, the engine falls back to the past-meal pool and says so on the page.

## Correcting the plan

Corrections should take one or two taps.

- **Swap.** Tap a meal and get 3 alternatives that fit that slot's rules.
- **Move.** Drag a meal to another day or slot.
- **Lock.** Anything you touch becomes locked, and "Refill the rest" regenerates only the unlocked cells.
- **Warn, don't block.** A change that breaks a rule shows a warning ("this makes pasta 3, target 2"). Only the gluten gate blocks.
- **Live updates.** The balance counts, shopping lists and budget update after every edit.
- **Reason chips.** After a swap you can optionally tap one reason: too long, had it recently, not in the mood, ingredient problem.

## Learning from corrections

The planner learns by counting your corrections and proposing rules that you approve. It keeps no hidden weights, scores or rankings, so nothing influences the plan unless it appears on the house rules page.

- **Adjustment log.** Every swap, move, removal, lock, pin and reason chip is stored with before and after.
- **Rule proposals.** When a count passes a threshold, the planner proposes a rule and waits for a yes or no.
- **House rules page.** It lists every active rule with its evidence and an off switch, and deleting a rule removes its effect.
- **Attribute fixes.** If you correct a meal's effort, protein or starch, the library is updated directly.
- **Progress measure.** The number of cells you change each week. It is a count about the engine, not a rating of meals, and it should fall over time.

Example proposals, with suggested starting thresholds to adjust:

| Pattern in the log | Proposed rule |
| --- | --- |
| A meal moved off the same day 3 of 4 times | Stop planning it on that day |
| A meal swapped out 3 times | Blacklist it |
| A meal planned and eaten 4 times | Pin it as a favourite |
| The same weekday marked busy every week | Make that weekday Quick by default |
| Same-starch spacing overridden repeatedly | Relax the 3-day gap for that starch |

## Data tables

These are the tables in Supabase that the engine reads and writes. Column lists are a starting point and Claude Code can refine them.

| Table | Holds | Key columns |
| --- | --- | --- |
| meals | The meal library | name, effort, main\_protein, main\_starch, vegetarian, fish, processed, pinned, blacklisted, source |
| ingredients | Each meal's ingredient lines | meal\_id, item, quantity, unit, gluten\_tier, gluten\_status |
| plan\_slots | One row per day and slot | week\_start, day, slot, meal\_id, locked, is\_leftover, why |
| freezer\_items | Frozen portions | meal\_id, portions, frozen\_on, use\_by (frozen\_on + 30 days) |
| adjustments | The correction log | slot\_id, action, before\_meal\_id, after\_meal\_id, reason, created\_at |
| house\_rules | Approved learned rules | kind, scope, evidence, active |
| week\_notes | Parsed weekly notes | week\_start, kind, day, confirmed |
| purchases | Receipt history, kept minimal | product, quantity, price, date, substitution\_outcome |

## Build order and assumptions

1. Meal library import, the gluten gate, and the solver with a read-only week.
2. The editable board with locks, the shopping builder and the Lidl checklist.
3. The freezer, adjustment log and rule proposals.
4. Notes parsing and new-meal suggestions.
5. Receipts, then the Tesco basket assistant behind a switch, with the plain list as a fallback.

**Assumptions to confirm**

- Weekday lunchboxes are outside the once-a-week rule.
- A frozen portion is exempt from the 3-week recency rule but counts as a use in the week it is eaten.
- About 1 new meal a week satisfies the 90/10 mix.
- The starch rule counts the starch that defines the meal, not a small side.
- The learning thresholds in the table are starting points.
