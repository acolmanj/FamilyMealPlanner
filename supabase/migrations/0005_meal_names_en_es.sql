-- Display names in English and Spanish. `name` stays the key the seed and history use.
alter table public.meals add column if not exists name_en text;
alter table public.meals add column if not exists name_es text;
