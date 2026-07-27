-- Jarvis's long-term memory about the user.
--
-- Freeform facts ("Mom's birthday is March 3", "food budget S$600/month")
-- written by the bot's `remember` tool. Every fact is injected into the
-- bot's context on every turn and into the morning digest, so a fact told
-- once keeps applying forever — until `forget` deletes it.
--
-- Apply with: npm run db:migrate

create table if not exists public.facts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  content    text not null check (length(content) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists facts_user_idx
  on public.facts (user_id, created_at);

alter table public.facts enable row level security;

drop policy if exists "own facts" on public.facts;
create policy "own facts" on public.facts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
