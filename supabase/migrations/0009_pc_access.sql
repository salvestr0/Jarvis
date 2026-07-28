-- PC access, Phase A: the job queue between Jarvis (Vercel) and the local
-- agent running on Jayden's PC.
--
-- Design (tasks/pc-access-design.md): Vercel INSERTs jobs with the service
-- role; the agent connects as the dedicated `pc_agent` Postgres role, which
-- can touch ONLY these two tables — if the PC is ever compromised, the
-- blast radius is the job queue, not the tracker data. The agent's login
-- password is set out-of-band by scripts/pc-agent-setup.mjs, never here.
--
-- pc_jobs doubles as a permanent audit log (including refusals), so "what
-- did you do on my PC this week?" is a query.
--
-- Apply with: npm run db:migrate

create table if not exists public.pc_jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('list_dir', 'read_file', 'search_files')),
  payload     jsonb not null default '{}',
  status      text not null default 'pending'
              check (status in ('pending', 'running', 'done', 'error', 'refused')),
  result      jsonb,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists pc_jobs_pending_idx
  on public.pc_jobs (created_at) where status = 'pending';

-- Singleton row: the agent upserts id=true every 30s while running. A tool
-- seeing last_seen older than 90s reports "PC offline" instead of queueing.
create table if not exists public.pc_heartbeat (
  id        boolean primary key default true check (id),
  last_seen timestamptz not null default now(),
  version   text
);

-- The agent's role: login enabled (with a password) only by the setup
-- script. NOINHERIT + explicit grants keep it boxed to these two tables.
do $$ begin
  if not exists (select from pg_roles where rolname = 'pc_agent') then
    create role pc_agent noinherit nologin;
  end if;
end $$;

grant usage on schema public to pc_agent;
grant select, update (status, result, finished_at) on public.pc_jobs to pc_agent;
grant select, insert, update on public.pc_heartbeat to pc_agent;

alter table public.pc_jobs enable row level security;
alter table public.pc_heartbeat enable row level security;

-- The agent role sees everything in its two tables; browser sessions
-- (authenticated) get no policies here, so PostgREST exposes nothing.
-- The bot's service-role client bypasses RLS as usual.
drop policy if exists "agent jobs" on public.pc_jobs;
create policy "agent jobs" on public.pc_jobs
  for all to pc_agent using (true) with check (true);

drop policy if exists "agent heartbeat" on public.pc_heartbeat;
create policy "agent heartbeat" on public.pc_heartbeat
  for all to pc_agent using (true) with check (true);
