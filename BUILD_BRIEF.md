# Family Meal Planner: Claude Code build brief

Oct 24, 2026 · @John

## Goal and context

Build a weekly meal planner for a family of 5 (2 adults, 3 children) that proposes a gluten-free week, is quick to correct, and learns from corrections without scores. It extends the live skeleton at https://familymealplanner-inky.vercel.app/.

- **Household:** everyone eats the same gluten-free meals. Shops at Tesco Ireland and Lidl, budget €500 a week across both.
- **Source of truth for behaviour:** `ENGINE.md` in the repo root (rules, freezer, learning) and "Weekly Meal Agent Instructions" (gluten tiers, traditions).
- **Source of truth for data:** four CSV/MD files prepared from the family's own menus and receipts (see Seed data).
- **Who builds:** Claude Code, in small phases. Each phase ends with a check the owner can see working before the next starts.

## Rules the code must enforce

Gluten is the only rule that blocks. Everything else warns and lets the owner override.

| Rule | Type | Detail |
| --- | --- | --- |
| Gluten gate | Hard, blocks | Tier A never; Tier B only a GF-labelled product; Tier C needs a label check; unreadable label goes to "Needs your check". No substitutions of GF lines in baskets. |
| Traditions | Hard | Sunday roast, Saturday pizza (GF base). |
| Fish | Hard | At least 1 fish meal a week. |
| Once a week | Hard | No meal more than once a week. A leftover slot counts as a second use. |
| Daily mix | Hard | One meat meal and one vegetarian meal each day. |
| Pasta and processed | Hard | 2 or fewer pasta meals and 2 or fewer processed meals a week. |
| Effort by day | Hard | Busy nights get Quick meals. |
| Old and new | Hard | 90% past meals, 10% new (about 1 new meal a week). |
| Recency | Hard | A meal is not repeated within 3 weeks (2 if pinned). A frozen portion is exempt but counts as a use in the week eaten. |
| Starch spacing | Soft | Same starch (pasta, potatoes, rice, noodles) not twice in any 3-day window. |
| Balance | Soft | Show plain counts per week. Never a score or a rating. |

Freezer: extra portions from big cooks are frozen and usable for 30 days. Sobras slots are filled oldest first. Nudge about expiry at roughly 3 weeks. Frozen meals need no shopping.

No scoring anywhere in the app. Progress is measured by a weekly count of cells the owner had to change.

## Stack and setup

The site already runs on Vercel, so keep the stack and add to it.

- Next.js (App Router), TypeScript, Tailwind, shadcn/ui, deployed on Vercel from GitHub.
- Supabase free plan for Postgres, household login and live shared checklist ticks. Free plan pauses after 7 days idle, so add a daily keep-alive ping.
- Household auth: one shared household with a few logins (email magic link). Row-level security on every table, keyed by household id.
- Secrets (Supabase keys, AI key) in Vercel environment variables, never in the repo.
- The solver is plain TypeScript with a seeded random shuffle. It must be a pure function with unit tests, so the same inputs and seed always give the same week.
- The AI call is server-side only, returns JSON checked against a schema, and can never override the gluten gate.

## Data model

Eight tables, all with `household_id` and RLS. Names are suggestions; keep the columns.

| Table | Holds | Key columns |
| --- | --- | --- |
| meals | Every meal idea, past and new | name, name\_group, slot\_type, effort (quick/normal/long), protein (meat/fish/veg), starch, is\_processed, is\_pasta, gluten\_tier, gf\_swap\_note, is\_favourite, pinned, last\_eaten, source (menu/ai/imported) |
| ingredients | Ingredient list per meal | meal\_id, name, qty, unit, store (tesco/lidl), gluten\_tier, needs\_label\_check |
| plan\_slots | One row per day and slot | week\_start, day, slot, meal\_id, status (proposed/locked/eaten), is\_leftover, from\_freezer\_id, why\_line, changed\_by\_user |
| freezer\_items | Frozen portions | meal\_id, portions, frozen\_on, expires\_on (frozen\_on + 30 days), used\_slot\_id |
| adjustments | Every correction the owner makes | slot\_id, action (swap/move/lock/remove), from\_meal, to\_meal, reason\_chip, created\_at |
| house\_rules | Learned and written rules | text, kind, proposed\_from\_count, enabled, created\_at |
| week\_notes | Free-text notes for a week | week\_start, note, parsed\_json |
| purchases | Cleaned receipt lines | order\_date, store\_section, product\_ordered, outcome, product\_delivered, line\_total\_eur, gluten\_screen\_draft |

Ingredient and shop lists are derived from `plan_slots`, never typed twice. Checklist ticks live on the shopping list rows so every phone sees them at once.

## Seed data

The four files are already in the `/Seed` folder of the repo (capital S). Write one idempotent script (`npm run seed`) that loads them. Re-running must not create duplicates.

| File | Loads into | Notes |
| --- | --- | --- |
| meals\_menu\_semanal.csv | meals, plan history | 154 slots over 11 weeks, 5 blank cells. Week order is reliable, sheet dates are not (use `week_no`). Weeks 4 to 11 are the last 8. `gluten_keyword_flag` is a keyword match only, not a screen. |
| favourites\_seed.csv | meals.is\_favourite | 11 groups seen 3 or more times in the last 8 weeks. Groupings are a draft; load only rows the owner marks `confirm_as_favourite`. |
| tesco\_receipts\_clean.csv | purchases | 97 lines from 3 orders, personal details already removed. Totals reconcile to the basket value. Includes substituted and unavailable lines. |
| gluten\_list\_for\_review.md | gluten rules | Tiers A to D plus 7 open questions. Seed the tiers as written; apply the owner's answers once given. |

The gluten draft screen on receipts and the keyword flag on meals are hints for the owner, never a clearance. Nothing is marked Safe until the gate has checked it against the confirmed list.

## Screens

Seven screens. Phone first, because the list is used in the shop and the plan is checked in the kitchen.

| Screen | Purpose | Must do |
| --- | --- | --- |
| This week | The plan grid, 7 days by lunch, dinner and Sobras | Tap a cell to swap (3 alternatives), move, lock or remove. "Refill the rest" re-solves unlocked cells. Warnings shown inline; only gluten blocks. Plain counts for fish, pasta, processed, new meals. A "why" line per cell. |
| Next weeks | Prediction preview, 2 to 4 weeks ahead | Same grid, lighter. Pin a meal to a week. Edits here feed the learning log. |
| Meal library | All meals, favourites, new ideas | Search, filter by tier, effort, protein. Mark favourite, pin, retire. Import a recipe URL and screen each ingredient line as Safe, Needs substitution or Blocked. |
| Shopping list | Built from the week, split Tesco and Lidl | Live tick-off shared across phones. Freezer meals add nothing. GF lines carry the exact product with no substitution allowed. Shows spend against €500. |
| Freezer | Frozen portions with expiry | Add portions after a big cook. Oldest first fills Sobras. Nudge at about 3 weeks. |
| Notes | Free text for the week | "Guests Friday", "no oven Tuesday". The AI turns these into constraints the owner confirms before use. |
| House rules | What the app has learned | Each rule in plain words with an on/off switch. Shows the weekly count of cells changed. Rule proposals appear here after the same correction is made repeatedly. |

Correction flow in every grid: tap, pick an action, optionally pick a reason chip (too much pasta, not in the mood, no time, guests, other). The reason is optional and one tap.

## Engine modules

Code decides, AI only helps around the edges. Build in this order, one module per file, each with tests.

1. **Candidate pool (code).** Filter meals by the gluten gate, recency, freezer stock and the week's notes. Output the eligible meals with their tags.
2. **Solver (code).** Backtracking search over the 7-day grid with a seeded shuffle. Fill traditions and locked cells first, then hard rules, then soft rules. If no week satisfies every hard rule, return the closest week plus a plain list of which rule could not be met.
3. **Leftovers and freezer (code).** Mark big cooks, create freezer rows, fill Sobras oldest first, count a leftover as a second use in the week eaten.
4. **AI layer (model).** Three jobs only: parse week notes into constraints, propose the roughly one new meal a week with a GF-screened ingredient list, and write the "why" line. Every output is checked against a schema; a failed check falls back to no AI text, never to a guess.
5. **Corrections and learning (code).** Log every action in `adjustments`. When the same correction repeats a set number of times (start at 3), propose a house rule in plain words. The owner switches it on. No hidden weights, no scores.

Tests to write first: gluten gate never lets a Tier A item through; same seed and inputs give the same week; once-a-week and leftover counting; starch spacing; freezer expiry at 30 days; 90/10 split over a 4-week run.

## Build phases

Each phase ends with a check the owner can see. Do not start the next phase until the check passes.

1. **Foundation.** Supabase project, 8 tables, RLS, household login, `npm run seed`. *Check:* log in on a phone and see the 154 past slots and the favourites.
2. **Gluten gate.** Tier A to D rules in code, tests, a screen that shows each meal as Safe, Needs substitution, Needs your check or Blocked. *Check:* the Monday ramen on the 26/10 block shows as Blocked with a GF swap suggested.
3. **Manual planner.** This week grid with swap, move, lock, remove and the warning chips, no solver yet. *Check:* build a full week by hand and see the plain counts update.
4. **Solver.** Candidate pool plus solver plus "Refill the rest". *Check:* generate 4 weeks in a row with no meal repeated inside a week, one fish meal a week, and Sunday roast and Saturday pizza in place.
5. **Shopping list.** Tesco and Lidl split, live ticks, €500 tracker, no-substitution flag on GF lines. *Check:* two phones tick items and both update within seconds.
6. **Freezer and leftovers.** Freezer screen, Sobras filling, expiry nudge. *Check:* a frozen portion fills a Sobras slot and adds nothing to the shopping list.
7. **AI layer.** Notes parsing, one new meal a week, why lines. *Check:* a note such as "guests Friday" becomes a constraint the owner confirms.
8. **Learning.** Adjustment log, rule proposals, House rules page. *Check:* repeating one correction three times produces a proposed rule that can be switched off.
9. **Polish.** Phone layout pass, keep-alive ping, error states, backup export of all tables.

## Open decisions for the owner

Claude Code should not guess these. Build with the stated default and flag it in the app until answered.

- [ ] Confirm the 11 favourite groups in favourites\_seed.csv. *Default:* none marked favourite.
- [ ] Answer the 7 gluten questions in gluten\_list\_for\_review.md after checking Coeliac Society of Ireland guidance. *Default:* the strictest reading (tinned beans and tortilla chips go to "Needs your check", Free From counts only with a GF statement).
- [ ] Do weekday lunchboxes fall outside the once-a-week rule? *Default:* yes, they are outside it.
- [ ] How should take-away and eating-out slots be handled, given they have no recipe to screen? *Default:* allowed as a marked slot with a reminder to check the menu for gluten.
- [ ] Add more Tesco receipts (they exist back to June 2025) for a longer purchase history? *Default:* use the three loaded.
- [ ] Which AI model and monthly spend limit for the AI layer? *Default:* smallest model that passes the schema checks, with a hard monthly cap set in the provider account.
