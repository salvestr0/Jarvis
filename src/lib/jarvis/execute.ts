import 'server-only'

import { currentMonth, isValidMonth, todayISO } from '@/lib/date'
import { createEvent, listEvents } from '@/lib/google/calendar'
import { createDraft, getMessage, searchMessages } from '@/lib/google/gmail'
import { createPcJob, getPcJob, isPcOnline, waitForPcJob } from '@/lib/queries/pc'
import {
  control as spotifyControl,
  nowPlaying as spotifyNowPlaying,
  play as spotifyPlay,
  queue as spotifyQueue,
  search as spotifySearch,
  setVolume as spotifySetVolume,
  type PlayableKind,
} from '@/lib/spotify/player'
import { sendPhoto } from '@/lib/telegram/api'
import { formatMoney, monthlyEquivalentCents, parseMoney } from '@/lib/money'
import type { Db } from '@/lib/queries/db'
import { getNetWorthHistory } from '@/lib/queries/dashboard'
import { createFact, deleteFact } from '@/lib/queries/facts'
import {
  createJob,
  createWin,
  deleteJob,
  deleteWin,
  getJobs,
  getWins,
  monthlySalaryCents,
  updateJob,
  type SalaryPeriod,
} from '@/lib/queries/career'
import {
  createGoal,
  deleteGoal,
  getGoals,
  setGoalStatus,
  updateGoal,
  type GoalHorizon,
  type GoalStatus,
} from '@/lib/queries/goals'
import {
  buildPositions,
  createHolding,
  deleteHolding,
  getCashBalanceCents,
  getHoldings,
  getLatestPrices,
  getLatestUsdSgd,
  portfolioTotals,
  updateHolding,
  type HoldingKind,
} from '@/lib/queries/investments'
import {
  archiveAccount,
  createAccount,
  createTransaction,
  deleteTransaction,
  findOrCreateCategory,
  getAccounts,
  getTransactionsForMonth,
  summariseMonth,
  totalsByCategory,
  updateAccount,
} from '@/lib/queries/money'
import {
  createProject,
  deleteProject,
  getMetrics,
  getProjects,
  recordMetric,
  setProjectStatus,
  updateProject,
  withProgress,
  type ProjectKind,
  type ProjectStatus,
} from '@/lib/queries/projects'
import {
  createRecurring,
  deleteRecurring,
  getRecurring,
  logRecurringPayment,
  updateRecurring,
} from '@/lib/queries/recurring'
import {
  createTask,
  deleteTask,
  getTasks,
  setTaskDone,
  updateTask,
  type TaskPriority,
} from '@/lib/queries/tasks'
import { parseQuantity } from '@/lib/quantity'
import type { AccountKind, Cadence } from '@/lib/types'

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

/**
 * Shape a PC job result for the model. Two concerns: a pc_read_file result
 * can carry up to 64KB (same context-bloat fix as get_email: clamp and flag
 * the cut), and a screenshot carries JPEG bytes the model should never see —
 * those are relayed straight to Jayden's Telegram and replaced with a note.
 */
async function relayPcResult(
  result: Record<string, unknown> | null
): Promise<Record<string, unknown>> {
  if (!result) return {}
  if (typeof result.screenshot_b64 === 'string') {
    const userId = Number(process.env.TELEGRAM_USER_ID)
    if (!Number.isFinite(userId)) throw new Error('TELEGRAM_USER_ID is not set.')
    await sendPhoto(userId, Buffer.from(result.screenshot_b64, 'base64'))
    return { screenshot_sent: true, note: 'The screenshot is in the chat above this reply.' }
  }
  if (typeof result.content === 'string' && result.content.length > 4000) {
    return { ...result, content: `${result.content.slice(0, 4000)}…`, truncated: true }
  }
  return result
}

/**
 * Optional money field: null when absent. parseMoney rejects zero on purpose
 * (a $0 transaction is a mistake), but some fields legitimately hold 0 —
 * opening balances, airdropped cost bases, "no target" — hence zeroOk.
 */
function moneyInput(
  input: Record<string, unknown>,
  key: string,
  opts: { zeroOk?: boolean } = {}
): number | null {
  const raw = optionalString(input, key)
  if (raw === null) return null
  if (opts.zeroOk && /^\$?\s*0(\.0{1,2})?$/.test(raw)) return 0
  const parsed = parseMoney(raw)
  if (!parsed.ok) throw new Error(`${key}: ${parsed.error}`)
  return parsed.cents
}

function isoOrThrow(value: string, key: string): string {
  if (!ISO_DATE.test(value)) throw new Error(`${key} must be YYYY-MM-DD.`)
  return value
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
      // Throw on a wrong type ("90" as a string) instead of silently falling
      // back to 30 — the model would present 30 points as "the last 90 days".
      if (
        daysRaw !== undefined &&
        (typeof daysRaw !== 'number' || !Number.isFinite(daysRaw))
      )
        throw new Error('days must be a number.')
      const days =
        daysRaw === undefined ? 30 : Math.min(365, Math.max(1, Math.round(daysRaw)))
      const points = await getNetWorthHistory(days, db)
      return JSON.stringify({
        days,
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
          id: t.id,
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
          id: r.id,
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
          id: p.id,
          symbol: p.symbol,
          name: p.name,
          kind: p.kind,
          quantity: p.quantity,
          cost_currency: p.cost_currency,
          note: p.note,
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
          id: j.id,
          employer: j.employer,
          title: j.title,
          salary_period: j.salary_period,
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
          id: w.id,
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
          id: p.id,
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

    // --- Google, write (create-only) -----------------------------------------

    case 'create_calendar_event': {
      const summary = requiredString(input, 'summary')
      const date = requiredString(input, 'date')
      if (!ISO_DATE.test(date)) throw new Error('date must be YYYY-MM-DD.')
      const time = optionalString(input, 'time')
      const location = optionalString(input, 'location') ?? undefined
      const description = optionalString(input, 'description') ?? undefined

      let start: { dateTime: string } | { date: string }
      let end: { dateTime: string } | { date: string }
      if (time === null) {
        // All-day: the API's end date is exclusive.
        start = { date }
        end = { date: addDaysISO(date, 1) }
      } else {
        const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
        if (!match) throw new Error('time must be HH:MM (24h).')
        const duration = clampedInt(input.duration_minutes, 60, 5, 24 * 60)
        const endTotal =
          Number(match[1]) * 60 + Number(match[2]) + duration
        const endTime = `${String(Math.floor(endTotal / 60) % 24).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}`
        // Explicit +08:00 — event times are Singapore wall-clock times.
        start = { dateTime: `${date}T${time}:00+08:00` }
        end = {
          dateTime: `${addDaysISO(date, Math.floor(endTotal / (24 * 60)))}T${endTime}:00+08:00`,
        }
      }

      const created = await createEvent({ summary, start, end, location, description })
      return JSON.stringify({
        created: true,
        summary,
        date,
        time: time ?? 'all-day',
        link: created.htmlLink,
      })
    }

    case 'create_email_draft': {
      const draft = await createDraft({
        to: requiredString(input, 'to'),
        subject: requiredString(input, 'subject'),
        body: requiredString(input, 'body'),
      })
      return JSON.stringify({
        draft_created: true,
        draft_id: draft.id,
        note: 'Draft only — it will not send until Jayden sends it from Gmail.',
      })
    }

    // --- Spotify --------------------------------------------------------------

    case 'spotify_play': {
      const query = optionalString(input, 'query')
      if (query === null) {
        await spotifyControl('resume')
        return JSON.stringify({ resumed: true })
      }
      const kindRaw = optionalString(input, 'kind') ?? 'track'
      const kinds: PlayableKind[] = ['track', 'album', 'playlist', 'artist']
      const kind = (kinds as string[]).includes(kindRaw)
        ? (kindRaw as PlayableKind)
        : 'track'
      const found = await spotifySearch(query, kind)
      if (!found) {
        return JSON.stringify({ found: false, note: `No ${kind} matched "${query}".` })
      }
      if (input.queue === true && found.kind === 'track') {
        await spotifyQueue(found)
        return JSON.stringify({ queued: `${found.name}${found.by ? ` — ${found.by}` : ''}` })
      }
      await spotifyPlay(found)
      return JSON.stringify({
        playing: `${found.name}${found.by ? ` — ${found.by}` : ''}`,
        kind: found.kind,
      })
    }

    case 'spotify_control': {
      const command = requiredString(input, 'command')
      if (command === 'volume') {
        const percent = clampedInt(input.volume_percent, 50, 0, 100)
        await spotifySetVolume(percent)
        return JSON.stringify({ volume_percent: percent })
      }
      if (!['pause', 'resume', 'next', 'previous'].includes(command)) {
        throw new Error('command must be pause, resume, next, previous, or volume.')
      }
      await spotifyControl(command as 'pause' | 'resume' | 'next' | 'previous')
      return JSON.stringify({ done: command })
    }

    case 'spotify_now_playing': {
      return JSON.stringify(await spotifyNowPlaying())
    }

    // --- PC access, tier 1 (read-only) --------------------------------------

    case 'pc_list_dir':
    case 'pc_read_file':
    case 'pc_search_files':
    case 'pc_run_action': {
      if (!(await isPcOnline(db))) {
        return JSON.stringify({
          pc_offline: true,
          note: 'His PC agent is not running. Tell him to start it with `npm run pc:agent` if he wants PC access.',
        })
      }
      const kind =
        name === 'pc_list_dir'
          ? 'list_dir'
          : name === 'pc_read_file'
            ? 'read_file'
            : name === 'pc_search_files'
              ? 'search_files'
              : 'run_action'
      const jobId = await createPcJob(db, kind, input)
      const job = await waitForPcJob(db, jobId)
      if (!job || job.status === 'pending' || job.status === 'running') {
        return JSON.stringify({
          job_id: jobId,
          status: 'still_running',
          note: 'Check again with pc_job_status.',
        })
      }
      return JSON.stringify({ status: job.status, ...(await relayPcResult(job.result)) })
    }

    case 'pc_job_status': {
      const job = await getPcJob(db, requiredString(input, 'job_id'))
      if (!job) throw new Error('No PC job found with that id.')
      return JSON.stringify({ status: job.status, ...(await relayPcResult(job.result)) })
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
      // Throw on a non-boolean ("true" as a string would coerce to false and
      // REOPEN the task) so the model self-corrects like other validators.
      if (input.done !== undefined && typeof input.done !== 'boolean')
        throw new Error('done must be a boolean.')
      const done = input.done === undefined ? true : input.done
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

    case 'set_project_status': {
      const status = oneOf(
        requiredString(input, 'status'),
        ['idea', 'building', 'beta', 'launched', 'paused', 'archived'] as const,
        'status'
      ) as ProjectStatus
      await setProjectStatus(requiredString(input, 'project_id'), status, db)
      return JSON.stringify({ updated: { status } })
    }

    case 'record_project_metric': {
      const mrrRaw = requiredString(input, 'mrr')
      // parseMoney rejects zero on purpose (a $0 transaction is a mistake),
      // but an MRR of 0 is a legitimate report — allow it explicitly.
      let mrr_cents: number
      if (/^\$?\s*0(\.0{1,2})?$/.test(mrrRaw)) {
        mrr_cents = 0
      } else {
        const parsed = parseMoney(mrrRaw)
        if (!parsed.ok) throw new Error(parsed.error)
        mrr_cents = parsed.cents
      }

      const usersRaw = input.users
      const users_count =
        typeof usersRaw === 'number' && Number.isFinite(usersRaw)
          ? Math.max(0, Math.round(usersRaw))
          : null

      await recordMetric(
        {
          project_id: requiredString(input, 'project_id'),
          as_of: todayISO(),
          mrr_cents,
          users_count,
        },
        db
      )
      return JSON.stringify({
        recorded: { as_of: todayISO(), mrr: money(mrr_cents), users: users_count },
      })
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

    // --- updates -----------------------------------------------------------

    case 'update_task': {
      const id = requiredString(input, 'task_id')
      const row = (await getTasks(db)).find((t) => t.id === id)
      if (!row) throw new Error('No task found with that id. Call get_tasks first.')
      const priorityRaw = optionalString(input, 'priority')
      const dueRaw = optionalString(input, 'due_on')
      await updateTask(
        id,
        {
          goal_id: row.goal_id,
          title: optionalString(input, 'title') ?? row.title,
          priority: priorityRaw
            ? (oneOf(priorityRaw, ['low', 'medium', 'high'] as const, 'priority') as TaskPriority)
            : row.priority,
          due_on:
            dueRaw === 'none' ? null : dueRaw ? isoOrThrow(dueRaw, 'due_on') : row.due_on,
          note: optionalString(input, 'note') ?? row.note,
        },
        db
      )
      return JSON.stringify({ updated: id })
    }

    case 'update_goal': {
      const id = requiredString(input, 'goal_id')
      const row = (await getGoals(db)).find((g) => g.id === id)
      if (!row) throw new Error('No goal found with that id. Call get_goals first.')
      const horizonRaw = optionalString(input, 'horizon')
      const targetRaw = optionalString(input, 'target_date')
      await updateGoal(
        id,
        {
          title: optionalString(input, 'title') ?? row.title,
          horizon: horizonRaw
            ? (oneOf(horizonRaw, ['short', 'long'] as const, 'horizon') as GoalHorizon)
            : row.horizon,
          status: row.status,
          target_date:
            targetRaw === 'none'
              ? null
              : targetRaw
                ? isoOrThrow(targetRaw, 'target_date')
                : row.target_date,
          note: optionalString(input, 'note') ?? row.note,
        },
        db
      )
      return JSON.stringify({ updated: id })
    }

    case 'create_recurring': {
      const directionRaw = optionalString(input, 'direction')
      const direction = directionRaw
        ? oneOf(directionRaw, ['income', 'expense'] as const, 'direction')
        : 'expense'
      const parsed = parseMoney(requiredString(input, 'amount'))
      if (!parsed.ok) throw new Error(parsed.error)
      const categoryName = optionalString(input, 'category')
      await createRecurring(
        {
          name: requiredString(input, 'name'),
          direction,
          amount_cents: parsed.cents,
          cadence: oneOf(
            requiredString(input, 'cadence'),
            ['weekly', 'monthly', 'yearly'] as const,
            'cadence'
          ) as Cadence,
          next_due: isoOrThrow(requiredString(input, 'next_due'), 'next_due'),
          category_id: categoryName
            ? await findOrCreateCategory(categoryName, direction, db)
            : null,
        },
        db
      )
      return JSON.stringify({ created: { amount: money(parsed.cents) } })
    }

    case 'update_recurring': {
      const id = requiredString(input, 'recurring_id')
      const row = (await getRecurring(db)).find((r) => r.id === id)
      if (!row)
        throw new Error('No recurring payment found with that id. Call get_recurring first.')
      const cadenceRaw = optionalString(input, 'cadence')
      const dueRaw = optionalString(input, 'next_due')
      await updateRecurring(
        id,
        {
          name: optionalString(input, 'name') ?? row.name,
          direction: row.direction,
          amount_cents: moneyInput(input, 'amount') ?? row.amount_cents,
          cadence: cadenceRaw
            ? (oneOf(cadenceRaw, ['weekly', 'monthly', 'yearly'] as const, 'cadence') as Cadence)
            : row.cadence,
          next_due: dueRaw ? isoOrThrow(dueRaw, 'next_due') : (row.next_due ?? todayISO()),
          category_id: row.category_id,
        },
        db
      )
      return JSON.stringify({ updated: id })
    }

    case 'log_recurring_payment': {
      await logRecurringPayment(requiredString(input, 'recurring_id'), db)
      return JSON.stringify({ logged: true, next_due_advanced: true })
    }

    case 'create_holding': {
      const kind = oneOf(
        requiredString(input, 'kind'),
        ['crypto', 'stock', 'manual'] as const,
        'kind'
      ) as HoldingKind
      const symbolRaw = requiredString(input, 'symbol')
      const symbol = kind === 'manual' ? symbolRaw : symbolRaw.toUpperCase()
      const q = parseQuantity(optionalString(input, 'quantity') ?? '1')
      if (!q.ok) throw new Error(`quantity: ${q.error}`)
      const defaultCurrency = kind === 'manual' ? 'SGD' : 'USD'
      const manual = moneyInput(input, 'manual_value', { zeroOk: true })
      await createHolding(
        {
          kind,
          symbol,
          name: optionalString(input, 'name'),
          quantity: q.value,
          cost_basis_cents: moneyInput(input, 'cost_basis', { zeroOk: true }) ?? 0,
          cost_currency:
            (optionalString(input, 'cost_currency') ?? defaultCurrency).toUpperCase(),
          price_currency: defaultCurrency,
          note: null,
          manual_value_cents: kind === 'manual' ? manual : null,
        },
        db
      )
      return JSON.stringify({ created: { kind, symbol, quantity: q.value } })
    }

    case 'update_holding': {
      const id = requiredString(input, 'holding_id')
      const row = (await getHoldings(db)).find((h) => h.id === id)
      if (!row) throw new Error('No holding found with that id. Call get_holdings first.')
      let quantity = row.quantity
      const qRaw = optionalString(input, 'quantity')
      if (qRaw) {
        const q = parseQuantity(qRaw)
        if (!q.ok) throw new Error(`quantity: ${q.error}`)
        quantity = q.value
      }
      await updateHolding(
        id,
        {
          kind: row.kind,
          symbol: row.symbol,
          name: optionalString(input, 'name') ?? row.name,
          quantity,
          cost_basis_cents:
            moneyInput(input, 'cost_basis', { zeroOk: true }) ?? row.cost_basis_cents,
          cost_currency: row.cost_currency,
          price_currency: row.price_currency,
          note: optionalString(input, 'note') ?? row.note,
          manual_value_cents:
            moneyInput(input, 'manual_value', { zeroOk: true }) ?? row.manual_value_cents,
        },
        db
      )
      return JSON.stringify({ updated: id })
    }

    case 'get_accounts': {
      const accounts = await getAccounts(db)
      return JSON.stringify({
        accounts: accounts.map((a) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          currency: a.currency,
          opening_balance: money(a.opening_balance_cents),
        })),
      })
    }

    case 'create_account': {
      await createAccount(
        {
          name: requiredString(input, 'name'),
          kind: oneOf(
            requiredString(input, 'kind'),
            ['cash', 'bank', 'brokerage', 'crypto_wallet', 'other'] as const,
            'kind'
          ) as AccountKind,
          currency: 'SGD',
          opening_balance_cents: moneyInput(input, 'opening_balance', { zeroOk: true }) ?? 0,
        },
        db
      )
      return JSON.stringify({ created: true })
    }

    case 'update_account': {
      const id = requiredString(input, 'account_id')
      const row = (await getAccounts(db)).find((a) => a.id === id)
      if (!row) throw new Error('No account found with that id. Call get_accounts first.')
      const kindRaw = optionalString(input, 'kind')
      await updateAccount(
        id,
        {
          name: optionalString(input, 'name') ?? row.name,
          kind: kindRaw
            ? (oneOf(
                kindRaw,
                ['cash', 'bank', 'brokerage', 'crypto_wallet', 'other'] as const,
                'kind'
              ) as AccountKind)
            : row.kind,
          currency: row.currency,
          opening_balance_cents:
            moneyInput(input, 'opening_balance', { zeroOk: true }) ??
            row.opening_balance_cents,
        },
        db
      )
      return JSON.stringify({ updated: id })
    }

    case 'create_job': {
      const periodRaw = optionalString(input, 'salary_period')
      await createJob(
        {
          employer: requiredString(input, 'employer'),
          title: requiredString(input, 'title'),
          started_on: optionalString(input, 'started_on')
            ? isoOrThrow(optionalString(input, 'started_on') as string, 'started_on')
            : todayISO(),
          ended_on: null,
          salary_cents: moneyInput(input, 'salary', { zeroOk: true }),
          salary_currency: 'SGD',
          salary_period: periodRaw
            ? (oneOf(periodRaw, ['monthly', 'annual'] as const, 'salary_period') as SalaryPeriod)
            : 'monthly',
          note: null,
        },
        db
      )
      return JSON.stringify({ created: true })
    }

    case 'update_job': {
      const id = requiredString(input, 'job_id')
      const row = (await getJobs(db)).find((j) => j.id === id)
      if (!row) throw new Error('No job found with that id. Call get_jobs first.')
      const periodRaw = optionalString(input, 'salary_period')
      const endedRaw = optionalString(input, 'ended_on')
      await updateJob(
        id,
        {
          employer: optionalString(input, 'employer') ?? row.employer,
          title: optionalString(input, 'title') ?? row.title,
          started_on: row.started_on,
          ended_on:
            endedRaw === 'current'
              ? null
              : endedRaw
                ? isoOrThrow(endedRaw, 'ended_on')
                : row.ended_on,
          salary_cents: moneyInput(input, 'salary', { zeroOk: true }) ?? row.salary_cents,
          salary_currency: row.salary_currency,
          salary_period: periodRaw
            ? (oneOf(periodRaw, ['monthly', 'annual'] as const, 'salary_period') as SalaryPeriod)
            : row.salary_period,
          note: row.note,
        },
        db
      )
      return JSON.stringify({ updated: id })
    }

    case 'create_win': {
      const dateRaw = optionalString(input, 'date')
      await createWin(
        {
          job_id: null,
          occurred_on: dateRaw ? isoOrThrow(dateRaw, 'date') : todayISO(),
          title: requiredString(input, 'title'),
          detail: optionalString(input, 'detail'),
        },
        db
      )
      return JSON.stringify({ created: true })
    }

    case 'create_project': {
      const kindRaw = optionalString(input, 'kind')
      const statusRaw = optionalString(input, 'status')
      await createProject(
        {
          name: requiredString(input, 'name'),
          status: statusRaw
            ? (oneOf(
                statusRaw,
                ['idea', 'building', 'beta', 'launched', 'paused', 'archived'] as const,
                'status'
              ) as ProjectStatus)
            : 'idea',
          kind: kindRaw
            ? (oneOf(kindRaw, ['product', 'content', 'business'] as const, 'kind') as ProjectKind)
            : 'product',
          launch_date: null,
          mrr_target_cents: moneyInput(input, 'mrr_target', { zeroOk: true }) ?? 0,
          url: optionalString(input, 'url'),
          note: null,
        },
        db
      )
      return JSON.stringify({ created: true })
    }

    case 'update_project': {
      const id = requiredString(input, 'project_id')
      const row = (await getProjects(db)).find((p) => p.id === id)
      if (!row) throw new Error('No project found with that id. Call get_projects first.')
      const kindRaw = optionalString(input, 'kind')
      const launchRaw = optionalString(input, 'launch_date')
      await updateProject(
        id,
        {
          name: optionalString(input, 'name') ?? row.name,
          status: row.status,
          kind: kindRaw
            ? (oneOf(kindRaw, ['product', 'content', 'business'] as const, 'kind') as ProjectKind)
            : row.kind,
          launch_date: launchRaw ? isoOrThrow(launchRaw, 'launch_date') : row.launch_date,
          mrr_target_cents:
            moneyInput(input, 'mrr_target', { zeroOk: true }) ?? row.mrr_target_cents,
          url: optionalString(input, 'url') ?? row.url,
          note: row.note,
        },
        db
      )
      return JSON.stringify({ updated: id })
    }

    // --- deletes (the agent must have Jayden's explicit confirmation) --------

    case 'delete_transaction': {
      await deleteTransaction(requiredString(input, 'transaction_id'), db)
      return JSON.stringify({ deleted: true })
    }

    case 'delete_task': {
      await deleteTask(requiredString(input, 'task_id'), db)
      return JSON.stringify({ deleted: true })
    }

    case 'delete_goal': {
      await deleteGoal(requiredString(input, 'goal_id'), db)
      return JSON.stringify({ deleted: true })
    }

    case 'delete_recurring': {
      await deleteRecurring(requiredString(input, 'recurring_id'), db)
      return JSON.stringify({ deleted: true })
    }

    case 'delete_holding': {
      await deleteHolding(requiredString(input, 'holding_id'), db)
      return JSON.stringify({ deleted: true })
    }

    case 'delete_job': {
      await deleteJob(requiredString(input, 'job_id'), db)
      return JSON.stringify({ deleted: true })
    }

    case 'delete_win': {
      await deleteWin(requiredString(input, 'win_id'), db)
      return JSON.stringify({ deleted: true })
    }

    case 'delete_project': {
      await deleteProject(requiredString(input, 'project_id'), db)
      return JSON.stringify({ deleted: true })
    }

    case 'archive_account': {
      await archiveAccount(requiredString(input, 'account_id'), db)
      return JSON.stringify({ archived: true })
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
