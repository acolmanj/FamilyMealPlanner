-- Phase 3: the manual planner logs every correction in adjustments.
-- 'add' fills an empty cell, 'unlock' undoes a lock, 'tags' corrects a meal's attributes.
alter table public.adjustments drop constraint if exists adjustments_action_check;
alter table public.adjustments add constraint adjustments_action_check
  check (action in ('add', 'swap', 'move', 'lock', 'unlock', 'remove', 'pin', 'tags'));
