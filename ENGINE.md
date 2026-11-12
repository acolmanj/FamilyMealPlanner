# Family Meal Planner: how the planner works

Updated Nov 12, 2026 · @John

This page explains, in plain words, how the app plans the week today. Everything here is done by ordinary code: there is no AI and no scoring. The same rules check a week whether the planner filled it or you did.

The code lives in `lib/planner/` (`rules.ts` for the rules and suggestions, `generate.ts` for filling a week, `plan.ts` for Plan week).

## The week

Each week has 14 slots: lunch and dinner, Monday to Sunday. There is no breakfast slot, no lunchbox slot and no leftovers ("Sobras") slot. A slot can hold a meal from the library or a bit of free text.

## Which meals the planner can use

The planner picks from the meal library, leaving out:

- **Meals blocked for gluten.** This is the only gluten check on planning. Meals shown as Safe, "Needs substitution" or "Needs your check" can all be planned; only Blocked is left out. A meal confirmed on the Gluten page shows as Safe.
- **Breakfasts.** A meal whose usual slot is Breakfast is never planned for lunch or dinner.
- **Things that are not a meal.** Sobras (leftovers), take-away and eating out.
- **Retired or blacklisted meals.** They are not loaded at all.
- **El País ideas that are not clean.** See "El País ideas" below.
- **Meals already in the week.** No meal is planned twice in the same week.

## The rules that are always kept

When Plan week fills a slot, these rules are never broken:

1. **Traditions.** Sunday lunch is a roast and Saturday dinner is pizza (on a gluten-free base), as long as the library has a roast and a pizza. Pizza is never put anywhere else. A roast is a roasted joint of meat, spotted from any of the meal's names (Spanish or English), so "Pollo" with the English name "Roast Chicken with tomato & Chorizo" counts.
2. **No repeats.** No meal more than once in the week.
3. **Daily mix.** Each day has one vegetarian meal and one meat or fish meal.
4. **Pasta.** 2 pasta meals or fewer in the week.
5. **Ready-made food.** 2 ready-made meals (fish fingers, nuggets, sausages and so on) or fewer.
6. **No long cooks on weeknights.** A meal marked as a long cook is never planned for dinner Monday to Friday.
7. **New meals.** At most 1 meal the family has never had before.
8. **Weekends only.** A meal marked "Weekends only" is only planned on Saturday or Sunday, lunch or dinner. When the mark was added, every roast already in the library got it (for example "Cordero asado", "Pollo asado con patatas", "Roast Chicken with tomato & Chorizo"). A meal added later gets the box ticked for you on the Add a meal form if its name looks like a roast, and you can tick or untick it for any meal on the Meals page.

## The rules that can give a little

These are tried first. If the week can't be filled with all of them, the planner lets them go one at a time, in this order, and the page says which one gave:

1. **Starch spacing.** The same starch (pasta, potatoes, rice or noodles) not twice within 3 days.
2. **Recency.** A meal not used within 3 weeks of another week where it is planned (looking both back and forward). First this drops to 2 weeks, then it is dropped. The Sunday roast and the Saturday pizza don't count: having them every week is the point.
3. **Usual slot.** A meal that is usually a lunch goes to lunch, and one that is usually a dinner goes to dinner. ("Either" meals go anywhere.)
4. **Fish and pulses.** At least 1 fish meal and at least 2 pulse meals (lentils, beans, chickpeas) in the week.

The weekends-only rule is never relaxed. If a week truly can't be filled, the planner fills none of that week's empty slots and says so.

## How the planner picks

The planner shuffles the library using a seed (a random number), then fills the slots one by one, trying meals in shuffled order and backing up when it gets stuck. It always fills next the slot with the fewest meals that still fit, so tight slots like Sunday lunch are not left to the end. The same seed always gives the same week; Plan week uses a new seed each time.

The shuffle is weighted, so some meals come up sooner:

- **Favourites** (starred on the Meals page) come up about 2.5 times as readily.
- **New El País ideas** come up about 2 times as readily. The "at most 1 new meal" rule still applies.

Every rule above still applies to favourites and ideas. Each planned slot gets a short "why" line, such as "Sunday roast", "pulses", "favourite", "a usual dinner" or "last had 6 weeks ago".

## Plan week

The Plan week button in the middle of the tab bar fills the empty slots of this week and next.

- Everything already planned stays as it is.
- Days of this week that have already passed (Irish time) are left alone.
- Next week is planned with this week counted as history, so meals don't repeat across the two weeks.
- Just before saving, it reads the slots again. A slot someone else filled in the meantime is left alone, and the summary says so.
- Undo takes out only what that run added, and only where nothing has changed since.

## El País ideas

Plan week first adds up to 3 recent El País recipes to the meal library, at most once every 6 hours (after a failed try, it tries again after 30 minutes). Nobody in the house has cooked these gluten-free yet, so they are checked more strictly than the family's own meals:

- Any sign of gluten in the ingredients (wheat flour, pasta, noodles, bread, breadcrumbs, beer, couscous, soy sauce, pastry and many more) means the recipe is not added.
- A recipe that uses stock is still added, and shows "Use gluten-free stock".
- A recipe whose page had no ingredient list is added but never planned until you check it.
- The rest show "New · check gluten" until you confirm them on the Gluten page.

The planner checks this again every time it loads the library, so an idea is only planned when its ingredients came from the recipe page and showed nothing.

## Changing the plan by hand

- **Tap a slot** to see swap suggestions, search all meals, move the meal, clear the slot, or fix the meal's facts (protein, starch, effort, pasta, ready-made).
- **Bin icon.** Each filled slot has a small bin in its bottom-right corner that clears it straight away. A message ("Cleared Tue lunch · Undo") stays for 8 seconds, and Undo puts the meal or text back.
- **Drag** a meal from the suggestions onto a slot, or drag a planned meal to another slot (they swap places) or onto the panel to remove it. On a phone, hold the meal first.
- **Reason chips.** After a swap, move or clear from the slot panel you can tap a reason (too much pasta, not in the mood, no time, guests, other) or skip. The bin and drag-to-remove don't ask.
- **Warn, don't block.** Only gluten blocks: a meal blocked for gluten can't be put in a slot. Anything else you do by hand is allowed, and Week check lists a warning instead, such as "Pasta 3, target 2 or fewer" or "Roast lamb is a weekends-only meal but is on Tue lunch". A weekends-only meal on a weekday also gets a small amber "Weekends only" tag on its tile.

## Swap suggestions

Tapping a slot suggests 5 meals that fit it. It leaves out meals already in the week, meals blocked for gluten, breakfasts, El País ideas that are not clean, meals used within the last 3 weeks (2 if pinned; the Sunday roast and Saturday pizza are exempt), and, on Monday to Friday, weekends-only meals. The rest are listed in this order:

1. The day's tradition (a roast on Sunday lunch, pizza on Saturday dinner).
2. Meals whose usual slot matches (a dinner meal for dinner).
3. The protein that fits: the same protein as the meal being swapped, or, for an empty slot, the opposite of the other meal that day (vegetarian if it is meat or fish, and the other way round).
4. Pulses, if the week has fewer than 2.
5. Fish, if the week has none.
6. Favourites.
7. Meals the family has had before, ahead of new ones.
8. The meal not had for the longest, then by name.

The side panel ("Suggested meals") is not tied to a day. It shows 10 meals, taking meat, vegetarian, fish and pulse meals in turn, with pulses and fish first if the week is missing them. It skips meals already in the week and meals had in the last 3 weeks (2 if pinned). A weekends-only meal can show here; its tile says "Weekends only", as it does in search results.

## Pinned meals

The database has a "pinned" mark on meals, and the code treats a pinned meal like a favourite with a shorter recency gap (2 weeks instead of 3). Nothing in the app sets it, so in practice no meal is pinned.

## What the app stores

The Supabase tables the planner uses:

| Table | What it holds |
| --- | --- |
| meals | The meal library: names in English and Spanish, protein, starch, effort, pasta, ready-made, usual slot, weekends only, favourite, gluten checks, photo |
| plan\_slots | One row per day and slot: the meal or free text, and the why line |
| adjustments | Every hand change (swap, move, clear) and its reason chip, if given. An undone clear is taken out |
| feed\_checks | When El País was last read |

The tables `ingredients`, `freezer_items`, `house_rules`, `week_notes`, `gluten_rules` and `purchases` exist but the app doesn't read them yet. The seed fills `gluten_rules` (the gluten tiers as written) and `purchases` (old Tesco receipts).

## Not built yet

These ideas were in the first plan. They are kept here so they aren't lost, but the app doesn't do any of them today:

- **Lunchboxes.** A weekday lunchbox slot, outside the once-a-week rule.
- **Freezer and leftover portions.** Recording portions frozen from a big cook (usable for 30 days), filling a later "Sobras" slot from the oldest one, a nudge before they expire, and no shopping for them.
- **Seasonality.** Preferring Irish (or Spanish) seasonal produce.
- **Weekend effort levels.** Elaborate cooks for weekend lunch, quick ones for busy nights, normal for work-from-home days.
- **Weekly notes and an AI helper.** Turning notes like "football Tuesday, more fish" into choices you confirm, suggesting new meals from other recipe sites, and writing the why lines.
- **Learning from corrections.** Counting changes from the adjustment log and proposing house rules for you to approve (for example "stop planning this on Thursdays" after it is moved off Thursday 3 times out of 4), with a page to see and switch them off.
- **Shopping and budget.** Shopping lists, a budget, a Lidl checklist and a Tesco basket built from the plan.
