'use server'

import { revalidatePath } from 'next/cache'

import { parseMoney } from '@/lib/money'
import { findOrCreateCategory } from '@/lib/queries/money'
import {
  createRecurring,
  deleteRecurring,
  logRecurringPayment,
  updateRecurring,
  type RecurringInput,
} from '@/lib/queries/recurring'
import type { Cadence, Direction } from '@/lib/types'

import type { FormState } from './form-state'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function readForm(formData: FormData):
  | { ok: true; value: RecurringInput; newCategoryName: string | null }
  | { ok: false; error: string } {
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { ok: false, error: 'Give it a name.' }
  if (name.length > 80) {
    return { ok: false, error: 'Name is too long (max 80 characters).' }
  }

  const direction = String(formData.get('direction') ?? '') as Direction
  if (direction !== 'income' && direction !== 'expense') {
    return { ok: false, error: 'Pick income or expense.' }
  }

  const amount = parseMoney(String(formData.get('amount') ?? ''))
  if (!amount.ok) return { ok: false, error: amount.error }

  const cadence = String(formData.get('cadence') ?? '') as Cadence
  if (cadence !== 'weekly' && cadence !== 'monthly' && cadence !== 'yearly') {
    return { ok: false, error: 'Pick how often it repeats.' }
  }

  // Unlike a transaction, the next due date is allowed to be in the future —
  // that's the whole point of tracking insurance due next year.
  const nextDue = String(formData.get('next_due') ?? '').trim()
  if (!ISO_DATE.test(nextDue)) {
    return { ok: false, error: 'Pick a valid next due date.' }
  }

  const rawCategory = String(formData.get('category_id') ?? '').trim()

  // 'new' means the user typed a name instead of picking an existing category;
  // resolved to an id in the action once the whole form has validated.
  let newCategoryName: string | null = null
  if (rawCategory === 'new') {
    newCategoryName = String(formData.get('new_category_name') ?? '').trim()
    if (!newCategoryName) {
      return { ok: false, error: 'Give the new category a name.' }
    }
    if (newCategoryName.length > 40) {
      return { ok: false, error: 'Category name is too long (max 40 characters).' }
    }
  }

  const hasCategory =
    rawCategory !== '' && rawCategory !== 'none' && rawCategory !== 'new'

  return {
    ok: true,
    newCategoryName,
    value: {
      name,
      direction,
      amount_cents: amount.cents,
      cadence,
      next_due: nextDue,
      category_id: hasCategory ? rawCategory : null,
    },
  }
}

function refresh() {
  revalidatePath('/money')
  revalidatePath('/')
}

export async function saveRecurring(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = readForm(formData)
  if (!parsed.ok) return { error: parsed.error, ok: false }

  const id = String(formData.get('id') ?? '').trim()

  try {
    const value = parsed.value
    if (parsed.newCategoryName) {
      value.category_id = await findOrCreateCategory(
        parsed.newCategoryName,
        value.direction
      )
    }

    if (id) await updateRecurring(id, value)
    else await createRecurring(value)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Something went wrong.',
      ok: false,
    }
  }

  refresh()
  return { error: null, ok: true }
}

export async function removeRecurring(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'Missing recurring payment.', ok: false }

  try {
    await deleteRecurring(id)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not delete.',
      ok: false,
    }
  }

  refresh()
  return { error: null, ok: true }
}

export async function logRecurring(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'Missing recurring payment.', ok: false }

  try {
    await logRecurringPayment(id)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not log payment.',
      ok: false,
    }
  }

  refresh()
  return { error: null, ok: true }
}
