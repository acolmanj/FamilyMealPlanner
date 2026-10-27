-- Meal photos and recipe ideas from TheMealDB, or a free Wikimedia Commons image.
-- image_query says where to look ("mealdb:<id>" or "wiki:<lang>:<Title>"); null means search by name.
alter table public.meals add column if not exists image_query text;
alter table public.meals add column if not exists image_url text;
alter table public.meals add column if not exists image_source text;      -- 'themealdb' | 'wikimedia'
alter table public.meals add column if not exists image_page_url text;    -- where the image and recipe come from
alter table public.meals add column if not exists mealdb_id text;
alter table public.meals add column if not exists mealdb_name text;
alter table public.meals add column if not exists mealdb_ingredients text[];
alter table public.meals add column if not exists image_checked_at timestamptz;
