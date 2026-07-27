# Jarvis — Todo

**Goal:** a personal assistant that knows everything about the user.
Phase 1 (this repo) is the memory layer — income, investments, net worth,
career, projects. Phase 2 is a Telegram interface backed by a frontier model
API, calling the same `src/lib/queries/` functions as tools.

Plan: `C:\Users\User\.claude\plans\precious-doodling-kurzweil.md`

---

## Phase 0 — Scaffold + auth ✅ code complete, awaiting your Supabase project

- [x] Next.js 16 + TypeScript + Tailwind 4 + shadcn/ui scaffold
- [x] Supabase clients: browser / server / proxy
- [x] `src/proxy.ts` route guard (Next 16 renamed `middleware` → `proxy`)
- [x] Email allowlist, fails closed when unset
- [x] Login page + sign in / sign out server actions
- [x] App shell with nav, route group `(app)` for authed pages
- [x] Stub pages so nav never 404s
- [x] `.gitignore` hides `.env*`, keeps `.env.local.example`
- [x] Typecheck clean, production build passes
- [x] Verified: `/money` and `/` redirect to `/login` when signed out
- [ ] **You:** follow `SETUP.md` to create the Supabase project
- [ ] Verify real login end to end (blocked on the above)
- [ ] Verify a non-allowlisted account is rejected (blocked on the above)

## Phase 1 — Money ✅ built, awaiting your click-through
- [x] Schema + RLS: `accounts`, `categories`, `transactions`, `recurring`
- [x] Migration runner (`npm run db:migrate`) + security checker (`npm run db:check`)
- [x] Migration applied — 19 categories, 2 accounts seeded
- [x] `/money`: add / edit / delete, month nav, category breakdown, summary cards
- [x] Money stored as integer cents; 9 unit tests covering parsing and edge cases
- [x] Error boundary for signed-in pages
- [x] Verified: all 5 tables have RLS + a policy with both USING and WITH CHECK
- [x] Verified: anonymous REST calls return `[]` from every table
- [x] **You:** added a real transaction — totals, category breakdown and delete all confirmed working
- [x] Fixed: new rows needed a manual refresh (`router.refresh()`, not just `revalidatePath`)
- [x] Fixed: `'use server'` file exported a non-async value

## Phase 2 — Investments ✅ built, awaiting your click-through
- [x] Schema + RLS: `holdings`, `price_snapshots`, `fx_rates`, `net_worth_snapshots`
- [x] `accounts.opening_balance_cents` added so net worth means something
- [x] `/investments`: holdings table, P&L vs cost basis, allocation bars
- [x] Price fetching: CoinGecko (crypto, no key), Finnhub (stocks, key), Frankfurter (FX, no key)
- [x] Per-symbol failure isolation + 12s timeouts on every request
- [x] Manual "Refresh prices" button; partial failures reported, never hidden
- [x] Pure maths extracted to `src/lib/portfolio.ts` — 11 more unit tests (20 total)
- [x] Gain/loss uses arrow + sign, not colour alone (green/red are ΔE 4.6 under protanopia)
- [ ] **You:** add a Finnhub key if you hold stocks; add holdings; hit Refresh
- [ ] Vercel Cron for daily prices — **deliberately deferred to Phase 5**, because
      Vercel Cron only runs against a deployed app. Setting it up now would do nothing.

## Phase 3 — Career + projects ✅ built, awaiting your click-through
- [x] Schema + RLS: `jobs`, `job_wins`, `projects`, `project_metrics`
- [x] `/career`: roles with salary (monthly or annual), wins log
- [x] `/projects`: status, MRR vs target bars, combined MRR rollup
- [x] Seeded example role + projects; salary left blank on purpose
- [x] Consolidated 3 duplicate delete buttons into `components/delete-form.tsx`
- [x] Added `npm run check:actions` — catches the `'use server'` non-async export
      bug that build/typecheck/tests all missed. Guard tested by injecting the bug.
- [x] Added `npm run verify` — check:actions + typecheck + tests + build in one command
- [ ] **You:** fill in your salary, log a win, update a project's MRR

## Phase 4 — Dashboard ✅ built, awaiting your click-through
- [x] Hero net worth figure, computed live (not read from the last snapshot)
- [x] Net worth area chart, hand-drawn SVG with hover crosshair + tooltip
      (no charting library — one chart doesn't justify ~100KB on every page)
- [x] KPI row: money in / out / left over this month
- [x] Biggest holdings + work/MRR summary cards, each linking to its page
- [x] Quick-add transaction from the dashboard
- [x] All 11 queries fired in parallel rather than sequentially
- [ ] **You:** check the dashboard numbers match the individual pages
- Note: chart shows "not enough history" until there are 2+ snapshots. Snapshots
  are written on price refresh; the Phase 5 cron makes this fill in daily.

## Phase 5 — Hardening + audit ✅ built, deploy pending
- [x] Vercel Cron route `/api/cron/prices` + `vercel.json` (01:00 UTC = 09:00 SGT)
- [x] Service-role client (`lib/supabase/admin.ts`), `server-only` guarded
- [x] Proxy allows `/api/cron` — route authenticates itself with CRON_SECRET
- [x] Verified: no auth → 401, wrong secret → 401, missing service key → clear 500
- [x] `npm run audit` — 5-part security check; **tested by injecting 2 real
      vulnerabilities**, caught both, exited non-zero, passed again after revert
- [x] Verified: 0 secrets in the 41-file browser bundle
- [x] Empty states on every page; skeleton loading state; error boundary
- [x] `DEPLOY.md` written
- [ ] **You:** add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local`
- [ ] **You:** push to a PRIVATE GitHub repo, import to Vercel, add env vars
- [ ] Verify cron + login on your phone

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | local server |
| `npm run verify` | action check + typecheck + tests + build |
| `npm run audit` | secrets, browser bundle, service-role placement |
| `npm run db:migrate` | apply new SQL in `supabase/migrations/` |
| `npm run db:check` | every table has RLS + a valid policy |

---

## Review

### Phase 0

**What was built:** a working, locked-down shell. No data yet by design — the
goal was to prove login and route protection work while there's almost no code
to debug.

**Decisions worth remembering:**

- **`proxy.ts`, not `middleware.ts`.** Next.js 16 renamed the convention. The
  scaffold's own `AGENTS.md` flagged that this version has breaking changes,
  and its bundled docs confirmed it. Most tutorials online are still on the old
  name.
- **Async request APIs.** `cookies()` and `searchParams` must be awaited in
  Next 16 — the synchronous version was removed, not just deprecated.
- **Password login, not magic links.** Free Supabase throttles outbound email
  to a few per hour. For an app only you use, that's a bad failure mode when
  you just want to check your net worth on the bus.
- **Two independent locks** on access: signups disabled in the Supabase
  dashboard, plus an `ALLOWED_EMAIL` check on every request. The allowlist
  fails closed — blank means nobody gets in, rather than everybody.
- **Login errors are deliberately vague.** Wrong email and wrong password give
  the identical message, so the page can't be used to figure out which email
  is the real account.
- **`npm audit` was left unfixed on purpose.** See lessons.md.

### Phase 2 — Telegram bot (Claude Opus 5), 27 Jul 2026

**What was built:** the voice. `POST /api/telegram` webhook → `after()` →
Claude Opus 5 manual tool loop (15 tools over `src/lib/queries/*`) →
`sendMessage`. Conversation memory in `chat_messages` (migration 0006).

- [x] Pure modules + tests: telegram/update, telegram/format, jarvis/tool-schemas
- [x] `@anthropic-ai/sdk` + optional `db?: Db` param on 18 query functions
      (admin client ⇒ explicit `user_id` scoping; web path byte-identical)
- [x] Migration 0006_chat.sql applied, db:check green
- [x] Server modules: telegram/api, jarvis/{db,history,execute,agent}
- [x] Webhook route (fail-closed 503/401/silent-drop) + PUBLIC_PATHS + admin comment
- [x] Audit script covers 3 new secrets + TOKEN prefix ban; env example; docs;
      `npm run telegram:setup` script
- [x] verify (54 tests) / audit / db:check all green; local curl e2e of all
      auth paths passed; `after()` pipeline confirmed reaching Anthropic client
- [ ] BLOCKED ON JAYDEN: @BotFather token, @userinfobot id, Anthropic API key
      → fill .env.local, `vercel env add` ×4, deploy, `npm run telegram:setup`

**Decisions worth remembering:**

- **Manual tool loop, not the SDK's beta toolRunner** — ~30 lines, no beta
  dependency, every step visible in Vercel function logs.
- **Amounts cross the tool boundary as strings**, parsed by `parseMoney` —
  the model never does float arithmetic; results carry cents + `display`.
- **`db?: Db` trailing param** keeps the web app path byte-identical while
  giving the bot an admin client scoped by `user_id` in code (the
  refresh-all.ts precedent, now documented in `src/lib/queries/db.ts`).
- **Reply 200 to Telegram for junk** (bad body, wrong user, edits) — any 4xx
  makes Telegram redeliver the same update forever. Only a bad secret gets 401.
- **`effort: 'low'`** on Opus 5 for latency; thinking stays adaptive.

### Phase 3 + full assistant — 27 Jul 2026 (same day, continued)

- [x] Read-only Google: calendar.readonly + gmail.readonly via raw REST,
      loopback token mint (`npm run google:auth`), 3 bot tools
- [x] Morning digest: /api/cron/digest (10:00 SGT), tested signal rules in
      pure signals.ts, Claude-composed with deterministic fallback,
      settings-controlled at /settings (mode + 5 section toggles, 0007)
- [x] Long-term memory: facts table (0008), remember/forget tools, facts in
      every turn's system prompt and in the digest
- [x] Sonnet 5 switch (cost), sin1 region pin (page loads 300ms → ~80ms)
- [x] Full read & write: 46 tools, tiered guardrails (adds instant / edits
      confirm-if-inferred / deletes always confirm, one id per yes, no bulk
      delete surface), zero-rows honesty checks on every update/delete
- [x] Code review + security audit: full-history leak scan clean, top 3
      findings fixed same day

**The day in one line:** idea → deployed tracker → Telegram voice →
Google-connected, memory-bearing, self-starting assistant. All three phases
of the original plan shipped in one session.
