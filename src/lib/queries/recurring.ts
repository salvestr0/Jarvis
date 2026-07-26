import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { advanceByCadence, todayISO } from '@/lib/date'
import type { Cadence, Direction, RecurringRow } from '@/lib/types'

/**
 * Data access for recurring payments (subscriptions, insurance, fixed costs).
 * Same rules as money.ts: all access lives here, RLS scopes rows to the
 * logged-in user, and `server-only` keeps it out of browser bundles.
 */

// --- reads -----------------------------------------------------------------

type RawRecurring = {
  id: string
  name: string
  direction: Direction
  amount_cents: number
  currency: string
  cadence: Cadence
  next_due: string | null
  category_id: string | null
  active: boolean
  categories: { name: string } | null
}

export async function getRecurring(): Promise<RecurringRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('recurring')
    .select(
      'id, name, direction, amount_cents, currency, cadence, next_due, category_id, active, categories(name)'
    )
    .eq('active', true)
    .order('next_due', { ascending: true })
    .order('name')

  if (error) throw new Error(`Could not load recurring payments: ${error.message}`)

  return ((data ?? []) as unknown as RawRecurring[]).map((r) => ({
    id: r.id,
    name: r.name,
    direction: r.direction,
    amount_cents: r.amount_cents,
    currency: r.currency,
    cadence: r.cadence,
    next_due: r.next_due,
    category_id: r.category_id,
    active: r.active,
    category_name: r.categories?.name ?? null,
  }))
}

// --- writes ----------------------------------------------------------------

export type RecurringInput = {
  name: string
  direction: Direction
  amount_cents: number
  cadence: Cadence
  next_due: string
  category_id: string | null
}

export async function createRecurring(input: RecurringInput): Promise<void> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Not signed in.')

  const { error } = await supabase
    .from('recurring')
    .insert({ ...input, user_id: user.id })

  if (error) throw new Error(`Could not save: ${error.message}`)
}

export async function updateRecurring(
  id: string,
  input: RecurringInput
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('recurring').update(input).eq('id', id)

  if (error) throw new Error(`Could not update: ${error.message}`)
}

export async function deleteRecurring(id: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('recurring').delete().eq('id', id)

  if (error) throw new Error(`Could not delete: ${error.message}`)
}

/**
 * Record one billing period as a real transaction, then advance next_due.
 *
 * The transaction is dated on the due date when it's already passed (that's
 * when the bill actually hit), or today when logging ahead of time. Advancing
 * moves one period at a time, so if you're two months behind on logging, the
 * item stays marked due until you've caught up — no month silently skipped.
 *
 * Two writes, not one atomic operation: if the insert succeeds but the
 * advance fails, the error surfaces and next_due is still on the old date, so
 * the worst case is seeing the item as due again — visible, not silent.
 */
export async function logRecurringPayment(id: string): Promise<void> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Not signed in.')

  const { data: item, error: loadError } = await supabase
    .from('recurring')
    .select('name, direction, amount_cents, currency, cadence, next_due, category_id')
    .eq('id', id)
    .single()

  if (loadError || !item)
    throw new Error(`Could not load that recurring payment.`)

  const today = todayISO()
  const due = (item.next_due as string | null) ?? today
  const occurredOn = due <= today ? due : today

  const { error: insertError } = await supabase.from('transactions').insert({
    user_id: user.id,
    occurred_on: occurredOn,
    direction: item.direction,
    amount_cents: item.amount_cents,
    currency: item.currency,
    category_id: item.category_id,
    account_id: null,
    note: item.name,
  })

  if (insertError) throw new Error(`Could not log payment: ${insertError.message}`)

  const { error: advanceError } = await supabase
    .from('recurring')
    .update({ next_due: advanceByCadence(due, item.cadence as Cadence) })
    .eq('id', id)

  if (advanceError)
    throw new Error(
      `Payment logged, but the next due date failed to update: ${advanceError.message}`
    )
}
