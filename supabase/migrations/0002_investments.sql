-- ===========================================================================
-- Phase 2 — Investments: holdings, prices, FX, net worth
--
-- Run with:  npm run db:migrate
--
-- TWO UNITS ARE USED HERE, ON PURPOSE
--
--   *_cents   (bigint)  money you paid or hold      12.34 -> 1234
--   *_micros  (bigint)  market prices and FX rates  12.34 -> 12340000
--
-- Why prices need finer resolution than cents: a memecoin can trade at
-- $0.0000004. In cents that rounds to 0 and the holding becomes worthless on
-- screen. Micros (6 decimal places) hold it exactly. Still integers, so still
-- no floating-point drift.
-- ===========================================================================

-- Cash accounts need a starting balance, otherwise "net worth" only reflects
-- transactions logged since you installed this, which isn't your net worth.
alter table public.accounts
  add column if not exists opening_balance_cents bigint not null default 0;

-- --- holdings --------------------------------------------------------------
create table if not exists public.holdings (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  kind             text not null check (kind in ('crypto', 'stock')),
  -- Ticker used to look up the price: 'BTC', 'AAPL', 'D05.SI'
  symbol           text not null,
  name             text,
  -- Fractional quantities are the norm (0.0035 BTC), so this cannot be an int.
  quantity         numeric(30, 10) not null check (quantity > 0),
  -- Total you actually paid, in the currency you paid with.
  cost_basis_cents bigint not null default 0 check (cost_basis_cents >= 0),
  cost_currency    char(3) not null default 'SGD',
  -- Currency the market quotes this asset in (crypto and US stocks: USD).
  price_currency   char(3) not null default 'USD',
  account_id       uuid references public.accounts (id) on delete set null,
  note             text,
  created_at       timestamptz not null default now(),
  unique (user_id, kind, symbol)
);

-- --- price snapshots (market data, not personal) ---------------------------
create table if not exists public.price_snapshots (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('crypto', 'stock')),
  symbol       text not null,
  price_micros bigint not null check (price_micros >= 0),
  currency     char(3) not null default 'USD',
  as_of        date not null,
  source       text not null,
  created_at   timestamptz not null default now(),
  unique (kind, symbol, as_of)
);

create index if not exists price_snapshots_lookup_idx
  on public.price_snapshots (kind, symbol, as_of desc);

-- --- FX rates --------------------------------------------------------------
create table if not exists public.fx_rates (
  id          uuid primary key default gen_random_uuid(),
  base        char(3) not null,
  quote       char(3) not null,
  rate_micros bigint not null check (rate_micros > 0),
  as_of       date not null,
  source      text not null,
  created_at  timestamptz not null default now(),
  unique (base, quote, as_of)
);

create index if not exists fx_rates_lookup_idx
  on public.fx_rates (base, quote, as_of desc);

-- --- net worth history -----------------------------------------------------
create table if not exists public.net_worth_snapshots (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  as_of             date not null,
  total_cents       bigint not null,
  investments_cents bigint not null default 0,
  cash_cents        bigint not null default 0,
  created_at        timestamptz not null default now(),
  unique (user_id, as_of)
);

-- ===========================================================================
-- ROW LEVEL SECURITY
-- ===========================================================================

alter table public.holdings            enable row level security;
alter table public.price_snapshots     enable row level security;
alter table public.fx_rates            enable row level security;
alter table public.net_worth_snapshots enable row level security;

drop policy if exists "own holdings"       on public.holdings;
drop policy if exists "own net worth"      on public.net_worth_snapshots;
drop policy if exists "read prices"        on public.price_snapshots;
drop policy if exists "write prices"       on public.price_snapshots;
drop policy if exists "read fx"            on public.fx_rates;
drop policy if exists "write fx"           on public.fx_rates;

-- Personal data: scoped to you, same pattern as Phase 1.
create policy "own holdings" on public.holdings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own net worth" on public.net_worth_snapshots
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Market data is not personal — the price of Bitcoin is the same for everyone,
-- so these rows carry no user_id. Any signed-in user may read and write them.
--
-- "Any signed-in user" means exactly one person: you. Signups are disabled and
-- the app enforces an email allowlist. If this ever became multi-user, writes
-- would need to move behind a service-role-only endpoint, because one user
-- could otherwise poison prices for everyone.
create policy "read prices" on public.price_snapshots
  for select to authenticated using (true);

create policy "write prices" on public.price_snapshots
  for insert to authenticated with check (true);

create policy "read fx" on public.fx_rates
  for select to authenticated using (true);

create policy "write fx" on public.fx_rates
  for insert to authenticated with check (true);
