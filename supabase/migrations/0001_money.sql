-- ===========================================================================
-- Phase 1 — Money: accounts, categories, transactions, recurring
--
-- Run this in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to run twice (everything is "if not exists" / "on conflict do nothing").
--
-- WHY AMOUNTS ARE INTEGERS, NOT DECIMALS
-- Money is stored in CENTS as a whole number. 12.34 is stored as 1234.
-- Decimal/float types cannot represent money exactly: in almost every
-- language, 0.1 + 0.2 = 0.30000000000000004. Those tiny errors accumulate
-- and your totals silently drift. Whole numbers can't drift. This is why
-- Stripe and most payment systems do the same thing.
-- ===========================================================================

-- --- accounts --------------------------------------------------------------
create table if not exists public.accounts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  kind       text not null default 'bank'
             check (kind in ('cash', 'bank', 'brokerage', 'crypto_wallet', 'other')),
  currency   char(3) not null default 'SGD',
  archived   boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- --- categories ------------------------------------------------------------
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  direction  text not null check (direction in ('income', 'expense')),
  created_at timestamptz not null default now(),
  unique (user_id, name, direction)
);

-- --- transactions ----------------------------------------------------------
create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  occurred_on  date not null,
  direction    text not null check (direction in ('income', 'expense')),
  amount_cents bigint not null check (amount_cents > 0),
  currency     char(3) not null default 'SGD',
  category_id  uuid references public.categories (id) on delete set null,
  account_id   uuid references public.accounts (id) on delete set null,
  note         text,
  created_at   timestamptz not null default now()
);

-- Makes "show me this month, newest first" fast once there are thousands of rows.
create index if not exists transactions_user_date_idx
  on public.transactions (user_id, occurred_on desc);

-- --- recurring (subscriptions and fixed costs) ------------------------------
create table if not exists public.recurring (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  direction    text not null check (direction in ('income', 'expense')),
  amount_cents bigint not null check (amount_cents > 0),
  currency     char(3) not null default 'SGD',
  cadence      text not null check (cadence in ('weekly', 'monthly', 'yearly')),
  next_due     date,
  category_id  uuid references public.categories (id) on delete set null,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ===========================================================================
-- ROW LEVEL SECURITY
--
-- This is the lock that makes the publishable key safe to ship to a browser.
-- Without it, that key could read every row in these tables.
--
-- Each table gets one policy covering all four operations:
--   using       -> which existing rows you may see / change
--   with check  -> what a new or edited row is allowed to look like
--
-- Both halves are required. `using` alone would let you INSERT a row tagged
-- with someone else's user_id.
--
-- `(select auth.uid())` is wrapped in a select on purpose: Postgres then
-- evaluates it once per query instead of once per row.
-- ===========================================================================

alter table public.accounts     enable row level security;
alter table public.categories   enable row level security;
alter table public.transactions enable row level security;
alter table public.recurring    enable row level security;

drop policy if exists "own accounts"     on public.accounts;
drop policy if exists "own categories"   on public.categories;
drop policy if exists "own transactions" on public.transactions;
drop policy if exists "own recurring"    on public.recurring;

create policy "own accounts" on public.accounts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own categories" on public.categories
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own transactions" on public.transactions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own recurring" on public.recurring
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Note there is deliberately NO policy for the `anon` role (a visitor who is
-- not logged in). No policy means no access at all — the correct default.

-- ===========================================================================
-- SEED — starter categories and accounts
-- Applies to every existing user. Signups are disabled, so that means you.
-- ===========================================================================

insert into public.categories (user_id, name, direction)
select u.id, seed.name, seed.direction
from auth.users u
cross join (values
  ('Salary',            'income'),
  ('Side income',       'income'),
  ('TCG sales',         'income'),
  ('Product revenue',   'income'),
  ('Refund',            'income'),
  ('Other income',      'income'),
  ('Rent',              'expense'),
  ('Food',              'expense'),
  ('Transport',         'expense'),
  ('Utilities',         'expense'),
  ('Phone & internet',  'expense'),
  ('Subscriptions',     'expense'),
  ('Tools & software',  'expense'),
  ('Shopping',          'expense'),
  ('Health',            'expense'),
  ('Family',            'expense'),
  ('Entertainment',     'expense'),
  ('TCG inventory',     'expense'),
  ('Other expense',     'expense')
) as seed(name, direction)
on conflict (user_id, name, direction) do nothing;

insert into public.accounts (user_id, name, kind)
select u.id, seed.name, seed.kind
from auth.users u
cross join (values
  ('Bank', 'bank'),
  ('Cash', 'cash')
) as seed(name, kind)
on conflict (user_id, name) do nothing;
