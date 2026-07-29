# Weekly review — design

**Goal:** Sunday ~20:00 SGT, Jarvis sends a Telegram message showing what
actually got DONE this week — evidence, not vibes. Status: **SHIPPED
30 Jul 2026 (`e840739`), E2E-verified**: a due-now test row was claimed by
the PC agent's own tick, Claude composed a real review (honest quiet-week
voice, correct money numbers), the row self-rescheduled +7d; test row then
cancelled and the production row seeded — first send Sun 2 Aug 20:00 SGT.

## Why this shape: it's a recurring reminder that composes itself

The reminders system (tasks/reminders-design.md) already solved every hard
part of this feature: weekly recurrence with no drift, atomic can't-double-
send claiming, two proven tickers, retry on send failure, chat-history
injection. So the weekly review is NOT a new pipeline — it's one special
reminder row.

- Migration 0014 adds `kind text not null default 'message'`
  (`check in ('message','weekly_review')`) to `reminders`.
- One seeded row: `kind='weekly_review'`, `body='Weekly review'`,
  `repeat='weekly'`, due next Sunday 20:00 SGT.
- The deliver endpoint, on claiming a `weekly_review` row, composes the
  report instead of sending the body. Everything else — recurrence
  advancing from the scheduled time, revert-on-failure, both tickers —
  is inherited unchanged. Zero new endpoints, zero new tickers, zero new
  state tables.

Delivery precision needs are loose (a review landing 20:07 is fine), so
the GH Actions 5-min tier alone would suffice even if the PC is off.

**On/off switch = the row itself.** It shows up in `list_reminders` like
any reminder, so "Jarvis, cancel the weekly review" just works. Re-enable
(or change the time): `npm run review:enable [-- "YYYY-MM-DD HH:MM"]` —
an idempotent seed script (skips if a pending weekly_review row exists).
No settings-table field — avoids the digest-form-clobbers-Settings gotcha
(see 0012's inbox-label precedent).

## Content — the week's receipts (Mon 00:00 SGT → send time)

All tracker data; no Google in v1 (the digest owns calendar/email, and
Google adds failure modes the first version doesn't need):

1. **Shipped:** tasks completed this week (`done_at` in window — column
   already exists), wins logged (`job_wins.created_at`), project metrics
   recorded (`project_metrics.created_at`), goals achieved.
2. **Money:** this week's income/expense totals + top 3 expense
   categories, vs LAST week's totals (same integer-cents + preformatted
   `display` discipline as everywhere; the model never does arithmetic).
3. **Net worth:** now vs 7 days ago (existing `getNetWorthHistory`).
4. **Open loops:** overdue tasks, tasks due in the next 7 days.

## Compose — digest pattern, review voice

`src/lib/review.ts`, modeled 1:1 on `cron/digest.ts`: gather → Claude
compose (sonnet, effort low) → **deterministic fallback render if the
model call fails** — the review goes out even when the API is down.

Voice (this matters — it's the point of the feature): lead with what got
done, concrete and specific. Honest on quiet weeks — no manufactured
cheer, but frame against consistency ("3 tasks and a win logged; the
streak is what compounds"), never against a fantasy week. Facts list
included so it can connect work to his stated goals.

Sent via the normal chunked `sendMessage` + `saveAssistantNote`, so
"tell me more about that" works right after.

## Plumbing details

- Deliver route `maxDuration` 60 → 120 (one Claude compose call, same
  headroom reasoning as the digest route).
- Week-window math (`weekStartSgt`, prev-week window) is pure, in
  `src/lib/review.ts`, node --test covered like reminders.ts.
- New range queries where month-based ones don't fit (e.g.
  `getTransactionsBetween`) — added to the queries layer, same
  `db?: Db` shape.
- `list_reminders` shows the row as-is; `cancel_reminder` works on it
  unmodified.

## Out of scope (v1)

- Calendar/email in the review (v2, behind the digest's Google plumbing)
- A settings-page toggle (the row is the toggle)
- Custom schedules beyond "cancel it / re-seed at a different time"

## Decisions taken (flag if you disagree)

1. Ride the reminders pipeline via a `kind` column — not a parallel system
2. Sunday 20:00 SGT default
3. Tracker-only content in v1, Google later
4. Evidence-first voice, honest about quiet weeks

## Build checklist

- [ ] 0014_reminder_kinds.sql + migrate + db:check
- [ ] scripts/enable-weekly-review.mjs + `review:enable` npm script
- [ ] src/lib/review.ts (window math + gather + compose + fallback) + tests
- [ ] queries: getTransactionsBetween, tasks-done-in-window, wins/metrics windows
- [ ] deliver route: weekly_review branch + maxDuration 120
- [ ] verify gate, deploy, seed the row, E2E with a due-now weekly_review row
