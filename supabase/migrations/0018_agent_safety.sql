-- Durable identities and leases for the Vercel-hosted finance agent.

alter table public.transactions
  add column if not exists source text,
  add column if not exists source_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_source_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_source_check
      check (source is null or source in ('telegram', 'gmail'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_user_source_key_unique'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_user_source_key_unique
      unique (user_id, source, source_key);
  end if;
end $$;

create table if not exists public.telegram_updates (
  user_id          uuid not null references auth.users (id) on delete cascade,
  update_id        bigint not null,
  status           text not null check (status in ('processing', 'completed', 'failed')),
  lease_token      uuid not null,
  lease_expires_at timestamptz not null,
  attempt_count    int not null default 1 check (attempt_count > 0),
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (user_id, update_id)
);

alter table public.telegram_updates enable row level security;

create or replace function public.claim_telegram_update(
  p_user_id uuid,
  p_update_id bigint,
  p_lease_token uuid,
  p_lease_seconds int default 300
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed boolean := false;
  lease_duration interval := make_interval(
    secs => least(greatest(coalesce(p_lease_seconds, 300), 30), 900)
  );
begin
  insert into public.telegram_updates (
    user_id,
    update_id,
    status,
    lease_token,
    lease_expires_at
  ) values (
    p_user_id,
    p_update_id,
    'processing',
    p_lease_token,
    now() + lease_duration
  )
  on conflict (user_id, update_id) do update
    set status = 'processing',
        lease_token = excluded.lease_token,
        lease_expires_at = excluded.lease_expires_at,
        attempt_count = public.telegram_updates.attempt_count + 1,
        error = null,
        updated_at = now()
    where public.telegram_updates.status = 'failed'
       or (
         public.telegram_updates.status = 'processing'
         and public.telegram_updates.lease_expires_at <= now()
       )
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

create or replace function public.finish_telegram_update(
  p_user_id uuid,
  p_update_id bigint,
  p_lease_token uuid,
  p_succeeded boolean,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected int;
begin
  update public.telegram_updates
  set status = case when p_succeeded then 'completed' else 'failed' end,
      error = case when p_succeeded then null else left(coalesce(p_error, 'unknown'), 1000) end,
      lease_expires_at = now(),
      updated_at = now()
  where user_id = p_user_id
    and update_id = p_update_id
    and lease_token = p_lease_token
    and status = 'processing';

  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

revoke all on function public.claim_telegram_update(uuid, bigint, uuid, int) from public;
revoke all on function public.finish_telegram_update(uuid, bigint, uuid, boolean, text) from public;
grant execute on function public.claim_telegram_update(uuid, bigint, uuid, int) to service_role;
grant execute on function public.finish_telegram_update(uuid, bigint, uuid, boolean, text) to service_role;

create table if not exists public.email_expense_batches (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  previewed_update_id   bigint not null,
  items                 jsonb not null check (jsonb_typeof(items) = 'array'),
  committed_at          timestamptz,
  expires_at            timestamptz not null default (now() + interval '24 hours'),
  created_at            timestamptz not null default now()
);

create index if not exists email_expense_batches_user_created_idx
  on public.email_expense_batches (user_id, created_at desc);

alter table public.email_expense_batches enable row level security;
