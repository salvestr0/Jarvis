-- LLM observability: one row per Anthropic Messages API call, logged
-- non-fatally from all four call sites (telegram tool loop, digest,
-- weekly review, content nudge). The telegram loop makes several calls
-- per turn (including pause_turn continuations); turn_id groups them and
-- iteration orders them. The cron sources make one call each, so both
-- stay null there.
--
-- Token columns default to 0 rather than null so SUM() needs no null
-- handling; a failed API call is marked by a non-null `error` (a real
-- call never reports usage when it throws, and a successful call always
-- has input_tokens > 0).
--
-- stop_reason has no CHECK on purpose: Anthropic adds values over time.

create table if not exists public.llm_calls (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users (id) on delete cascade,
  created_at                  timestamptz not null default now(),
  source                      text not null
                              check (source in ('telegram', 'digest', 'weekly_review', 'content_nudge')),
  turn_id                     uuid,
  iteration                   int,
  model                       text not null,
  input_tokens                int not null default 0,
  output_tokens               int not null default 0,
  cache_creation_input_tokens int not null default 0,
  cache_read_input_tokens     int not null default 0,
  latency_ms                  int not null,
  stop_reason                 text,
  tools_called                text[] not null default '{}',
  error                       text
);

create index if not exists llm_calls_user_created_idx
  on public.llm_calls (user_id, created_at desc);

alter table public.llm_calls enable row level security;

drop policy if exists "own llm calls" on public.llm_calls;
create policy "own llm calls" on public.llm_calls
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
