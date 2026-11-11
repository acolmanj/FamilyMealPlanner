# Setup (Phase 1)

One-time steps to connect the app to Supabase.

## 1. Create the Supabase project

Free plan, region West EU (Ireland). Keep the database password to yourself.

## 2. Create the tables and load the seed

Either:

- **SQL editor (no tools needed):** run `HOUSEHOLD_EMAILS=you@example.com npm run seed -- --setup setup.local.sql`
  (or use the `setup.sql` you were given), open Supabase > SQL Editor > New query, paste the whole file and press Run.
- **From your machine:** set `DATABASE_URL` (Supabase > Connect > Session pooler) and `HOUSEHOLD_EMAILS`, then `npm run seed`.

Both are safe to run again: rows are updated in place, never duplicated.
`setup.local.sql` is git-ignored because it holds the household emails.

## 3. The family account

Everyone gets in with one family passcode. Behind the scenes the server signs each browser in to one shared
Supabase account, so the database's row-level security keeps working unchanged.

- **Authentication > Users > Add user:** create the family account with an email and a long random password
  (tick "Auto confirm user").
- Make sure that email is in `household_members` (add it on the Household page, or by SQL).

## 4. Vercel environment variables

Add to the Vercel project (Production and Preview), then redeploy:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `FAMILY_PASSCODE`: the passcode people type (capital letters and spaces are ignored)
- `FAMILY_EMAIL` and `FAMILY_PASSWORD`: the family account from step 3

The last three are server-only. Never give them a `NEXT_PUBLIC_` name, and never commit them.

## Who can get in

Anyone who knows the family passcode. A browser that enters it stays signed in (the cookie lasts about a year
and refreshes each visit). Wrong guesses are slowed down on the server. To lock everyone out, change
`FAMILY_PASSWORD` in both Supabase and Vercel and redeploy; to change the passcode, change `FAMILY_PASSCODE`.

The data is still only readable by accounts whose email is in `household_members` (row-level security on every
table), so the public anon key alone shows nothing.
