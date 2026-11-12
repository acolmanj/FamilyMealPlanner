-- Weekends only: a meal the planner puts only on Saturday or Sunday.
-- Safe to run more than once.

-- When the column is first added, every roast is marked weekends only. A roast is a
-- roasted joint of meat ("Cordero asado", "roast lamb", "Roast Chicken with ..."), the same
-- idea as ROAST in lib/planner/tags.ts, not roasted vegetables ("Patatas asadas").
-- Running this again changes nothing, so a meal the owner has since changed stays as it is.
do $$
declare
  meat text := '(pollo|cordero|cerdo|ternera|vaca|pavo|lech[oó]n|cochinillo|chicken|lamb|pork|beef|turkey)';
  roast text := '\m(' || meat || '(\s+[[:alpha:]]+)?\s+asad[oa]s?|asado\s+de\s+' || meat || '|roast\s+' || meat || '|' || meat || '\s+roast)\M';
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'meals' and column_name = 'weekend_only'
  ) then
    alter table public.meals add column weekend_only boolean not null default false;
    update public.meals set weekend_only = true
    where name ~* roast or coalesce(name_en, '') ~* roast or coalesce(name_es, '') ~* roast;
  end if;
end $$;
