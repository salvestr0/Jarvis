'use server'

import { revalidatePath } from 'next/cache'

import type { FormState } from '@/lib/form-state'
import {
  createTask,
  deleteTask,
  setTaskDone,
  updateTask,
  type TaskInput,
  type TaskPriority,
} from '@/lib/queries/tasks'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high']

function readTask(
  formData: FormData
): { ok: true; value: TaskInput } | { ok: false; error: string } {
  const title = String(formData.get('title') ?? '').trim()
  if (!title) return { ok: false, error: 'Give the task a title.' }
  if (title.length > 200) {
    return { ok: false, error: 'Title must be under 200 characters.' }
  }

  const priority = String(formData.get('priority') ?? '') as TaskPriority
  if (!PRIORITIES.includes(priority)) {
    return { ok: false, error: 'Pick a priority.' }
  }

  const rawDue = String(formData.get('due_on') ?? '').trim()
  const dueOn = rawDue === '' ? null : rawDue
  if (dueOn !== null && !ISO_DATE.test(dueOn)) {
    return { ok: false, error: 'Due date is not valid.' }
  }

  const goalId = String(formData.get('goal_id') ?? '').trim()

  const note = String(formData.get('note') ?? '').trim()
  if (note.length > 1000) {
    return { ok: false, error: 'Note is too long (max 1000 characters).' }
  }

  return {
    ok: true,
    value: {
      title,
      priority,
      due_on: dueOn,
      goal_id: goalId === '' ? null : goalId,
      note: note === '' ? null : note,
    },
  }
}

export async function saveTask(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = readTask(formData)
  if (!parsed.ok) return { error: parsed.error, ok: false }

  const id = String(formData.get('id') ?? '').trim()

  try {
    if (id) await updateTask(id, parsed.value)
    else await createTask(parsed.value)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Something went wrong.',
      ok: false,
    }
  }

  revalidatePath('/tasks')
  return { error: null, ok: true }
}

export async function toggleTask(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'Missing task.', ok: false }

  const done = String(formData.get('done') ?? '') === 'true'

  try {
    await setTaskDone(id, done)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not update.',
      ok: false,
    }
  }

  revalidatePath('/tasks')
  return { error: null, ok: true }
}

export async function removeTask(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'Missing task.', ok: false }

  try {
    await deleteTask(id)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not delete.',
      ok: false,
    }
  }

  revalidatePath('/tasks')
  return { error: null, ok: true }
}
