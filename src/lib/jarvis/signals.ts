/**
 * The digest's judgment: which facts about today deserve a message.
 *
 * Pure and dependency-free (local types, local money formatting) so every
 * rule is unit-testable with `node --test` — this is exactly the kind of
 * threshold logic that rots silently without tests.
 *
 * Inputs are plain data; the orchestrator (src/lib/cron/digest.ts) does the
 * fetching. Dates are 'YYYY-MM-DD' strings compared lexically, the same
 * doctrine as src/lib/date.ts.
 */

export type SignalKind =
  | 'bill_due'
  | 'task_overdue'
  | 'portfolio_move'
  | 'spend_pace'
  | 'goal_deadline'
  | 'net_worth_high'

export type Signal = {
  kind: SignalKind
  severity: 'info' | 'notable'
  text: string
}

export type SignalsInput = {
  /** 'YYYY-MM-DD' in Asia/Singapore. */
  today: string
  recurring: Array<{
    name: string
    direction: 'income' | 'expense'
    amount_cents: number
    next_due: string | null
  }>
  tasks: Array<{ title: string; due_on: string | null; done: boolean }>
  /** Oldest first, as getNetWorthHistory returns. */
  netWorth: Array<{ asOf: string; totalCents: number; investmentsCents: number }>
  /** Current month's expenses so far. */
  monthExpenseCents: number
  /** Totals of up to 2 full prior months (may be empty early on). */
  priorMonthExpenseCents: number[]
  dayOfMonth: number
  daysInMonth: number
  goals: Array<{ title: string; status: string; target_date: string | null }>
}

// Thresholds — named so the tests read like the spec.
export const BILL_WINDOW_DAYS = 3
export const GOAL_WINDOW_DAYS = 7
export const PORTFOLIO_MOVE_CENTS = 50_000 // S$500
export const PORTFOLIO_MOVE_PCT = 0.03
export const SPEND_PACE_RATIO = 1.3
export const SPEND_PACE_MIN_DAY = 5

/** Minimal SGD formatter — local so this module stays dependency-free. */
function sgd(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100).toLocaleString('en-SG')
  return `${sign}S$${dollars}.${String(abs % 100).padStart(2, '0')}`
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function computeSignals(input: SignalsInput): Signal[] {
  const signals: Signal[] = []
  const { today } = input

  // Bills: overdue is notable, due within the window is a heads-up.
  const billWindowEnd = addDaysISO(today, BILL_WINDOW_DAYS)
  for (const r of input.recurring) {
    if (r.direction !== 'expense' || !r.next_due) continue
    if (r.next_due < today) {
      signals.push({
        kind: 'bill_due',
        severity: 'notable',
        text: `${r.name} (${sgd(r.amount_cents)}) is overdue — was due ${r.next_due}.`,
      })
    } else if (r.next_due <= billWindowEnd) {
      signals.push({
        kind: 'bill_due',
        severity: 'info',
        text: `${r.name} (${sgd(r.amount_cents)}) is due ${
          r.next_due === today ? 'today' : r.next_due
        }.`,
      })
    }
  }

  // Tasks: overdue is notable, due today is a heads-up.
  for (const t of input.tasks) {
    if (t.done || !t.due_on) continue
    if (t.due_on < today) {
      signals.push({
        kind: 'task_overdue',
        severity: 'notable',
        text: `Task "${t.title}" has been overdue since ${t.due_on}.`,
      })
    } else if (t.due_on === today) {
      signals.push({
        kind: 'task_overdue',
        severity: 'info',
        text: `Task "${t.title}" is due today.`,
      })
    }
  }

  // Portfolio: the move between the last two snapshots.
  if (input.netWorth.length >= 2) {
    const prev = input.netWorth[input.netWorth.length - 2]
    const last = input.netWorth[input.netWorth.length - 1]
    const delta = last.investmentsCents - prev.investmentsCents
    const pct =
      prev.investmentsCents > 0 ? delta / prev.investmentsCents : null

    if (
      Math.abs(delta) >= PORTFOLIO_MOVE_CENTS ||
      (pct !== null && Math.abs(pct) >= PORTFOLIO_MOVE_PCT)
    ) {
      const direction = delta >= 0 ? 'up' : 'down'
      const pctText = pct === null ? '' : ` (${(Math.abs(pct) * 100).toFixed(1)}%)`
      signals.push({
        kind: 'portfolio_move',
        severity: 'notable',
        text: `Investments ${direction} ${sgd(Math.abs(delta))}${pctText} since ${prev.asOf}.`,
      })
    }

    // All-time high on total net worth.
    const priorMax = Math.max(
      ...input.netWorth.slice(0, -1).map((p) => p.totalCents)
    )
    if (last.totalCents > priorMax) {
      signals.push({
        kind: 'net_worth_high',
        severity: 'info',
        text: `New all-time-high net worth: ${sgd(last.totalCents)}.`,
      })
    }
  }

  // Spending pace vs the average of prior full months, scaled to today.
  // Guards: needs a baseline, and early-month numbers are all noise.
  if (
    input.priorMonthExpenseCents.length >= 1 &&
    input.dayOfMonth >= SPEND_PACE_MIN_DAY &&
    input.daysInMonth > 0
  ) {
    const avg =
      input.priorMonthExpenseCents.reduce((a, b) => a + b, 0) /
      input.priorMonthExpenseCents.length
    const expected = (avg * input.dayOfMonth) / input.daysInMonth
    if (avg > 0 && input.monthExpenseCents >= SPEND_PACE_RATIO * expected) {
      const pct = Math.round((input.monthExpenseCents / expected - 1) * 100)
      signals.push({
        kind: 'spend_pace',
        severity: 'notable',
        text: `Spending is ${pct}% above your usual pace: ${sgd(
          input.monthExpenseCents
        )} so far this month vs ~${sgd(Math.round(expected))} expected by day ${input.dayOfMonth}.`,
      })
    }
  }

  // Goal deadlines inside the window.
  const goalWindowEnd = addDaysISO(today, GOAL_WINDOW_DAYS)
  for (const g of input.goals) {
    if (g.status !== 'active' || !g.target_date) continue
    if (g.target_date >= today && g.target_date <= goalWindowEnd) {
      signals.push({
        kind: 'goal_deadline',
        severity: 'info',
        text: `Goal "${g.title}" has its target date on ${g.target_date}.`,
      })
    }
  }

  // Urgent things first — the digest leads with them.
  return signals.sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'notable' ? -1 : 1
  )
}
