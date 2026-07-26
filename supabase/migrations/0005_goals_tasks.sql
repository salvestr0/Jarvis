-- ===========================================================================
-- Phase 5 — Goals and tasks
--
-- Run with:  npm run db:migrate
-- ===========================================================================

-- --- goals -----------------------------------------------------------------
-- The destinations: short-term (weeks/months) and long-term (years) targets.
-- A goal is never deleted by finishing it — it becomes 'achieved', so the
-- record of what you set out to do and did survives.
create table if not exists public.goals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  horizon     text not null default 'short'
              check (horizon in ('short', 'long')),
  status      text not null default 'active'
              check (status in ('active', 'achieved', 'dropped')),
  -- null means "no deadline" — long-term goals often don't have one.
  target_date date,
  note        text,
  created_at  timestamptz not null default now(),
  unique (user_id, title)
);

-- --- tasks -----------------------------------------------------------------
-- The steps. A task can point at the goal it pushes forward, so the list
-- answers "why am I doing this?" and not just "what's next?".
create table if not exists public.tasks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- set null, not cascade: deleting a goal shouldn't silently delete work.
  goal_id    uuid references public.goals (id) on delete set null,
  title      text not null,
  priority   text not null default 'medium'
             check (priority in ('low', 'medium', 'high')),
  due_on     date,
  done       boolean not null default false,
  done_at    timestamptz,
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists tasks_user_open_idx
  on public.tasks (user_id, done, due_on);

-- ===========================================================================
-- ROW LEVEL SECURITY — same pattern as every other personal table
-- ===========================================================================

alter table public.goals enable row level security;
alter table public.tasks enable row level security;

drop policy if exists "own goals" on public.goals;
drop policy if exists "own tasks" on public.tasks;

create policy "own goals" on public.goals
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own tasks" on public.tasks
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
