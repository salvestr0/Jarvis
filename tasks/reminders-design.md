# Reminders — design

**Goal:** "Remind me Thursday 3pm to call the bank" → a Telegram message at
Thursday 3pm. One-shot and simple recurring (daily/weekly). Status: SPEC —
awaiting Jayden's go.

## Why this shape

Vercel Hobby caps us at 2 crons (both used, daily granularity anyway), so
minute-level scheduling needs an external tick. We already have two assets:
an always-on PC agent that polls every 2.5s, and a secret-protected cron
endpoint pattern. The design: reminders live in Postgres, a **stateless,
idempotent deliver endpoint** does all the work, and *anything* can tick it —
multiple tickers are safe by construction, so we stack them for coverage.

## Data (migration 0013)

```sql
create table reminders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  body         text not null,            -- what Jarvis says
  due_at       timestamptz not null,     -- stored UTC, entered as SGT
  repeat       text not null default 'none' check (repeat in ('none','daily','weekly')),
  status       text not null default 'pending' check (status in ('pending','sent','cancelled')),
  last_sent_at timestamptz,
  created_at   timestamptz not null default now()
);
create index reminders_due_idx on reminders (due_at) where status = 'pending';
```

RLS enabled, owner-only policy like every other table (`db:check` gate).
Cancel is a **status flip, not a row delete** — reversible, keeps the audit
trail, and (deliberately) means the bot's modify rule applies rather than
the heavier delete-confirmation rule: "cancel my 3pm reminder" is an exact
stated change, so Jarvis just does it.

## Bot tools (3 new, → 49)

- `create_reminder(body, due_at "YYYY-MM-DD HH:MM" SGT, repeat?)` — ADD tier:
  act immediately, confirm in one line. Rejects past datetimes and anything
  > 1 year out (typo guard). SGT→UTC conversion server-side; the model never
  does timezone math.
- `list_reminders()` — pending, soonest first, with ids (for cancel).
- `cancel_reminder(reminder_id)` — MODIFY tier (see above). Zero-rows check
  like every other write.

One line added to the system prompt's capability list so Jarvis offers this
unprompted ("want me to remind you?").

## Delivery: GET /api/reminders/deliver

Auth: `Authorization: Bearer CRON_SECRET` — same fail-closed pattern as the
two cron routes (503 unset / 401 mismatch). Reusing CRON_SECRET keeps the
secret count at 8; the endpoint is harmless-if-spammed by design.

Logic per due reminder (`status='pending' and due_at <= now()`):

1. **Atomic claim** — `update ... set status='sent' where id=$1 and
   status='pending' returning id` (the pc_jobs claim pattern). Two tickers
   firing at once cannot double-send.
2. Send via existing `sendMessage`: `⏰ {body}` — plus `(due HH:MM)` when
   delivery is > 5 min late, so a PC-was-asleep reminder is honest about it.
3. `saveAssistantNote` — the reminder enters chat history exactly like the
   digest does, so "snooze that" / "what was that about?" has context.
4. **Recurring:** advance `due_at` from the *scheduled* time (not now() — no
   drift), repeatedly until it's in the future (an offline weekend produces
   ONE delivery, not a backlog spam), stamp `last_sent_at`, set status back
   to 'pending'.
5. Send failure → revert claim to 'pending'; the next tick retries.

Pure functions (`nextDueAt`, SGT parse/format, late-suffix rule) live in
`src/lib/reminders.ts` with node --test coverage.

## The tickers (both; idempotency makes stacking free)

1. **PC agent** — new `remindersPingMs: 60000` in config.json; a plain
   `fetch` to the deliver URL with the secret (both read from .env.local,
   where every other secret already lives). Fire-and-forget: network errors
   log and never disturb the job loop. Minute-precision whenever the PC is
   awake — the common case, since Telegram + PC-awake correlate for him.
2. **GitHub Actions** — `.github/workflows/remind.yml`, `schedule: */5`,
   secret in repo Actions secrets (repo is public; the workflow file
   contains no secret material). Coverage when the PC sleeps. GH cron can
   lag 5–15 min under load — acceptable for the fallback tier, and the late
   suffix keeps it honest.

Worst case (PC asleep + GH lag): a reminder lands ~10–20 min late, labelled
as late. Typical case (PC on): within 60s.

## Explicitly out of scope (v1)

- No web UI (Telegram is the surface; a dashboard card can come later)
- No natural-language recurrence beyond daily/weekly ("every 2nd Tuesday")
- No snooze tool (you can just create a new reminder; add if it hurts)
- No location/context triggers

## Decisions taken (flag if you disagree)

1. Cancel = status flip under the MODIFY rule (no delete-style confirm)
2. CRON_SECRET reused rather than a 9th secret
3. GitHub Actions as the away-from-PC ticker (vs a cron-job.org account —
   swap later by pointing anything at the same endpoint)
4. daily/weekly recurrence included in v1

## Build checklist

- [ ] 0013_reminders.sql + `npm run db:migrate` + `db:check` green
- [ ] src/lib/reminders.ts (pure logic) + tests
- [ ] src/lib/queries/reminders.ts (create/list/cancel/claim/advance)
- [ ] 3 tool schemas + execute.ts cases + prompt capability line
- [ ] /api/reminders/deliver route
- [ ] pc-agent ticker + config key
- [ ] .github/workflows/remind.yml + Actions secret (needs Jayden or gh CLI)
- [ ] verify gate, deploy, E2E: "remind me in 2 minutes to stretch"
