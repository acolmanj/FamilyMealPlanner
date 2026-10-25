-- Phase 2: the owner can confirm that the household cooks a meal gluten-free.
-- A confirmed meal shows as Safe, and its GF swaps (gf_swap_note) are kept so
-- the shopping list still asks for the GF-labelled products.

alter table public.meals add column if not exists gf_confirmed_at timestamptz;
alter table public.meals add column if not exists gf_confirmed_by text;
