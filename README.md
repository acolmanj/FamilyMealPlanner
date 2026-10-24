# Family Meal Planner

Weekly gluten-free meal planner for the family. Next.js + Supabase on Vercel.

- What to build: [BUILD_BRIEF.md](BUILD_BRIEF.md) and [ENGINE.md](ENGINE.md)
- First-time setup: [docs/SETUP.md](docs/SETUP.md)

```bash
npm install
cp .env.example .env.local   # fill in the Supabase URL and anon key
npm run dev
npm test                     # seed + row-level security tests (in-memory Postgres)
npm run seed                 # rebuild supabase/seed.sql from /Seed (and apply it if DATABASE_URL is set)
```
