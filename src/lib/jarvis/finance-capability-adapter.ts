import 'server-only'

import type { Db } from '@/lib/queries/db'
import { executeTool } from '@/lib/jarvis/execute'
import { getMessage, searchMessages } from '@/lib/google/gmail'
import {
  commitEmailExpenseBatch,
  parseAllowedFinanceSenders,
  previewEmailExpenseBatch,
  type EmailBatchItem,
  type EmailExpenseBatch,
  type EmailExpenseWorkflowDeps,
} from '@/lib/jarvis/email-expense-workflow'
import type { FinanceCapabilityAdapter } from '@/lib/jarvis/finance-capabilities'

function parseToolResult(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw new Error('Jarvis capability returned malformed JSON.')
  }
}

export function createFinanceCapabilityAdapter(db: Db): FinanceCapabilityAdapter {
  const batches: EmailExpenseWorkflowDeps['batches'] = {
    async create(input) {
      const { data, error } = await db.client
        .from('email_expense_batches')
        .insert({
          user_id: input.userId,
          previewed_update_id: input.previewedUpdateId,
          items: input.items,
        })
        .select('id')
        .single()
      if (error || !data) {
        throw new Error(`Could not save email expense preview: ${error?.message ?? 'unknown'}`)
      }
      return data.id as string
    },
    async load(batchId, userId) {
      const { data, error } = await db.client
        .from('email_expense_batches')
        .select('id, previewed_update_id, expires_at, committed_at, items')
        .eq('id', batchId)
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw new Error(`Could not load email expense preview: ${error.message}`)
      if (!data) return null
      return {
        id: data.id as string,
        previewedUpdateId: data.previewed_update_id as number,
        expiresAt: data.expires_at as string,
        committedAt: (data.committed_at as string | null) ?? null,
        items: data.items as EmailBatchItem[],
      } satisfies EmailExpenseBatch
    },
    async markCommitted(batchId, userId) {
      const { data, error } = await db.client
        .from('email_expense_batches')
        .update({ committed_at: new Date().toISOString() })
        .eq('id', batchId)
        .eq('user_id', userId)
        .is('committed_at', null)
        .select('id')
      if (error) throw new Error(`Could not finish email expense preview: ${error.message}`)
      return (data?.length ?? 0) === 1
    },
  }

  const workflowDeps: EmailExpenseWorkflowDeps = {
    now: () => new Date(),
    email: {
      search: async (query, maxResults) => searchMessages(query, maxResults),
      get: async (id) => ({ id, ...(await getMessage(id)) }),
    },
    batches,
    async writeTransaction(input) {
      const result = parseToolResult(
        await executeTool(
          'log_transaction',
          {
            direction: 'expense',
            amount: input.amount,
            category: input.category,
            date: input.date,
            note: input.note,
          },
          db,
          { transactionIdentity: input.identity }
        )
      ) as { transaction_id?: unknown; created?: unknown }
      if (typeof result.transaction_id !== 'string' || typeof result.created !== 'boolean') {
        throw new Error('Transaction capability returned an invalid receipt.')
      }
      return { id: result.transaction_id, created: result.created }
    },
  }

  return {
    async executeTool(name, input, context) {
      return parseToolResult(await executeTool(name, input, db, context))
    },
    async getRecentExpenses(limit) {
      const { data, error } = await db.client
        .from('transactions')
        .select('id, occurred_on, amount_cents, currency, note, categories(name)')
        .eq('user_id', db.userId)
        .eq('direction', 'expense')
        .order('occurred_on', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw new Error(`Could not load recent expenses: ${error.message}`)
      return (data ?? []).map((row) => ({
        id: row.id,
        date: row.occurred_on,
        amount: `${row.currency} ${(row.amount_cents / 100).toFixed(2)}`,
        category:
          row.categories && !Array.isArray(row.categories)
            ? (row.categories as { name: string }).name
            : 'Uncategorised',
        note: row.note,
      }))
    },
    async previewEmailExpenses(days, telegramUpdateId) {
      return previewEmailExpenseBatch(
        workflowDeps,
        db.userId,
        parseAllowedFinanceSenders(process.env.FINANCE_EMAIL_SENDERS),
        days,
        telegramUpdateId
      )
    },
    async commitEmailExpenses(batchId, items, telegramUpdateId) {
      return commitEmailExpenseBatch(
        workflowDeps,
        db.userId,
        batchId,
        items,
        telegramUpdateId
      )
    },
  }
}
