# Jarvis

A personal AI assistant that actually knows you.

Most assistants know nothing about your life. Ask one whether you can afford
something and it has no idea what you earn, what you hold, or what you spent
last month. Jarvis is an attempt to fix that from the bottom up: **give the
assistant a real memory first, then give it a way to talk.**

> This repository contains code only — no credentials, and no personal data.
> Seed rows are placeholders; everything real lives in your own database.

---

## The idea

An assistant is only as useful as what it knows about you. So the order matters:

1. **Build the memory.** A private database of the facts that actually govern
   your decisions — income, spending, investments, net worth, work, projects.
2. **Give it a voice.** Wire that memory to a frontier language model so you can
   ask questions in plain English instead of reading dashboards.
3. **Let it act.** Logging, reminders, and follow-ups initiated by Jarvis rather
   than by you.

Steps 1 and 2 are what's in this repository today.

---

## Where it is now — the memory layer

A private, single-user web app. Everything is manual entry plus automatic market
prices; nothing is guessed.

| Page | What it holds |
|---|---|
| `/` | Net worth, trend over time, this month's cashflow |
| `/money` | Income, expenses, categories, recurring costs, month-by-month |
| `/investments` | Crypto and stock holdings, live prices, profit/loss vs cost basis |
| `/career` | Roles, salary, and a dated log of what you shipped at work |
| `/projects` | Project status and monthly revenue against a target |

Multi-currency throughout: holdings priced in USD, converted to SGD at the daily
rate, so one number means one thing.

A scheduled job fetches crypto prices, stock prices, and the USD→SGD rate every
morning and records a net worth snapshot — so the history builds itself whether
or not you open the app.

### The part that matters for what comes next

**Every database read and write lives in `src/lib/queries/`** — never inside a
page. That isn't tidiness for its own sake. When Jarvis gains a chat interface,
its tools (`get_net_worth`, `log_income`, `how_much_did_i_spend_on`) call those
same functions. The assistant layer becomes a new front end on an existing brain,
not a rewrite.

---

## The voice — Telegram + Claude

Phase 2 is live: a Telegram bot backed by **Claude Opus 5** with tool access to
the same query layer the web app uses. Send *"log $12 lunch"* or *"what's my
net worth?"* and it reads or writes the same database.

How a message flows:

```
Telegram → POST /api/telegram          secret-token + user-id check, ack 200
         → after()                     work continues past the response
         → Claude Opus 5 tool loop     15 tools over src/lib/queries/*
         → sendMessage                 plain-text reply, chunked at 4096
```

The tools: `get_net_worth`, `get_net_worth_history`, `get_month_summary`,
`get_month_transactions`, `get_recurring`, `get_holdings`, `get_goals`,
`get_tasks`, `get_jobs`, `get_projects`, `log_transaction`, `create_task`,
`set_task_done`, `create_goal`, `set_goal_status`. Each one is a thin schema
over an existing function in `src/lib/queries/` — the payoff of never letting
data access live inside a page.

Security is the same fail-closed posture as the rest of the app: the route
returns 503 until its secrets are configured, rejects any request without the
webhook secret Telegram was registered with, and silently drops messages from
any Telegram account other than yours. The bot runs on the service-role client,
so every query it makes is scoped by `user_id` in code (`src/lib/queries/db.ts`
documents the contract). Conversation memory lives in the `chat_messages`
table — final text only, last ~20 turns replayed for context.

Set it up with `npm run telegram:setup` after deploying (see DEPLOY.md).

---

## Letting it act — Phase 3

Phase 3 is live too: Jarvis notices things and speaks first.

**Read-only Google.** Three more tools — `get_calendar_events`, `search_email`,
`get_email` — backed by OAuth scopes that can only *read*. "What's on
tomorrow?", "any email from the bank this week?" work from Telegram. Jarvis
cannot send mail, delete anything, or create events.

**The morning digest.** A second daily cron (10:00 SGT, an hour after prices
so the numbers are fresh) runs a rules engine over the data — bills due within
3 days, overdue tasks, portfolio moves ≥ 3% or S$500, spending ≥ 130% of your
usual pace, goal deadlines, net-worth highs — pulls today's calendar and
unread email, and has Claude write a short briefing to Telegram. If the model
API is down, a deterministic fallback renders the same facts; the briefing
always goes out. It also lands in chat history, so "wait, which bill?" just
works.

**You control it at /settings**: every morning, only when something's
noteworthy, or off — plus which sections it covers. The signal thresholds are
pure functions with unit tests (`src/lib/jarvis/signals.ts`), because silent
threshold logic is where alert systems rot.

---

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind + shadcn/ui (Base UI) ·
Supabase (Postgres + Auth) · Vercel

Prices: CoinGecko (crypto, no key) · Finnhub (stocks) · Frankfurter (FX, no key)

---

## Design decisions worth knowing

**Money is stored as integer cents, never floats.** `12.34` is `1234`. Floating
point can't hold decimals exactly — in JavaScript `0.1 + 0.2` really does equal
`0.30000000000000004` — and those errors accumulate until totals quietly drift.
Market prices go further and use *micros* (6 dp), so a sub-cent token doesn't
round away to zero.

**Row Level Security on every table.** The browser key is safe to ship precisely
because Postgres itself refuses to return rows that don't belong to the
signed-in user. Every policy carries both `using` and `with check` — without the
second, you could insert a row tagged with someone else's id.

**Two independent locks on access.** Signups are disabled in Supabase, *and* the
app checks an email allowlist on every request. The allowlist fails closed: if
it isn't configured, nobody gets in.

**Unpriced holdings show `—`, not `0`.** A zero would render as a 100% loss.
They're also excluded from both sides of the portfolio total, so a holding that
couldn't be priced doesn't invent a fake loss equal to its cost.

**Gain/loss never relies on colour alone.** Green and red are ~4.6 ΔE apart
under protanopia — effectively identical for roughly 1 in 12 men. Every figure
carries an arrow and a sign.

---

## Setup

See **[SETUP.md](./SETUP.md)** — Supabase project, keys, first account.
Then **[DEPLOY.md](./DEPLOY.md)** for Vercel and the daily price job.

```bash
npm install
cp .env.local.example .env.local   # fill it in
npm run db:migrate
npm run dev
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run verify` | Action check + typecheck + tests + build |
| `npm run audit` | Secret scan, browser-bundle scan, service-role placement |
| `npm run db:migrate` | Apply new SQL in `supabase/migrations/` |
| `npm run db:check` | Confirm every table has RLS and a valid policy |
| `npm run telegram:setup` | Register the Telegram webhook (after deploy) |
| `npm test` | Unit tests (money parsing, portfolio maths, dates, bot parsing) |

`npm run audit` exits non-zero on a real problem, so it can gate a deploy. Run
it before pushing anything public.
