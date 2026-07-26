'use server'

import { revalidatePath } from 'next/cache'

import type { FormState } from '@/lib/form-state'
import {
  createGoal,
  deleteGoal,
  setGoalStatus,
  updateGoal,
  type GoalHorizon,
  type GoalInput,
  type GoalStatus,
} from '@/lib/queries/goals'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const HORIZONS: GoalHorizon[] = ['short', 'long']
const STATUSES: GoalStatus[] = ['active', 'achieved', 'dropped']

function readGoal(
  formData: FormData
): { ok: true; value: GoalInput } | { ok: false; error: string } {
  const title = String(formData.get('title') ?? '').trim()
  if (!title) return { ok: false, error: 'Give the goal a title.' }
  if (title.length > 120) {
    return { ok: false, error: 'Title must be under 120 characters.' }
  }

  const horizon = String(formData.get('horizon') ?? '') as GoalHorizon
  if (!HORIZONS.includes(horizon)) return { ok: false, error: 'Pick a horizon.' }

  const status = String(formData.get('status') ?? '') as GoalStatus
  if (!STATUSES.includes(status)) return { ok: false, error: 'Pick a status.' }

  const rawTarget = String(formData.get('target_date') ?? '').trim()
  const targetDate = rawTarget === '' ? null : rawTarget
  if (targetDate !== null && !ISO_DATE.test(targetDate)) {
    return { ok: false, error: 'Target date is not valid.' }
  }

  const note = String(formData.get('note') ?? '').trim()
  if (note.length > 1000) {
    return { ok: false, error: 'Note is too long (max 1000 characters).' }
  }

  return {
    ok: true,
    value: {
      title,
      horizon,
      status,
      target_date: targetDate,
      note: note === '' ? null : note,
    },
  }
}

export async function saveGoal(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = readGoal(formData)
  if (!parsed.ok) return { error: parsed.error, ok: false }

  const id = String(formData.get('id') ?? '').trim()

  try {
    if (id) await updateGoal(id, parsed.value)
    else await createGoal(parsed.value)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Something went wrong.',
      ok: false,
    }
  }

  revalidatePath('/goals')
  return { error: null, ok: true }
}

export async function markGoalStatus(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'Missing goal.', ok: false }

  const status = String(formData.get('status') ?? '') as GoalStatus
  if (!STATUSES.includes(status)) return { error: 'Pick a status.', ok: false }

  try {
    await setGoalStatus(id, status)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not update.',
      ok: false,
    }
  }

  revalidatePath('/goals')
  return { error: null, ok: true }
}

export async function removeGoal(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'Missing goal.', ok: false }

  try {
    await deleteGoal(id)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not delete.',
      ok: false,
    }
  }

  revalidatePath('/goals')
  // Tasks show which goal they belong to; a deleted goal unlinks them.
  revalidatePath('/tasks')
  return { error: null, ok: true }
}
