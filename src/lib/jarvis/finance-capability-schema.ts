type JsonObject = Record<string, unknown>

type LogExpenseRequest = {
  name: 'log_expense'
  input: { amount: string; category: string; note?: string; date?: string }
}
type SpendingSummaryRequest = {
  name: 'get_spending_summary'
  input: { month?: string }
}
type RecentExpensesRequest = {
  name: 'get_recent_expenses'
  input: { limit?: number }
}
type PreviewEmailExpensesRequest = {
  name: 'preview_email_expenses'
  input: { days?: number }
}
type CommitEmailExpensesRequest = {
  name: 'commit_email_expenses'
  input: {
    batch_id: string
    items: Array<{
      index: number
      amount: string
      category: string
      note?: string
      date?: string
    }>
  }
}

export type FinanceToolRequest =
  | LogExpenseRequest
  | SpendingSummaryRequest
  | RecentExpensesRequest
  | PreviewEmailExpensesRequest
  | CommitEmailExpensesRequest

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value as JsonObject
}

function onlyKeys(value: JsonObject, keys: string[]) {
  const unexpected = Object.keys(value).find((key) => !keys.includes(key))
  if (unexpected) throw new Error(`Unexpected field: ${unexpected}`)
}

function string(
  value: unknown,
  label: string,
  options: { optional?: boolean; max?: number } = {}
): string | undefined {
  if (value === undefined && options.optional) return undefined
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`)
  }
  const result = value.trim()
  if (result.length > (options.max ?? 200)) throw new Error(`${label} is too long.`)
  return result
}

function amount(value: unknown): string {
  const result = string(value, 'amount', { max: 24 })!
  if (!/^\d+(?:\.\d{1,2})?$/.test(result) || Number(result) <= 0) {
    throw new Error('amount must be a positive decimal with at most two decimal places.')
  }
  return result
}

function date(value: unknown): string | undefined {
  const result = string(value, 'date', { optional: true, max: 10 })
  if (result && !/^\d{4}-\d{2}-\d{2}$/.test(result)) {
    throw new Error('date must use YYYY-MM-DD.')
  }
  return result
}

function month(value: unknown): string | undefined {
  const result = string(value, 'month', { optional: true, max: 7 })
  if (result && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(result)) {
    throw new Error('month must use YYYY-MM.')
  }
  return result
}

function logExpense(input: JsonObject): LogExpenseRequest {
  onlyKeys(input, ['amount', 'category', 'note', 'date'])
  return {
    name: 'log_expense',
    input: {
      amount: amount(input.amount),
      category: string(input.category, 'category', { max: 80 })!,
      note: string(input.note, 'note', { optional: true, max: 200 }),
      date: date(input.date),
    },
  }
}

function commitEmailExpenses(input: JsonObject): CommitEmailExpensesRequest {
  onlyKeys(input, ['batch_id', 'items'])
  const batchId = string(input.batch_id, 'batch_id', { max: 36 })!
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId)) {
    throw new Error('batch_id must be a UUID.')
  }
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 20) {
    throw new Error('items must contain between 1 and 20 expenses.')
  }

  const seen = new Set<number>()
  const items = input.items.map((raw, itemIndex) => {
    const item = object(raw, `items[${itemIndex}]`)
    onlyKeys(item, ['index', 'amount', 'category', 'note', 'date'])
    if (!Number.isSafeInteger(item.index) || (item.index as number) < 0) {
      throw new Error(`items[${itemIndex}].index must be a non-negative integer.`)
    }
    const index = item.index as number
    if (seen.has(index)) throw new Error(`Duplicate email item index: ${index}`)
    seen.add(index)
    return {
      index,
      amount: amount(item.amount),
      category: string(item.category, 'category', { max: 80 })!,
      note: string(item.note, 'note', { optional: true, max: 200 }),
      date: date(item.date),
    }
  })

  return { name: 'commit_email_expenses', input: { batch_id: batchId, items } }
}

export function parseFinanceToolRequest(raw: unknown): FinanceToolRequest {
  const request = object(raw, 'request')
  onlyKeys(request, ['name', 'input'])
  const name = string(request.name, 'name', { max: 64 })!
  const input = object(request.input, 'input')

  switch (name) {
    case 'log_expense':
      return logExpense(input)
    case 'get_spending_summary': {
      onlyKeys(input, ['month'])
      return { name, input: { month: month(input.month) } }
    }
    case 'get_recent_expenses': {
      onlyKeys(input, ['limit'])
      const limit = input.limit === undefined ? undefined : input.limit
      if (limit !== undefined && (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 20)) {
        throw new Error('limit must be an integer from 1 to 20.')
      }
      return { name, input: { limit: limit as number | undefined } }
    }
    case 'preview_email_expenses': {
      onlyKeys(input, ['days'])
      const days = input.days === undefined ? undefined : input.days
      if (days !== undefined && (!Number.isSafeInteger(days) || (days as number) < 1 || (days as number) > 30)) {
        throw new Error('days must be an integer from 1 to 30.')
      }
      return { name, input: { days: days as number | undefined } }
    }
    case 'commit_email_expenses':
      return commitEmailExpenses(input)
    default:
      throw new Error(`Capability is not allowed: ${name}`)
  }
}

export function parseAgentCapabilityEnvelope(raw: unknown) {
  const envelope = object(raw, 'request')
  onlyKeys(envelope, ['name', 'input', 'context'])
  const context = object(envelope.context, 'context')
  onlyKeys(context, ['telegram_update_id', 'action_id'])
  if (
    !Number.isSafeInteger(context.telegram_update_id) ||
    (context.telegram_update_id as number) < 0
  ) {
    throw new Error('telegram_update_id must be a non-negative safe integer.')
  }
  const actionId = string(context.action_id, 'action_id', { max: 64 })!
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(actionId)) {
    throw new Error('action_id has an unsafe format.')
  }
  return {
    request: parseFinanceToolRequest({ name: envelope.name, input: envelope.input }),
    context: {
      telegramUpdateId: context.telegram_update_id as number,
      actionId,
    },
  }
}
