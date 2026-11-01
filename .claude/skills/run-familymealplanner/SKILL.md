---
name: run-familymealplanner
description: Run, start, screenshot and review the UI of the Family Meal Planner web app locally with no Supabase project or email login. Use to launch the app, sign in, take phone/desktop screenshots in English or Spanish, click through a flow (plan a meal, edit the library), audit layout and accessibility, or check a UI change works before opening a PR.
---

# Run and review the meal planner UI

Next.js 15 app (Tailwind v4, shadcn-style `components/ui`) backed by Supabase. Agents
drive it with three pieces, all paths relative to the repo root:

- `.claude/skills/run-familymealplanner/fake-supabase.mjs` - a local Supabase stand-in on
  :54321: in-process PGlite with every migration + `supabase/seed.sql` + `supabase/data/*.sql`,
  a mini PostgREST that enforces the real RLS policies, and magic-link auth without email.
- `.claude/skills/run-familymealplanner/driver.mjs` - headless Chromium (Playwright): signs in,
  screenshots, prints a UI audit per page, runs your own flow scripts.
- `.claude/skills/run-familymealplanner/flows/` - example flows (`plan-a-meal.mjs`).

## Prerequisites

Node 22 and Playwright with Chromium (preinstalled in Claude cloud containers; elsewhere
`npm i -g playwright && npx playwright install chromium`). No Docker, Postgres or Supabase account.

```bash
npm ci
```

## Launch (agent path)

Start the backend, then the app pointed at it. Keep both running in the background.

```bash
nohup node .claude/skills/run-familymealplanner/fake-supabase.mjs > /tmp/fake.log 2>&1 &
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=fake-anon-key \
  NEXT_TELEMETRY_DISABLED=1 nohup npx next dev -p 3000 > /tmp/next.log 2>&1 &
until grep -q ready /tmp/fake.log && grep -q Ready /tmp/next.log; do sleep 1; done
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" localhost:3000/week   # 307 .../login = up
```

The signed-in user is `cook@example.com` (a household member). Override with `MEMBER_EMAIL=`
on both the backend and the driver. Every backend request is logged to `/tmp/fake.log` with its
status, which is the quickest way to see what a page or server action queried.

## Drive it

```bash
D=.claude/skills/run-familymealplanner/driver.mjs
node $D shot /week                       # phone 390x844, English -> shots/week-phone-en.png
node $D shot /meals --desktop --lang es  # 1280 wide, Spanish
node $D tour                             # every page, phone + desktop
node $D run .claude/skills/run-familymealplanner/flows/plan-a-meal.mjs
```

Screenshots are full-page PNGs in `./shots` (set `SHOTS_DIR` to move them; `shots/` is
git-ignored). **Open every screenshot you take and look at it** - the audit cannot see bad spacing,
clipped text or wrong colours.

Each command prints JSON like:

```json
{ "url": "http://localhost:3000/week", "screenshot": ".../shots/week-phone-en.png",
  "smallTapTargets": { "count": 3, "e_g": ["Sign out", "Week check", "Search all meals"] },
  "externalBlockedBySandbox": 9, "consoleErrors": [] }
```

Audit keys appear only when something is found: `horizontalOverflow`, `brokenImages`,
`imagesWithoutAlt`, `unnamedControls`, `smallTapTargets` (under 24px, WCAG 2.2 AA),
`consoleErrors`. `externalBlockedBySandbox` counts outside requests (meal photos) the network
blocked; those are drawn as grey "photo" boxes and are not app bugs. Compare against `main` before
blaming a change: on `main`, `/week` already reports the 3 small targets above.

### Writing a flow

A flow is a module whose default export gets `{ page, APP, shot, audit, errors }`, already
signed in. `flows/plan-a-meal.mjs` taps the first suggestion, taps "Mon Lunch", waits for the
slot's `aria-label` to change, reloads to prove the server action saved it, and screenshots.
Good selectors here: board cells are buttons labelled `"<Day> <Slot>: <meal or empty>"`
(e.g. `getByRole("button", { name: /^Mon Lunch:/ })`), the cell dialog is
`role="dialog"`, search boxes have `aria-label` = their placeholder. Labels follow the
language cookie, so match English text only with `--lang en`.

## UI review checklist

When asked to build or review UI here, check in this order:

1. **Phone first.** The family uses phones; `shot` defaults to 390px. Then `--desktop`.
2. **Both languages.** Every string lives in `lib/i18n/messages.ts` under `en` and `es`;
   `tests/i18n.test.ts` fails if a key is missing in one. Spanish labels are often longer - re-shoot
   with `--lang es` and look for wrapping and truncation.
3. **Theme tokens, not raw colours.** Colours are CSS variables in `app/globals.css`
   (`--primary`, `--muted`, `--destructive`, `--warning`, ...); protein colours are meat red,
   fish blue, veg green. Reuse `components/ui/*` (Button, Card, Badge, Input).
4. **Audit clean or no worse than `main`**, and no `consoleErrors`.
5. **Rules the household set:** "Sobras" (leftovers) never appears as a meal; pulses show up
   regularly; gluten status badges (Safe / Needs your check / Needs substitution / Blocked) stay visible on tiles.
6. `npm run lint && npm test` (tsc + vitest, about 10s).

## Run (human path)

`cp .env.example .env.local`, fill in the real Supabase URL and anon key, `npm run dev`, open
http://localhost:3000 and sign in through a real emailed magic link. Not usable headless. With
the fake backend instead, typing any email on `/login` prints the sign-in link to `/tmp/fake.log`.

## Stop

```bash
pkill -f "[n]ext dev"; pkill -f "[f]ake-supabase.mjs"
```

Data lives in memory: restarting the backend resets it to the seed.

## Gotchas

- **Data is the repo seed, not production.** Many meals show "Needs your check" / "Needs substitution" locally
  even where the household confirmed them in the real database. Do not "fix" badges because of it.
- **State survives between driver runs** while the backend is up (a flow that fills Mon lunch
  sees it filled next time). Restart `fake-supabase.mjs` for a clean slate.
- **Meal photos are blocked in Claude cloud containers** (themealdb.com, wikipedia are not on the
  allowlist: `CONNECT tunnel failed, response 403`). The driver swaps in grey placeholders and
  filters the resulting `ERR_TUNNEL_CONNECTION_FAILED` console noise.
- **Playwright's default screenshot hides the caret by adding `style="caret-color:transparent"` to
  inputs**, which raised a false "tree hydrated but some attributes ... didn't match" error on
  `/gluten`. The driver passes `caret: "initial"`; keep it if you screenshot yourself.
- **The Next.js dev badge** (black "N" circle) covers the bottom-left of shots; the driver hides
  `nextjs-portal`.
- **The fake PostgREST covers only what the app uses**: `select` with one level of embeds
  (`meals(...)`), `eq neq gt gte lt lte like ilike is in not.*`, `order`, `limit`, `offset`,
  insert/upsert (`on_conflict` + `resolution=merge-duplicates`), update, delete, `single()`.
  A new query using anything else returns `400 ... not supported by fake-supabase` in
  `/tmp/fake.log` - add it to `whereClause`/`projection` in `fake-supabase.mjs`. No `rpc`, storage
  or realtime.
- **Rows come back as Postgres JSON** (`json_agg`), so dates are `"2026-10-19"` like real
  PostgREST. Returning PGlite rows directly gave JS `Date`s (`"2026-10-19T00:00:00.000Z"`).
- **`pkill -f "next dev"` kills the shell running it** (exit 144), because the pattern matches that
  shell's own command line. The `[n]ext dev` bracket form in Stop avoids it.

## Troubleshooting

- `sign-in landed on http://localhost:3000/login?error=link` -> backend not running, or the app
  was started without `NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321`. Restart `next dev` with
  the env vars; they are read at start-up.
- App shows "set NEXT_PUBLIC_SUPABASE_URL..." setup screen -> same: env vars missing.
- Pages load but are empty -> the signed-in email is not in `household_members` (RLS hides
  everything, as in production). Use `cook@example.com` or the same `MEMBER_EMAIL` on both sides.
