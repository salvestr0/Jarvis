export type DurableTransactionSource = 'telegram' | 'gmail'

export type DurableTransactionIdentity = {
  source: DurableTransactionSource
  sourceKey: string
}

export type IdempotentTransactionInput = {
  occurred_on: string
  direction: 'income' | 'expense'
  amount_cents: number
  currency: string
  category_id: string | null
  account_id: string | null
  note: string | null
}

type TransactionResult = {
  data: { id: string } | null
  error: { message: string } | null
}

type TransactionClient = {
  from(table: 'transactions'): {
    upsert(
      row: Record<string, unknown>,
      options: { onConflict: string; ignoreDuplicates: boolean }
    ): {
      select(columns: 'id'): {
        maybeSingle(): Promise<TransactionResult>
      }
    }
    select(columns: 'id'): {
      eq(column: string, value: unknown): ReturnType<
        TransactionClient['from']
      >['select'] extends (...args: never[]) => infer Result ? Result : never
      single(): Promise<TransactionResult>
    }
  }
}

/**
 * Insert a transaction exactly once for a stable external action identity.
 * A duplicate returns the original row rather than treating the retry as an
 * error, so callers can safely retry after a lost response.
 */
export async function createIdempotentTransaction(
  client: unknown,
  userId: string,
  input: IdempotentTransactionInput,
  identity: DurableTransactionIdentity
): Promise<{ id: string; created: boolean }> {
  const sourceKey = identity.sourceKey.trim()
  if (!sourceKey) throw new Error('A durable source key is required.')

  const row = {
    ...input,
    user_id: userId,
    source: identity.source,
    source_key: sourceKey,
  }
  const db = client as TransactionClient
  const { data, error } = await db
    .from('transactions')
    .upsert(row, {
      onConflict: 'user_id,source,source_key',
      ignoreDuplicates: true,
    })
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`Could not save: ${error.message}`)
  if (data) return { id: data.id, created: true }

  const existing = await db
    .from('transactions')
    .select('id')
    .eq('user_id', userId)
    .eq('source', identity.source)
    .eq('source_key', sourceKey)
    .single()

  if (existing.error || !existing.data) {
    throw new Error(
      `Could not recover transaction after duplicate insert: ${existing.error?.message ?? 'unknown'}`
    )
  }
  return { id: existing.data.id, created: false }
}
