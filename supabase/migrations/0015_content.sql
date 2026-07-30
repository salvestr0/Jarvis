-- Content capture-and-draft loop (tasks/content-loop-design.md).
--
-- Ideas are raw sparks captured from Telegram (friction zero); drafts are
-- workable posts (hook + body) Jarvis wrote in Jayden's voice and he edits
-- and ships himself. Two tables deliberately: capturing must stay cheap,
-- and a draft is a different thing from a spark.
--
-- The evening nudge rides the reminders pipeline as kind='content_nudge' —
-- third user of the kind column, same drop-and-re-add dance as 0010 did
-- for pc_jobs.
--
-- Apply with: npm run db:migrate

create table if not exists public.content_ideas (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  text       text not null check (length(text) between 1 and 2000),
  status     text not null default 'inbox'
             check (status in ('inbox', 'drafted', 'posted', 'dropped')),
  created_at timestamptz not null default now()
);

create index if not exists content_ideas_inbox_idx
  on public.content_ideas (created_at desc) where status = 'inbox';

alter table public.content_ideas enable row level security;

drop policy if exists "own content ideas" on public.content_ideas;
create policy "own content ideas" on public.content_ideas
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.content_drafts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  idea_id    uuid references public.content_ideas (id) on delete set null,
  hook       text not null,          -- the first line; the scroll-stopper
  body       text not null,
  status     text not null default 'draft'
             check (status in ('draft', 'posted', 'dropped')),
  created_at timestamptz not null default now()
);

create index if not exists content_drafts_pile_idx
  on public.content_drafts (created_at desc) where status = 'draft';

alter table public.content_drafts enable row level security;

drop policy if exists "own content drafts" on public.content_drafts;
create policy "own content drafts" on public.content_drafts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter table public.reminders drop constraint if exists reminders_kind_check;
alter table public.reminders add constraint reminders_kind_check
  check (kind in ('message', 'weekly_review', 'content_nudge'));
