import 'server-only'

import { currentMonth, isValidMonth, todayISO } from '@/lib/date'
import { listEvents } from '@/lib/google/calendar'
import { getMessage, searchMessages } from '@/lib/google/gmail'
import { formatMoney, monthlyEquivalentCents, parseMoney } from '@/lib/money'
import type { Db } from '@/lib/queries/db'
import { getNetWorthHistory } from '@/lib/queries/dashboard'
import { createFact, deleteFact } from '@/lib/queries/facts'
import { getJobs, getWins, monthlySalaryCents } from '@/lib/queries/career'
import {
  createGoal,
  getGoals,
  setGoalStatus,
  type GoalHorizon,
  type GoalStatus,
} from '@/lib/queries/goals'
import {
  buildPositions,
  getCashBalanceCents,
  getHoldings,
  getLatestPrices,
  getLatestUsdSgd,
  portfolioTotals,
} from '@/lib/queries/investments'
import {
  createTransaction,
  findOrCreateCategory,
  getTransactionsForMonth,
  summariseMonth,
  totalsByCategory,
} from '@/lib/queries/money'
import { getMetrics, getProjects, withProgress } from '@/lib/queries/projects'
import { getRecurring } from '@/lib/queries/recurring'
import {
  createTask,
  getTasks,
  setTaskDone,
  type TaskPriority,
} from '@/lib/queries/tasks'

/**
 * Executes one tool call from the Claude agent against the query layer.
 *
 * Every error thrown here is caught by the agent loop and returned to Claude
 * as an `is_error` tool result, so messages are written for the model to act
 * on ("amount must be positive"), not for a stack trace.
 *
 * Money convention in results: raw integer `*_cents` plus a preformatted
 * `display` string. The system prompt tells Claude to quote the display
 * strings rather than doing its own arithmetic.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function inputOf(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null
    ? (raw as Record<string, unknown>)
    : {}
}

function optionalString(input: Record<string, unknown>, key: string): string | null {
  const value = input[key]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${key} must be a string.`)
  const trimmed = value.trim()
  return trimmed || null
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = optionalString(input, key)
  if (!value) throw new Error(`${key} is required.`)
  return value
}

function oneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  key: string
): T {
  if ((allowed as readonly string[]).includes(value)) return value as T
  throw new Error(`${key} must be one of: ${allowed.join(', ')}.`)
}

function pastOrTodayDate(
  input: Record<string, unknown>,
  key: string
): string | null {
  const value = optionalString(input, key)
  if (value === null) return null
  if (!ISO_DATE.test(value)) throw new Error(`${key} must be YYYY-MM-DD.`)
  if (value > todayISO()) throw new Error(`${key} cannot be in the future.`)
  return value
}

function money(cents: number): { cents: number; display: string } {
  return { cents, display: formatMoney(cents) }
}

function monthFrom(input: Record<string, unknown>): string {
  const month = optionalString(input, 'month') ?? currentMonth()
  if (!isValidMonth(month)) throw new Error('month must be YYYY-MM.')
  return month
}

function clampedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export async function executeTool(
  name: string,
  raw: unknown,
  db: Db
): Promise<string> {
  const input = inputOf(raw)

  switch (name) {
    // --- reads -------------------------------------------------------------

    case 'get_net_worth': {
      const [holdings, prices, fx, cashCents] = await Promise.all([
        getHoldings(db),
        getLatestPrices(db),
        getLatestUsdSgd(db),
        getCashBalanceCents(db),
      ])
      const totals = portfolioTotals(
        buildPositions(holdings, prices, fx?.rate ?? null)
      )
      return JSON.stringify({
        net_worth: money(totals.marketValueCents + cashCents),
        investments: money(totals.marketValueCents),
        cash: money(cashCents),
        investment_gain: money(totals.gainCents),
        investment_gain_pct: totals.gainPct,
        unpriced_holdings: totals.unpricedCount,
        currency: 'SGD',
      })
    }

    case 'get_net_worth_history': {
      const daysRaw = input.days
      const days =
        typeof daysRaw === 'number' && Number.isFinite(daysRaw)
          ? Math.min(365, Math.max(1, Math.round(daysRaw)))
          : 30
      const points = await getNetWorthHistory(days, db)
      return JSON.stringify({
        oldest_first: true,
        points: points.map((p) => ({
          as_of: p.asOf,
          total: money(p.totalCents),
          investments: money(p.investmentsCents),
          cash: money(p.cashCents),
        })),
      })
    }

    case 'get_month_summary': {
      const month = monthFrom(input)
      const rows = await getTransactionsForMonth(month, db)
      const summary = summariseMonth(rows)
      return JSON.stringify({
        month,
        income: money(summary.incomeCents),
        expenses: money(summary.expenseCents),
        net: money(summary.netCents),
        transaction_count: summary.count,
        expenses_by_category: totalsByCategory(rows, 'expense').map((c) => ({
          category: c.name,
          total: money(c.totalCents),
        })),
        income_by_category: totalsByCategory(rows, 'income').map((c) => ({
          category: c.name,
          total: money(c.totalCents),
        })),
      })
    }

    case 'get_month_transactions': {
      const month = monthFrom(input)
      const rows = await getTransactionsForMonth(month, db)
      return JSON.stringify({
        month,
        total_count: rows.length,
        showing: Math.min(rows.length, 50),
        transactions: rows.slice(0, 50).map((t) => ({
          date: t.occurred_on,
          direction: t.direction,
          amount: money(t.amount_cents),
          category: t.category_name,
          note: t.note,
        })),
      })
    }

    case 'get_recurring': {
      const rows = await getRecurring(db)
      return JSON.stringify({
        today: todayISO(),
        items: rows.map((r) => ({
          name: r.name,
          direction: r.direction,
          amount: money(r.amount_cents),
          cadence: r.cadence,
          next_due: r.next_due,
          monthly_equivalent: money(
            monthlyEquivalentCents(r.amount_cents, r.cadence)
          ),
          category: r.category_name,
        })),
      })
    }

    case 'get_holdings': {
      const [holdings, prices, fx] = await Promise.all([
        getHoldings(db),
        getLatestPrices(db),
        getLatestUsdSgd(db),
      ])
      const positions = buildPositions(holdings, prices, fx?.rate ?? null)
      return JSON.stringify({
        positions: positions.map((p) => ({
          symbol: p.symbol,
          name: p.name,
          kind: p.kind,
          quantity: p.quantity,
          market_value: p.marketValueCents === null ? null : money(p.marketValueCents),
          cost_basis: money(p.costBasisSgdCents),
          gain: p.gainCents === null ? null : money(p.gainCents),
          gain_pct: p.gainPct,
          price_as_of: p.priceAsOf,
        })),
      })
    }

    case 'get_goals': {
      const goals = await getGoals(db)
      return JSON.stringify({
        goals: goals.map((g) => ({
          id: g.id,
          title: g.title,
          horizon: g.horizon,
          status: g.status,
          target_date: g.target_date,
          note: g.note,
        })),
      })
    }

    case 'get_tasks': {
      const tasks = await getTasks(db)
      return JSON.stringify({
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          priority: t.priority,
          due_on: t.due_on,
          done: t.done,
          goal: t.goal_title,
          note: t.note,
        })),
      })
    }

    case 'get_jobs': {
      const [jobs, wins] = await Promise.all([getJobs(db), getWins(db)])
      return JSON.stringify({
        jobs: jobs.map((j) => ({
          employer: j.employer,
          title: j.title,
          started_on: j.started_on,
          ended_on: j.ended_on,
          is_current: j.ended_on === null,
          monthly_salary:
            monthlySalaryCents(j) === null
              ? null
              : money(monthlySalaryCents(j) as number),
          salary_currency: j.salary_currency,
        })),
        wins: wins.map((w) => ({
          occurred_on: w.occurred_on,
          title: w.title,
          detail: w.detail,
        })),
      })
    }

    case 'get_projects': {
      const [projects, metrics] = await Promise.all([
        getProjects(db),
        getMetrics(db),
      ])
      return JSON.stringify({
        projects: withProgress(projects, metrics).map((p) => ({
          name: p.name,
          status: p.status,
          kind: p.kind,
          mrr: money(p.currentMrrCents),
          mrr_target: money(p.mrr_target_cents),
          progress_pct: p.progressPct,
          users: p.usersCount,
          url: p.url,
        })),
      })
    }

    // --- Google, read-only ---------------------------------------------------

    case 'get_calendar_events': {
      const days = clampedInt(input.days, 7, 1, 60)
      const today = todayISO()
      const events = await listEvents({
        // Explicit +08:00 — the calendar day must be the Singapore day.
        timeMin: `${today}T00:00:00+08:00`,
        timeMax: `${addDaysISO(today, days)}T00:00:00+08:00`,
        maxResults: 25,
      })
      return JSON.stringify({ today, days_ahead: days, events })
    }

    case 'search_email': {
      const query = requiredString(input, 'query')
      const max = clampedInt(input.max, 5, 1, 10)
      const emails = await searchMessages(query, max)
      return JSON.stringify({ query, results: emails })
    }

    case 'get_email': {
      const message = await getMessage(requiredString(input, 'id'))
      const truncated = message.body.length > 2000
      return JSON.stringify({
        ...message,
        body: truncated ? `${message.body.slice(0, 2000)}…` : message.body,
        truncated,
      })
    }

    // --- memory ------------------------------------------------------------

    case 'remember': {
      const fact = requiredString(input, 'fact')
      if (fact.length > 500) throw new Error('fact is too long (500 max).')
      await createFact(fact, db)
      return JSON.stringify({ remembered: fact })
    }

    case 'forget': {
      await deleteFact(requiredString(input, 'fact_id'), db)
      return JSON.stringify({ forgotten: true })
    }

    // --- writes ------------------------------------------------------------

    case 'log_transaction': {
      const direction = oneOf(
        requiredString(input, 'direction'),
        ['income', 'expense'] as const,
        'direction'
      )
      const parsed = parseMoney(requiredString(input, 'amount'))
      if (!parsed.ok) throw new Error(parsed.error)

      const note = optionalString(input, 'note')
      if (note && note.length > 280) throw new Error('note is too long (280 max).')

      const categoryName = optionalString(input, 'category')
      const category_id = categoryName
        ? await findOrCreateCategory(categoryName, direction, db)
        : null

      const occurred_on = pastOrTodayDate(input, 'date') ?? todayISO()

      await createTransaction(
        {
          occurred_on,
          direction,
          amount_cents: parsed.cents,
          category_id,
          account_id: null,
          note,
        },
        db
      )
      return JSON.stringify({
        logged: {
          date: occurred_on,
          direction,
          amount: money(parsed.cents),
          category: categoryName,
          note,
        },
      })
    }

    case 'create_task': {
      const priorityRaw = optionalString(input, 'priority')
      const priority: TaskPriority = priorityRaw
        ? oneOf(priorityRaw, ['low', 'medium', 'high'] as const, 'priority')
        : 'medium'
      const due_on = optionalString(input, 'due_on')
      if (due_on && !ISO_DATE.test(due_on))
        throw new Error('due_on must be YYYY-MM-DD.')

      const title = requiredString(input, 'title')
      await createTask(
        { goal_id: null, title, priority, due_on, note: optionalString(input, 'note') },
        db
      )
      return JSON.stringify({ created: { title, priority, due_on } })
    }

    case 'set_task_done': {
      const done = input.done === undefined ? true : input.done === true
      await setTaskDone(requiredString(input, 'task_id'), done, db)
      return JSON.stringify({ updated: { done } })
    }

    case 'create_goal': {
      const horizonRaw = optionalString(input, 'horizon')
      const horizon: GoalHorizon = horizonRaw
        ? oneOf(horizonRaw, ['short', 'long'] as const, 'horizon')
        : 'short'
      const target_date = optionalString(input, 'target_date')
      if (target_date && !ISO_DATE.test(target_date))
        throw new Error('target_date must be YYYY-MM-DD.')

      const title = requiredString(input, 'title')
      await createGoal(
        {
          title,
          horizon,
          status: 'active',
          target_date,
          note: optionalString(input, 'note'),
        },
        db
      )
      return JSON.stringify({ created: { title, horizon, target_date } })
    }

    case 'set_goal_status': {
      const status = oneOf(
        requiredString(input, 'status'),
        ['active', 'achieved', 'dropped'] as const,
        'status'
      ) as GoalStatus
      await setGoalStatus(requiredString(input, 'goal_id'), status, db)
      return JSON.stringify({ updated: { status } })
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
