import { ACTION_TOOLS } from '../action-claim.ts'

export type ActionOutcome = 'succeeded' | 'failed' | 'pending'

export type ActionReceipt = {
  toolName: string
  input: Record<string, unknown>
  output: string
  outcome: ActionOutcome
}

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function parseOutput(output: string): JsonObject | null {
  try {
    return object(JSON.parse(output))
  } catch {
    return null
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function displayMoney(value: unknown): string | null {
  return text(object(value)?.display)
}

/** Turn a raw tool result into a receipt only when the tool can change state. */
export function actionReceiptFromResult(
  toolName: string,
  input: unknown,
  output: string,
  isError: boolean
): ActionReceipt | null {
  if (!ACTION_TOOLS.has(toolName)) return null

  const parsed = parseOutput(output)
  let outcome: ActionOutcome = isError ? 'failed' : 'succeeded'

  // Some integrations report a handled no-op as a normal tool result rather
  // than throwing. These must not become a "done" receipt.
  if (
    parsed?.found === false ||
    parsed?.pc_offline === true ||
    parsed?.status === 'failed' ||
    parsed?.status === 'cancelled'
  ) {
    outcome = 'failed'
  } else if (parsed?.status === 'pending' || parsed?.status === 'running' || parsed?.status === 'still_running') {
    outcome = 'pending'
  }

  return {
    toolName,
    input: object(input) ?? {},
    output,
    outcome,
  }
}

function failureReason(receipt: ActionReceipt): string {
  const parsed = parseOutput(receipt.output)
  const reason = text(parsed?.note) ?? text(parsed?.error) ?? receipt.output.trim()
  return (reason || 'The tool did not complete the action.').slice(0, 300)
}

function genericLabel(toolName: string): string {
  return toolName.replaceAll('_', ' ')
}

function successLine(receipt: ActionReceipt): string {
  const data = parseOutput(receipt.output) ?? {}
  const input = receipt.input

  switch (receipt.toolName) {
    case 'log_transaction': {
      const logged = object(data.logged)
      const amount = displayMoney(logged?.amount) ?? text(input.amount) ?? 'transaction'
      const category = text(logged?.category) ?? text(input.category)
      const note = text(logged?.note) ?? text(input.note)
      const date = text(logged?.date)
      return `Logged: ${amount}${category ? ` · ${category}` : ''}${note ? ` — ${note}` : ''}${date ? ` (${date})` : ''}.`
    }
    case 'create_task': {
      const created = object(data.created)
      return `Task created: ${text(created?.title) ?? text(input.title) ?? 'Untitled task'}.`
    }
    case 'set_task_done': {
      const done = object(data.updated)?.done
      return done === false ? 'Task reopened.' : 'Task marked done.'
    }
    case 'create_goal': {
      const created = object(data.created)
      return `Goal created: ${text(created?.title) ?? text(input.title) ?? 'Untitled goal'}.`
    }
    case 'create_reminder': {
      const created = object(data.created)
      const body = text(created?.body) ?? text(input.body) ?? 'Reminder'
      const due = text(created?.due_at_sgt) ?? text(input.due_at)
      const repeat = text(created?.repeat)
      return `Reminder set: ${body}${due ? ` — ${due} SGT` : ''}${repeat && repeat !== 'none' ? ` (${repeat})` : ''}.`
    }
    case 'create_price_alert': {
      const created = object(data.created)
      const symbol = text(created?.symbol) ?? text(input.symbol) ?? 'Price'
      const direction = text(created?.direction) ?? text(input.direction)
      const target = text(created?.target_usd) ?? text(input.target_price)
      return `Price alert created: ${symbol}${direction && target ? ` ${direction} ${target}` : ''}.`
    }
    case 'create_calendar_event': {
      const summary = text(data.summary) ?? text(input.summary) ?? 'Event'
      const date = text(data.date) ?? text(input.date)
      const time = text(data.time) ?? text(input.time)
      return `Calendar event created: ${summary}${date ? ` — ${date}` : ''}${time ? ` ${time}` : ''}.`
    }
    case 'create_email_draft':
      return `Gmail draft created: ${text(input.subject) ? `“${text(input.subject)}”` : 'email'}${text(input.to) ? ` to ${text(input.to)}` : ''}. It has not been sent.`
    case 'spotify_play':
      if (text(data.playing)) return `Playing: ${text(data.playing)}.`
      if (text(data.queued)) return `Queued: ${text(data.queued)}.`
      return data.resumed === true ? 'Spotify resumed.' : 'Spotify action completed.'
    case 'spotify_control':
      if (typeof data.volume_percent === 'number') return `Spotify volume set to ${data.volume_percent}%.`
      return `Spotify ${text(data.done) ?? text(input.command) ?? 'control'} completed.`
    case 'pc_run_action':
      return `PC action completed: ${text(input.action) ?? 'requested action'}.`
    case 'remember':
      return `Remembered: ${text(data.remembered) ?? text(input.fact) ?? 'fact'}.`
    case 'forget':
      return 'Stored fact forgotten.'
    case 'save_content_idea': {
      const saved = object(data.saved)
      return `Content idea saved: ${text(saved?.idea) ?? text(input.text) ?? 'idea'}.`
    }
    case 'create_content_draft': {
      const created = object(data.created)
      return `Content draft created: ${text(created?.hook) ?? text(input.hook) ?? 'draft'}.`
    }
    case 'set_content_status':
      return `Content status set to ${text(object(data.updated)?.status) ?? text(input.status) ?? 'the requested value'}.`
    case 'record_project_metric': {
      const recorded = object(data.recorded)
      return `Project metric recorded: MRR ${displayMoney(recorded?.mrr) ?? text(input.mrr) ?? 'updated'}${typeof recorded?.users === 'number' ? `, ${recorded.users} users` : ''}.`
    }
    case 'create_recurring':
      return `Recurring payment created: ${text(input.name) ?? 'payment'}${displayMoney(object(data.created)?.amount) ? ` — ${displayMoney(object(data.created)?.amount)}` : ''}.`
    case 'log_recurring_payment':
      return 'Recurring payment logged and its next due date advanced.'
    case 'create_holding': {
      const created = object(data.created)
      return `Holding created: ${text(created?.symbol) ?? text(input.symbol) ?? 'holding'}.`
    }
    case 'create_account':
      return `Account created: ${text(input.name) ?? 'account'}.`
    case 'create_job':
      return `Job created: ${text(input.title) ?? 'role'}${text(input.employer) ? ` at ${text(input.employer)}` : ''}.`
    case 'create_win':
      return `Win recorded: ${text(input.title) ?? 'career win'}.`
    case 'create_project':
      return `Project created: ${text(input.name) ?? 'project'}.`
  }

  if (receipt.toolName.startsWith('delete_')) {
    return `${genericLabel(receipt.toolName.slice('delete_'.length)).replace(/^./, (c) => c.toUpperCase())} deleted.`
  }
  if (receipt.toolName.startsWith('update_')) {
    return `${genericLabel(receipt.toolName.slice('update_'.length)).replace(/^./, (c) => c.toUpperCase())} updated.`
  }
  if (receipt.toolName.startsWith('cancel_')) {
    return `${genericLabel(receipt.toolName.slice('cancel_'.length)).replace(/^./, (c) => c.toUpperCase())} cancelled.`
  }
  if (receipt.toolName.startsWith('set_')) {
    return `${genericLabel(receipt.toolName.slice('set_'.length)).replace(/^./, (c) => c.toUpperCase())} updated.`
  }
  if (receipt.toolName === 'archive_account') return 'Account archived.'

  return `${genericLabel(receipt.toolName).replace(/^./, (c) => c.toUpperCase())} succeeded.`
}

export function formatActionReceipts(receipts: readonly ActionReceipt[]): string {
  return receipts
    .map((receipt) => {
      if (receipt.outcome === 'failed') {
        return `Couldn’t complete ${genericLabel(receipt.toolName)}: ${failureReason(receipt)}`
      }
      if (receipt.outcome === 'pending') {
        const parsed = parseOutput(receipt.output)
        const id = text(parsed?.job_id)
        return `Still working on ${genericLabel(receipt.toolName)}${id ? ` (job ${id})` : ''}.`
      }
      return successLine(receipt)
    })
    .join('\n')
}
