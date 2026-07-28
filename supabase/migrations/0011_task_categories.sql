-- ===========================================================================
-- Phase 11 — Task categories (kanban columns)
--
-- Run with:  npm run db:migrate
-- ===========================================================================

-- --- task_categories -------------------------------------------------------
-- One row per board column. Free-form: you name them, you order them.
-- Deleting a category never deletes work (see the tasks FK below) — its
-- tasks fall back to the Uncategorised column.
create table if not exists public.task_categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  -- Left-to-right order of the columns. Dense, rewritten on reorder.
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- --- tasks: which column, and where in it ----------------------------------
-- set null, not cascade: deleting a column shouldn't silently delete work.
alter table public.tasks
  add column if not exists category_id uuid
    references public.task_categories (id) on delete set null;

-- Manual order within a column. 0 is reserved for "created, never placed" —
-- a reorder always writes 1..n — so a brand new task (web or Telegram) sorts
-- to the top of its column without an extra query at insert time.
alter table public.tasks
  add column if not exists position integer not null default 0;

-- --- backfill --------------------------------------------------------------
-- Existing tasks have never been placed by hand, so seed the manual order
-- from the order the list used to show them in: dated first, then by due
-- date, then priority. created_at breaks the last tie so the result is
-- deterministic. Done tasks stay at 0 — they aren't on the board, and if one
-- is reopened, landing at the top of its column is the useful outcome.
with ranked as (
  select id,
         row_number() over (
           partition by user_id
           order by (due_on is null),      -- false sorts first: dated wins
                    due_on,
                    case priority
                      when 'high'   then 0
                      when 'medium' then 1
                      else 2
                    end,
                    created_at
         ) as rn
  from public.tasks
  where done = false
)
update public.tasks t
set position = ranked.rn
from ranked
where t.id = ranked.id;

create index if not exists tasks_user_board_idx
  on public.tasks (user_id, done, category_id, position);

-- ===========================================================================
-- ROW LEVEL SECURITY — same pattern as every other personal table
-- ===========================================================================

alter table public.task_categories enable row level security;

drop policy if exists "own task categories" on public.task_categories;

create policy "own task categories" on public.task_categories
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
