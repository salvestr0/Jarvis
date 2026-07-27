-- Phase 2 — Telegram bot conversation history.
--
-- The bot is stateless between webhook calls (serverless), so the last few
-- exchanges live here and are replayed as context on each turn. Only final
-- text is stored — never tool calls or tool results.
--
-- Apply with: npm run db:migrate

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_user_time_idx
  on public.chat_messages (user_id, created_at desc);

-- The bot itself writes via the service role (bypasses RLS); the policy
-- exists so the publishable browser key can't read anyone's chat, and so
-- `npm run db:check` sees the same protection every other table has.
alter table public.chat_messages enable row level security;

drop policy if exists "own chat" on public.chat_messages;
create policy "own chat" on public.chat_messages
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
