-- ===========================================================================
-- Phase 2b — Manual holdings (investment plans, endowments, anything without
-- a ticker).
--
-- A manual holding has no market price feed. Its value comes from you, typed
-- in from the latest statement, and is stored on the holding itself in
-- manual_value_cents. Everything downstream (positions, totals, net worth
-- snapshots) treats that value exactly like a fetched market value.
--
-- The value deliberately does NOT go into price_snapshots: that table is
-- shared reference data (no user_id), and your plan's surrender value is
-- personal.
-- ===========================================================================

alter table public.holdings
  drop constraint if exists holdings_kind_check;

alter table public.holdings
  add constraint holdings_kind_check
  check (kind in ('crypto', 'stock', 'manual'));

alter table public.holdings
  add column if not exists manual_value_cents bigint
  check (manual_value_cents is null or manual_value_cents >= 0);
