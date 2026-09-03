import type { FinanceToolRequest } from './finance-capability-schema'
import type { DurableTransactionIdentity } from '@/lib/queries/idempotent-transaction'

export type FinanceCapabilityContext = {
  telegramUpdateId: number
  actionId: string
}

export type FinanceCapabilityAdapter = {
  executeTool(
    name: 'log_transaction' | 'get_month_summary',
    input: Record<string, unknown>,
    context?: { transactionIdentity: DurableTransactionIdentity }
  ): Promise<unknown>
  getRecentExpenses(limit: number): Promise<unknown>
  previewEmailExpenses(days: number, telegramUpdateId: number): Promise<unknown>
  commitEmailExpenses(
    batchId: string,
    items: Extract<FinanceToolRequest, { name: 'commit_email_expenses' }>['input']['items'],
    telegramUpdateId: number
  ): Promise<unknown>
}

function assertContext(context: FinanceCapabilityContext) {
  if (!Number.isSafeInteger(context.telegramUpdateId) || context.telegramUpdateId < 0) {
    throw new Error('Telegram update id must be a non-negative safe integer.')
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(context.actionId)) {
    throw new Error('Action id has an unsafe format.')
  }
}

export async function executeFinanceCapability(
  request: FinanceToolRequest,
  context: FinanceCapabilityContext,
  adapter: FinanceCapabilityAdapter
): Promise<unknown> {
  assertContext(context)

  switch (request.name) {
    case 'log_expense':
      return adapter.executeTool(
        'log_transaction',
        {
          direction: 'expense',
          amount: request.input.amount,
          category: request.input.category,
          note: request.input.note,
          date: request.input.date,
        },
        {
          transactionIdentity: {
            source: 'telegram',
            sourceKey: `${context.telegramUpdateId}:${context.actionId}`,
          },
        }
      )
    case 'get_spending_summary':
      return adapter.executeTool(
        'get_month_summary',
        { month: request.input.month },
        undefined
      )
    case 'get_recent_expenses':
      return adapter.getRecentExpenses(request.input.limit ?? 10)
    case 'preview_email_expenses':
      return adapter.previewEmailExpenses(request.input.days ?? 7, context.telegramUpdateId)
    case 'commit_email_expenses':
      return adapter.commitEmailExpenses(
        request.input.batch_id,
        request.input.items,
        context.telegramUpdateId
      )
  }
}
