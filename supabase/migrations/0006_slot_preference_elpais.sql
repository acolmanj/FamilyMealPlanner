-- Plan the week: each meal's usual slot, and new ideas from El País.
-- Safe to run more than once.

-- Which slot a meal usually fills. 'supper' is dinner; 'either' fits lunch and dinner;
-- 'breakfast' is never planned for lunch or dinner.
alter table public.meals add column if not exists slot_preference text not null default 'either';
alter table public.meals drop constraint if exists meals_slot_preference_check;
alter table public.meals add constraint meals_slot_preference_check
  check (slot_preference in ('supper', 'either', 'lunch', 'breakfast'));

-- Recipes added from El País keep the page they came from, once per household.
alter table public.meals add column if not exists source_url text;
create unique index if not exists meals_source_url_idx on public.meals (household_id, source_url) where source_url is not null;
alter table public.meals drop constraint if exists meals_source_check;
alter table public.meals add constraint meals_source_check check (source in ('menu', 'ai', 'imported', 'elpais'));

-- When a recipe feed was last read, so planning does not fetch it on every tap.
create table if not exists public.feed_checks (
  household_id uuid not null references public.households(id) on delete cascade,
  feed text not null,
  checked_at timestamptz not null default now(),
  ok boolean not null default true,
  primary key (household_id, feed)
);
alter table public.feed_checks enable row level security;
drop policy if exists "household access" on public.feed_checks;
create policy "household access" on public.feed_checks for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
grant select, insert, update, delete on public.feed_checks to authenticated;

-- Backfill from the menu sheet history (same as supabase/data/meal_slot_preferences.sql):
-- 70% or more of a meal's uses at dinner is 'supper', at lunch is 'lunch', else 'either'.
-- Only meals still on 'either' change, so a preference set by hand is kept.
update public.meals m set slot_preference = v.pref
from (values
('Alcachofas salteadas', 'supper'),
('Alitas de Pollo (One Pot Book)', 'supper'),
('Amburguesas', 'lunch'),
('Arroz a la cubana', 'lunch'),
('Beef bourginon', 'lunch'),
('Bunsens', 'supper'),
('Calabaza con alubias/garbanzos (variants)', 'lunch'),
('Chuletas de cerdo con puré de patatas', 'lunch'),
('Cordero asado / roast lamb', 'lunch'),
('Curry de cangrejo (Jamie)', 'lunch'),
('Curry Rogan Josh (lamb)', 'lunch'),
('Ensalada de gnoquis crujientes', 'supper'),
('Ensalada de lentejas', 'supper'),
('Ensalada de lentejas y adamame', 'supper'),
('Ensalada templada de boniato y rúcula', 'supper'),
('Ensalada verde', 'supper'),
('Fajitas de Pollo', 'lunch'),
('Fish fingers', 'supper'),
('Jamie''s beans', 'supper'),
('Lentejas estofadas (variants)', 'lunch'),
('Loaded black bean nachos', 'supper'),
('Nachos con carne', 'lunch'),
('Pancakes con salmón', 'supper'),
('Pasta', 'lunch'),
('Pasta boloñesa (variants)', 'lunch'),
('Pasta carbonara', 'lunch'),
('Pasta con albóndigas', 'lunch'),
('Pasta con atún (variants)', 'lunch'),
('Pasta con chorizo (variants)', 'lunch'),
('Pasta con garbanzos y tomatitos', 'lunch'),
('Pasta con Pollo', 'lunch'),
('Pasta pesto', 'lunch'),
('Pastel de pescado', 'lunch'),
('Patatas al horno can bacon y ensalada verde', 'lunch'),
('Patatas asadas con bacon y ensalada', 'supper'),
('Patatas asadas con ensalada', 'supper'),
('Pechugas de Pollo', 'supper'),
('Pechugas de Pollo al horno con tomates y wedges. Ensalada de rúcula', 'supper'),
('Pechugas de pollo con patatas asadas y ensalada', 'lunch'),
('Pescado con ensalada de tomates y aguacate', 'supper'),
('Pisto (variants)', 'lunch'),
('Pizza', 'supper'),
('Pollo', 'supper'),
('Pollo asado con patatas', 'lunch'),
('Pollo pochado', 'supper'),
('Puré de ''naranja''', 'supper'),
('Puré de alubias', 'supper'),
('Risoto', 'lunch'),
('Risotto', 'lunch'),
('Salchichas / sausages (variants)', 'supper'),
('Salmón con arroz', 'lunch'),
('Smash burgers (Alex)', 'lunch'),
('Solomillos de vaca', 'lunch'),
('Sopa', 'supper'),
('Sopa de calabaza y naranja (Arguinano Pg 96)', 'supper'),
('Sopa de garbanzos con fideos', 'supper'),
('Sopa de zanahoria', 'supper'),
('Sopa de zanahorias y gengibre', 'supper'),
('Stakes con patatas al horno', 'lunch'),
('Tortilla de berenjena con ensalada', 'lunch'),
('Tortilla de brocoli y queso con esnsalada de tomate', 'supper'),
('Tortilla de patatas con ensalada', 'supper'),
('Tortilla rápida de patatas y ensalada', 'supper'),
('Tostada con aguacate/huevos (variants)', 'supper'),
('Tostis / tosties', 'supper')
) as v(name_group, pref)
where m.name_group = v.name_group and m.slot_preference = 'either';
