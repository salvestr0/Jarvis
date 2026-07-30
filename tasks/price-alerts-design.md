# Price alerts — design

**Goal:** "tell me when BTC hits 120k" / "alert me if NVDA drops below 150"
→ a Telegram message within ~a minute of the crossing. Requested 31 Jul
("expand some actions"), built same night.

## How it works

A `price_alerts` row is a standing watch: symbol + kind (stock/crypto) +
direction (above/below) + target in USD micros. The check piggybacks on
the reminders tick — `/api/reminders/deliver` already runs every 60s while
the PC is awake (PC agent) and every ~5 min otherwise (GitHub Actions), so
alerts inherit both tickers, the atomic-claim pattern, and CRON_SECRET
auth with ZERO new infrastructure. No pending alerts = zero price API
calls on a tick (the common case).

Prices reuse `src/lib/prices.ts` exactly as the daily cron does: CoinGecko
for crypto (no key), Finnhub for stocks. Targets and quotes are USD —
that's the currency both feeds speak, same as the holdings screen.

## Semantics

- **One-shot**: fires once, flips to 'triggered' (with the price it saw),
  stays as audit. Re-arm = create again. No repeating alerts v1 — a level
  crossing back and forth would spam him.
- **Crossing** = `>=` target for above, `<=` for below.
- **Claim before send** (pending→triggered atomic flip), revert on send
  failure — same double-send-proof shape as reminders.
- **Created-already-true is refused**: "alert me when BTC is above 100k"
  while BTC sits at 117k is almost certainly not what he meant — the tool
  errors with the live price so the model asks him instead of instantly
  firing a junk alert.
- Creation validates the symbol by fetching a live quote first — typos die
  at create time with a clear error, not silently never-fire.
- A failed price fetch on a tick logs and leaves the alert pending — the
  next tick retries. One symbol failing never blocks the others.

## Bot tools (3 new → 54)

- `create_price_alert(symbol, kind, direction, target_price)` — ADD tier,
  immediate; confirms with current price + target.
- `list_price_alerts()` — pending, with ids and USD targets.
- `cancel_price_alert(alert_id)` — MODIFY tier status flip, zero-rows
  check as always.

## Pure logic (`src/lib/alerts.ts`, node --test covered)

USD micros parse/format (sub-cent coins keep 6 decimals; whole-dollar
targets render without cents), crossing predicate, and the alert message
(📈/📉, current price, target, "this alert is done" so he knows it won't
re-fire).

## Out of scope (v1)

- Repeating / re-arming alerts, hysteresis bands
- % moves ("tell me if BTC moves 5% today") — needs a reference price
- SGD targets (feeds are USD; converting would lie by the FX lag)
- Web UI (Telegram is the surface)
