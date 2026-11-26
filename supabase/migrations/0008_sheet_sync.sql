-- Sync from the family menu sheet ("Menú Semanal.xlsx" in Google Drive).
-- Safe to run more than once.

-- What each sheet cell said at the last sync. A cell is only copied into plan_slots
-- when its text changes, so an edit made in the app stays until the sheet changes again.
create table if not exists public.sheet_sync_cells (
  household_id uuid not null references public.households(id) on delete cascade,
  week_start date not null,
  day text not null check (day in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
  slot text not null check (slot in ('lunch', 'dinner')),
  cell_text text not null default '',              -- '' when the cell is empty
  synced_at timestamptz not null default now(),
  primary key (household_id, week_start, day, slot)
);

-- One row per household: when the file last changed and how the last run went.
create table if not exists public.sheet_sync_state (
  household_id uuid primary key references public.households(id) on delete cascade,
  file_modified_at timestamptz,                    -- Drive's modifiedTime of the file last synced
  last_checked_at timestamptz,
  last_synced_at timestamptz,
  last_result jsonb,
  last_error text
);

do $$
declare t text;
begin
  foreach t in array array['sheet_sync_cells', 'sheet_sync_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "household access" on public.%I', t);
    execute format(
      'create policy "household access" on public.%I for all to authenticated
         using (public.is_household_member(household_id))
         with check (public.is_household_member(household_id))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
