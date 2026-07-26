-- ===========================================================================
-- Phase 3 — Career and projects
--
-- Run with:  npm run db:migrate
-- ===========================================================================

-- --- jobs ------------------------------------------------------------------
create table if not exists public.jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  employer        text not null,
  title           text not null,
  started_on      date not null,
  -- null means this is your current role.
  ended_on        date,
  -- null means "not recorded" — which is different from "zero".
  salary_cents    bigint check (salary_cents is null or salary_cents >= 0),
  salary_currency char(3) not null default 'SGD',
  salary_period   text not null default 'monthly'
                  check (salary_period in ('monthly', 'annual')),
  note            text,
  created_at      timestamptz not null default now(),
  check (ended_on is null or ended_on >= started_on)
);

-- --- job wins --------------------------------------------------------------
-- A dated log of what you actually shipped at work. Written while it's fresh,
-- so it's there when you need a resume or a performance review — rather than
-- being reconstructed from memory a year later.
create table if not exists public.job_wins (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  job_id      uuid references public.jobs (id) on delete cascade,
  occurred_on date not null,
  title       text not null,
  detail      text,
  created_at  timestamptz not null default now()
);

create index if not exists job_wins_user_date_idx
  on public.job_wins (user_id, occurred_on desc);

-- --- projects --------------------------------------------------------------
create table if not exists public.projects (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  name             text not null,
  status           text not null default 'building'
                   check (status in ('idea', 'building', 'beta', 'launched', 'paused', 'archived')),
  -- Not every project is meant to make money; Content Pipeline is a brand play.
  kind             text not null default 'product'
                   check (kind in ('product', 'content', 'business')),
  launch_date      date,
  mrr_target_cents bigint not null default 0 check (mrr_target_cents >= 0),
  url              text,
  note             text,
  created_at       timestamptz not null default now(),
  unique (user_id, name)
);

-- --- project metrics -------------------------------------------------------
create table if not exists public.project_metrics (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  as_of       date not null,
  mrr_cents   bigint not null default 0 check (mrr_cents >= 0),
  users_count integer check (users_count is null or users_count >= 0),
  note        text,
  created_at  timestamptz not null default now(),
  unique (project_id, as_of)
);

create index if not exists project_metrics_lookup_idx
  on public.project_metrics (project_id, as_of desc);

-- ===========================================================================
-- ROW LEVEL SECURITY — same pattern as every other personal table
-- ===========================================================================

alter table public.jobs            enable row level security;
alter table public.job_wins        enable row level security;
alter table public.projects        enable row level security;
alter table public.project_metrics enable row level security;

drop policy if exists "own jobs"            on public.jobs;
drop policy if exists "own job wins"        on public.job_wins;
drop policy if exists "own projects"        on public.projects;
drop policy if exists "own project metrics" on public.project_metrics;

create policy "own jobs" on public.jobs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own job wins" on public.job_wins
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own projects" on public.projects
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own project metrics" on public.project_metrics
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ===========================================================================
-- SEED — example rows only
--
-- These are placeholders so a fresh install has something on screen. Edit them
-- in the app; your real employer, salary and project details live in YOUR
-- database, not in this repository.
--
-- Salary is deliberately null: a guessed number in a financial app is worse
-- than a blank one.
-- ===========================================================================

insert into public.jobs (user_id, employer, title, started_on, note)
select u.id,
       'Your Employer',
       'Your Job Title',
       current_date,
       'Edit this on the Career page.'
from auth.users u
where not exists (select 1 from public.jobs j where j.user_id = u.id);

insert into public.projects (user_id, name, status, kind, mrr_target_cents, note)
select u.id, seed.name, seed.status, seed.kind, seed.target, seed.note
from auth.users u
cross join (values
  ('Example Product', 'building', 'product',  100000::bigint,
   'A product with a revenue target — progress shows as a bar against it.'),
  ('Example Content', 'building', 'content',  0::bigint,
   'No revenue target, so it is tracked for progress rather than money.')
) as seed(name, status, kind, target, note)
on conflict (user_id, name) do nothing;
