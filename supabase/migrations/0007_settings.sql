-- Phase 3 — per-user preferences, starting with the Jarvis morning digest.
--
-- One row per user (user_id is the primary key). Reads fall back to defaults
-- when the row doesn't exist yet; the row materialises on first save.
--
-- Apply with: npm run db:migrate

create table if not exists public.settings (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  digest_mode      text not null default 'daily'
                   check (digest_mode in ('daily', 'noteworthy', 'off')),
  digest_calendar  boolean not null default true,
  digest_email     boolean not null default true,
  digest_money     boolean not null default true,
  digest_portfolio boolean not null default true,
  digest_tasks     boolean not null default true,
  updated_at       timestamptz not null default now()
);

alter table public.settings enable row level security;

drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
