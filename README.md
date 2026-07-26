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

Step 1 is what's in this repository today.

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

## Where it's going

**Telegram as the interface.** A dashboard makes you go and look. A chat thread
comes to you — and you already have it open. The goal is to send *"just got paid
3200"* or *"what's my runway?"* and have it land in the same database this app
writes to.

**A frontier model to understand it.** Turning a sentence into the right action
needs a real language model. Current options are the Claude API
(`claude-opus-5` for reasoning, `claude-haiku-4-5` for cheap high-frequency
calls) — the same family of tool-calling APIs that makes `get_net_worth` a
function the model can decide to call on its own.

**Then: proactive.** Once Jarvis can read the data and reach you, the interesting
version isn't answering questions — it's noticing. Spending up 40% this month.
A position down 30%. A subscription you forgot. That only works on top of a
database that's actually correct, which is why the foundation came first.

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
| `npm test` | Unit tests (money parsing, portfolio maths, dates) |

`npm run audit` exits non-zero on a real problem, so it can gate a deploy. Run
it before pushing anything public.
