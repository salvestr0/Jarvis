'use server'

import { revalidatePath } from 'next/cache'

import { parseMoney } from '@/lib/money'
import { isValidMonth, todayISO } from '@/lib/date'
import {
  createTransaction,
  deleteTransaction,
  findOrCreateCategory,
  updateTransaction,
  type TransactionInput,
} from '@/lib/queries/money'
import type { Direction } from '@/lib/types'

// Imported as a type, not re-exported: a 'use server' file may only export
// async functions, so the constant and the type live in ./form-state.
import type { FormState } from './form-state'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Validates the submitted form.
 *
 * This runs on the server. Client-side checks (`required`, `type="number"`)
 * are a convenience for you, not a security control — anyone can bypass them
 * by posting directly. The server is the only place validation actually counts.
 */
function readForm(formData: FormData):
  | { ok: true; value: TransactionInput; newCategoryName: string | null }
  | { ok: false; error: string } {
  const direction = String(formData.get('direction') ?? '') as Direction
  if (direction !== 'income' && direction !== 'expense') {
    return { ok: false, error: 'Pick income or expense.' }
  }

  const amount = parseMoney(String(formData.get('amount') ?? ''))
  if (!amount.ok) return { ok: false, error: amount.error }

  const occurredOn = String(formData.get('occurred_on') ?? '').trim()
  if (!ISO_DATE.test(occurredOn)) {
    return { ok: false, error: 'Pick a valid date.' }
  }
  if (occurredOn > todayISO()) {
    return { ok: false, error: 'That date is in the future.' }
  }

  const rawCategory = String(formData.get('category_id') ?? '').trim()
  const rawAccount = String(formData.get('account_id') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim()

  if (note.length > 280) {
    return { ok: false, error: 'Note is too long (max 280 characters).' }
  }

  // 'new' means the user typed a name instead of picking an existing category.
  // The id gets resolved in the action, after validation — creating a category
  // is a write, and nothing should be written until the whole form is valid.
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
      occurred_on: occurredOn,
      direction,
      amount_cents: amount.cents,
      category_id: hasCategory ? rawCategory : null,
      account_id: rawAccount === '' || rawAccount === 'none' ? null : rawAccount,
      note: note === '' ? null : note,
    },
  }
}

function refresh(formData: FormData) {
  const month = String(formData.get('month') ?? '')
  revalidatePath('/money')
  revalidatePath('/')
  return isValidMonth(month) ? month : null
}

export async function saveTransaction(
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

    if (id) await updateTransaction(id, value)
    else await createTransaction(value)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Something went wrong.',
      ok: false,
    }
  }

  refresh(formData)
  return { error: null, ok: true }
}

export async function removeTransaction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'Missing transaction.', ok: false }

  try {
    await deleteTransaction(id)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not delete.',
      ok: false,
    }
  }

  refresh(formData)
  return { error: null, ok: true }
}
