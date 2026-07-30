-- Price alerts (tasks/price-alerts-design.md).
--
-- A row is a standing watch on a USD price level. Checked by the reminders
-- tick (/api/reminders/deliver) — no new ticker, no cron slot. One-shot:
-- pending → triggered keeps the row as an audit of what fired and at what
-- price; cancelled mirrors reminders. Micros (price × 1,000,000) match
-- src/lib/prices.ts so sub-cent coins don't round away.
--
-- Apply with: npm run db:migrate

create table if not exists public.price_alerts (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  symbol                 text not null check (length(symbol) between 1 and 15),
  kind                   text not null check (kind in ('stock', 'crypto')),
  direction              text not null check (direction in ('above', 'below')),
  target_micros          bigint not null check (target_micros > 0),
  status                 text not null default 'pending'
                         check (status in ('pending', 'triggered', 'cancelled')),
  triggered_price_micros bigint,
  triggered_at           timestamptz,
  created_at             timestamptz not null default now()
);

create index if not exists price_alerts_pending_idx
  on public.price_alerts (created_at) where status = 'pending';

alter table public.price_alerts enable row level security;

drop policy if exists "own price alerts" on public.price_alerts;
create policy "own price alerts" on public.price_alerts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
