# Jarvis Tracker

A private, single-user personal tracker: income and expenses, investments and
net worth, career history, and side-project revenue — in one place.

Built to be the data layer for a personal AI assistant, so every database read
and write is isolated in `src/lib/queries/` rather than buried in pages.

> This repository contains the code only. No credentials, and no personal data —
> the seed rows are placeholders. Everything real lives in your own Supabase
> database.

---

## What it does

| Page | What's there |
|---|---|
| `/` | Net worth hero figure, trend chart, this month's cashflow, quick-add |
| `/money` | Transactions, categories, recurring costs, month-by-month view |
| `/investments` | Crypto + stock holdings, live prices, profit/loss vs cost basis |
| `/career` | Roles, salary, and a dated log of what you shipped at work |
| `/projects` | Project status and MRR against a target |

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind + shadcn/ui (Base UI) ·
Supabase (Postgres + Auth) · Vercel

Prices: CoinGecko (crypto, no key) · Finnhub (stocks) · Frankfurter (FX, no key)

---

## Design decisions worth knowing

**Money is stored as integer cents, never floats.** `12.34` is `1234`. Floating
point can't hold decimals exactly — in JavaScript `0.1 + 0.2` really does equal
`0.30000000000000004` — and those errors accumulate until totals silently drift.
Market prices go further and use *micros* (6 dp), so a sub-cent token doesn't
round away to zero.

**Row Level Security on every table.** The browser key is safe to ship precisely
because Postgres refuses to return rows that don't belong to the signed-in user.
Every policy carries both `using` and `with check` — without the second, you
could insert a row tagged with someone else's id.

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
Then **[DEPLOY.md](./DEPLOY.md)** to put it on Vercel with the daily price job.

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
| `npm test` | Unit tests (money parsing, portfolio maths, dates) |

`npm run audit` exits non-zero on a real problem, so it can gate a deploy. Run
it before pushing anything public.
