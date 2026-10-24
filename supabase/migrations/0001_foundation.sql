-- Phase 1: foundation schema.
-- Safe to run more than once: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- Households and who can sign in to them
-- ---------------------------------------------------------------------------

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- A login belongs to a household when its email is listed here. Signing in
-- with an unlisted email works but shows no data.
create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  primary key (household_id, email),
  constraint household_members_email_lower check (email = lower(email))
);

-- True when the signed-in user's email is a member of the household.
-- security definer so the RLS check can read household_members itself.
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid
      and m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------------------------------------------------------------------------
-- The eight data tables from the build brief
-- ---------------------------------------------------------------------------

create table if not exists public.meals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  name_group text not null,
  variants_seen text[] not null default '{}',
  slot_type text,                                   -- null = ordinary meal; 'take-away' for eating out
  effort text check (effort in ('quick', 'normal', 'long')),
  protein text check (protein in ('meat', 'fish', 'veg')),
  starch text,
  is_processed boolean,
  is_pasta boolean,
  gluten_tier text check (gluten_tier in ('A', 'B', 'C', 'D')),
  gluten_keyword_flag text,                         -- keyword hint from the seed, never a clearance
  gf_swap_note text,
  ingredients_note text,                            -- free text after the colon in the menu sheet
  recipe_source text,                               -- e.g. "Jamie", "One Pot Book"
  is_favourite boolean not null default false,
  favourite_seen_count integer,                     -- times seen in the last 8 weeks, from favourites_seed.csv
  pinned boolean not null default false,
  blacklisted boolean not null default false,
  retired boolean not null default false,
  last_eaten date,
  source text not null default 'menu' check (source in ('menu', 'ai', 'imported')),
  created_at timestamptz not null default now(),
  unique (household_id, name_group)
);

create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  meal_id uuid not null references public.meals(id) on delete cascade,
  name text not null,
  qty numeric,
  unit text,
  store text check (store in ('tesco', 'lidl')),
  gluten_tier text check (gluten_tier in ('A', 'B', 'C', 'D')),
  needs_label_check boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.freezer_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  meal_id uuid not null references public.meals(id) on delete cascade,
  portions integer not null check (portions >= 0),
  frozen_on date not null,
  expires_on date generated always as (frozen_on + 30) stored,
  used_slot_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.plan_slots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  week_start date not null,                         -- the Monday of the week
  week_no integer,                                  -- order in the original menu sheet (seed history only)
  day text not null check (day in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
  slot text not null check (slot in ('lunch', 'dinner', 'sobras', 'lunchbox')),
  meal_id uuid references public.meals(id) on delete set null,
  as_written text,                                  -- the cell exactly as it was written in the sheet
  status text not null default 'proposed' check (status in ('proposed', 'locked', 'eaten')),
  is_leftover boolean not null default false,
  is_takeaway boolean not null default false,
  from_freezer_id uuid references public.freezer_items(id) on delete set null,
  why_line text,
  changed_by_user boolean not null default false,
  created_at timestamptz not null default now(),
  unique (household_id, week_start, day, slot)
);

do $$ begin
  alter table public.freezer_items
    add constraint freezer_items_used_slot_fk
    foreign key (used_slot_id) references public.plan_slots(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.adjustments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  slot_id uuid references public.plan_slots(id) on delete set null,
  action text not null check (action in ('swap', 'move', 'lock', 'remove', 'pin')),
  from_meal uuid references public.meals(id) on delete set null,
  to_meal uuid references public.meals(id) on delete set null,
  reason_chip text,
  created_at timestamptz not null default now()
);

create table if not exists public.house_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  text text not null,
  kind text not null,
  proposed_from_count integer,
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.week_notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  week_start date not null,
  note text not null,
  parsed_json jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  order_date date not null,
  line_no integer not null,                         -- position within the order, keeps re-seeding idempotent
  store text not null default 'tesco' check (store in ('tesco', 'lidl')),
  store_section text,
  item_type text,
  product_ordered text,
  qty_ordered numeric,
  unit_price_eur numeric(10, 2),
  outcome text,
  product_delivered text,
  qty_delivered numeric,
  delivered_unit_price_eur numeric(10, 2),
  line_total_eur numeric(10, 2),
  gluten_screen_draft text,                         -- a hint for the owner, never a clearance
  created_at timestamptz not null default now(),
  unique (household_id, store, order_date, line_no)
);

-- Gluten tiers as written in gluten_list_for_review.md. The gate (phase 2) reads these.
create table if not exists public.gluten_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  tier text not null check (tier in ('A', 'B', 'C', 'D')),
  label text not null,
  rule text not null,
  items text[] not null,
  confirmed_by_owner boolean not null default false,
  created_at timestamptz not null default now(),
  unique (household_id, tier)
);

create index if not exists plan_slots_week_idx on public.plan_slots (household_id, week_start);
create index if not exists ingredients_meal_idx on public.ingredients (meal_id);
create index if not exists adjustments_slot_idx on public.adjustments (slot_id);

-- ---------------------------------------------------------------------------
-- Row-level security: every table is keyed by household_id
-- ---------------------------------------------------------------------------

alter table public.households enable row level security;
alter table public.household_members enable row level security;

drop policy if exists "members read their household" on public.households;
create policy "members read their household" on public.households
  for select using (public.is_household_member(id));

drop policy if exists "members manage members" on public.household_members;
create policy "members manage members" on public.household_members
  for all using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

do $$
declare t text;
begin
  foreach t in array array[
    'meals', 'ingredients', 'plan_slots', 'freezer_items', 'adjustments',
    'house_rules', 'week_notes', 'purchases', 'gluten_rules'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "household access" on public.%I', t);
    execute format(
      'create policy "household access" on public.%I for all to authenticated
         using (public.is_household_member(household_id))
         with check (public.is_household_member(household_id))', t);
  end loop;
end $$;
