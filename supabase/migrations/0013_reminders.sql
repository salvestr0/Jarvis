-- Timed reminders, delivered to Telegram (tasks/reminders-design.md).
--
-- Created by the bot's create_reminder tool; delivered by
-- /api/reminders/deliver, which any ticker may call — the PC agent every
-- minute, GitHub Actions every 5. Delivery claims are atomic status flips,
-- so concurrent tickers can never double-send.
--
-- Cancelling is a status flip, not a delete: reversible, and the row stays
-- as an audit trail. The pc_agent role deliberately gets NO access here —
-- its ticker goes over HTTPS to the deliver endpoint, keeping the boxed
-- role's blast radius at pc_jobs/pc_heartbeat.
--
-- Apply with: npm run db:migrate

create table if not exists public.reminders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  body         text not null check (length(body) between 1 and 500),
  due_at       timestamptz not null,
  repeat       text not null default 'none'
               check (repeat in ('none', 'daily', 'weekly')),
  status       text not null default 'pending'
               check (status in ('pending', 'sent', 'cancelled')),
  last_sent_at timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists reminders_due_idx
  on public.reminders (due_at) where status = 'pending';

alter table public.reminders enable row level security;

drop policy if exists "own reminders" on public.reminders;
create policy "own reminders" on public.reminders
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
