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

## 3. Auth settings in Supabase

- **Authentication > URL Configuration:** Site URL `https://familymealplanner-inky.vercel.app`, and add
  `https://familymealplanner-inky.vercel.app/**` and `http://localhost:3000/**` to Redirect URLs.
- **Authentication > Emails > Magic Link:** replace the link in the template with

  ```html
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Sign in to the meal planner</a>
  ```

  so a link requested on a laptop can be opened on a phone. The default template also works, but only in the
  browser that asked for the link.

## 4. Vercel environment variables

Add to the Vercel project (Production and Preview), then redeploy:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Who can sign in

Only emails listed in `household_members`. Anyone in the household can add more on the Household page.
Signing in with any other email works but shows no data (row-level security on every table).
