-- Weekly review rides the reminders pipeline (tasks/weekly-review-design.md).
--
-- A kind='weekly_review' row is a reminder that composes itself: when the
-- deliver endpoint claims one, it builds the week's report instead of
-- sending the body. Recurrence, atomic claiming, both tickers, and
-- retry-on-failure are all inherited from the reminders machinery.
--
-- The row IS the on/off switch: it appears in list_reminders, so
-- "cancel the weekly review" disables it; `npm run review:enable` re-seeds.
--
-- Apply with: npm run db:migrate

alter table public.reminders
  add column if not exists kind text not null default 'message'
  check (kind in ('message', 'weekly_review'));
