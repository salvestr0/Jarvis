import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { monthEndExclusive, monthStart } from '@/lib/date'
import type { Db } from '@/lib/queries/db'
import type {
  Account,
  Category,
  CategoryTotal,
  Direction,
  MonthSummary,
  TransactionRow,
} from '@/lib/types'

/**
 * All money data access lives here — never inside a page or component.
 *
 * Two reasons:
 *  1. One place to audit when checking what touches your financial data.
 *  2. The Telegram bot's tools (`log_transaction`, `get_month_summary`) call
 *     these exact functions. No logic gets duplicated or drifts.
 *
 * `import 'server-only'` makes the build fail if any of this is ever
 * imported into browser code by accident.
 *
 * On user scoping: called without a `db` argument (the web app), functions
 * take no userId — Row Level Security scopes every query to the logged-in
 * user inside Postgres itself. Called with a `db` (the bot's admin client,
 * which bypasses RLS), the ownership rules move into application code — see
 * the contract in @/lib/queries/db.
 */

// --- reads -----------------------------------------------------------------

export async function getAccounts(): Promise<Account[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('accounts')
    .select('id, name, kind, currency, archived')
    .eq('archived', false)
    .order('name')

  if (error) throw new Error(`Could not load accounts: ${error.message}`)
  return data ?? []
}

export async function getCategories(): Promise<Category[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, direction')
    .order('direction')
    .order('name')

  if (error) throw new Error(`Could not load categories: ${error.message}`)
  return data ?? []
}

type RawTransaction = {
  id: string
  occurred_on: string
  direction: Direction
  amount_cents: number
  currency: string
  category_id: string | null
  account_id: string | null
  note: string | null
  categories: { name: string } | null
  accounts: { name: string } | null
}

export async function getTransactionsForMonth(
  month: string,
  db?: Db
): Promise<TransactionRow[]> {
  const supabase = db?.client ?? (await createClient())

  let query = supabase
    .from('transactions')
    .select(
      'id, occurred_on, direction, amount_cents, currency, category_id, account_id, note, categories(name), accounts(name)'
    )
    .gte('occurred_on', monthStart(month))
    .lt('occurred_on', monthEndExclusive(month))

  // Admin client bypasses RLS, so ownership moves into the query itself.
  if (db) query = query.eq('user_id', db.userId)

  const { data, error } = await query
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Could not load transactions: ${error.message}`)

  // Supabase returns joined tables as nested objects; flatten for the UI.
  return ((data ?? []) as unknown as RawTransaction[]).map((t) => ({
    id: t.id,
    occurred_on: t.occurred_on,
    direction: t.direction,
    amount_cents: t.amount_cents,
    currency: t.currency,
    category_id: t.category_id,
    account_id: t.account_id,
    note: t.note,
    category_name: t.categories?.name ?? null,
    account_name: t.accounts?.name ?? null,
  }))
}

/**
 * Totals for a month.
 *
 * Deliberately derived from the same rows the table shows, rather than a
 * separate SQL aggregate. If the two ever disagreed you'd have a screen where
 * the summary contradicts the list, which is the worst kind of bug in
 * financial software — it looks fine and it's wrong.
 */
export function summariseMonth(rows: TransactionRow[]): MonthSummary {
  let incomeCents = 0
  let expenseCents = 0

  for (const row of rows) {
    if (row.direction === 'income') incomeCents += row.amount_cents
    else expenseCents += row.amount_cents
  }

  return {
    incomeCents,
    expenseCents,
    netCents: incomeCents - expenseCents,
    count: rows.length,
  }
}

export function totalsByCategory(
  rows: TransactionRow[],
  direction: Direction
): CategoryTotal[] {
  const totals = new Map<string, CategoryTotal>()

  for (const row of rows) {
    if (row.direction !== direction) continue

    const key = row.category_id ?? 'uncategorised'
    const existing = totals.get(key)

    if (existing) {
      existing.totalCents += row.amount_cents
    } else {
      totals.set(key, {
        categoryId: row.category_id,
        name: row.category_name ?? 'Uncategorised',
        direction,
        totalCents: row.amount_cents,
      })
    }
  }

  return [...totals.values()].sort((a, b) => b.totalCents - a.totalCents)
}

// --- writes ----------------------------------------------------------------

/**
 * Resolve a typed category name to an id, creating it if it doesn't exist.
 *
 * Looks up first rather than relying on the unique constraint error: typing
 * "Food" when Food already exists should quietly reuse it, not complain.
 * The match mirrors the DB's unique (user_id, name, direction) — exact,
 * case-sensitive.
 */
export async function findOrCreateCategory(
  name: string,
  direction: Direction,
  db?: Db
): Promise<string> {
  const supabase = db?.client ?? (await createClient())

  let userId = db?.userId
  if (!userId) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error('Not signed in.')
    userId = user.id
  }

  let lookup = supabase
    .from('categories')
    .select('id')
    .eq('name', name)
    .eq('direction', direction)
  if (db) lookup = lookup.eq('user_id', db.userId)

  const { data: existing, error: lookupError } = await lookup.maybeSingle()

  if (lookupError)
    throw new Error(`Could not look up category: ${lookupError.message}`)
  if (existing) return existing.id

  const { data, error } = await supabase
    .from('categories')
    .insert({ user_id: userId, name, direction })
    .select('id')
    .single()

  if (error || !data)
    throw new Error(`Could not create category: ${error?.message ?? 'unknown'}`)
  return data.id
}

export type TransactionInput = {
  occurred_on: string
  direction: Direction
  amount_cents: number
  category_id: string | null
  account_id: string | null
  note: string | null
}

export async function createTransaction(
  input: TransactionInput,
  db?: Db
): Promise<void> {
  const supabase = db?.client ?? (await createClient())

  let userId = db?.userId
  if (!userId) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error('Not signed in.')
    userId = user.id
  }

  // user_id must be set explicitly: the RLS `with check` rule rejects any row
  // whose user_id isn't the logged-in user, so this is both required and safe.
  const { error } = await supabase
    .from('transactions')
    .insert({ ...input, user_id: userId })

  if (error) throw new Error(`Could not save: ${error.message}`)
}

export async function updateTransaction(
  id: string,
  input: TransactionInput
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('transactions').update(input).eq('id', id)

  if (error) throw new Error(`Could not update: ${error.message}`)
}

export async function deleteTransaction(id: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('transactions').delete().eq('id', id)

  if (error) throw new Error(`Could not delete: ${error.message}`)
}
