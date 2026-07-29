-- ===========================================================================
-- Phase 11.1 — rename the tasks board inbox column
--
-- "Uncategorised" is not a task_categories row (it's category_id = null), so
-- its display label lives with the user's other preferences. Reads fall back
-- to the default when the settings row doesn't exist yet.
--
-- Run with:  npm run db:migrate
-- ===========================================================================

alter table public.settings
  add column if not exists tasks_inbox_label text not null default 'Uncategorised';
