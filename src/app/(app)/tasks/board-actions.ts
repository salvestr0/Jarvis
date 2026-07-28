'use server'

import { revalidatePath } from 'next/cache'

import type { FormState } from '@/lib/form-state'
import { reorderTaskCategories } from '@/lib/queries/task-categories'
import { reorderTasks, type ColumnOrder } from '@/lib/queries/tasks'

export type { ColumnOrder } from '@/lib/queries/tasks'

/** A card drop: the affected column(s), each in its new top-to-bottom order. */
export type BoardMove = {
  taskId: string
  to: ColumnOrder
  from?: ColumnOrder
}

/**
 * Persist a card drop. Called directly (not via a form) from the board's
 * drag-end handler. revalidatePath means the response already carries the
 * re-rendered page — the client must not router.refresh() on top of it.
 */
export async function moveTask(move: BoardMove): Promise<FormState> {
  if (!move.to.orderedIds.includes(move.taskId)) {
    return { error: 'That move no longer makes sense. Reload.', ok: false }
  }

  const columns = move.from ? [move.to, move.from] : [move.to]
  try {
    await reorderTasks(columns)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not move.',
      ok: false,
    }
  }

  revalidatePath('/tasks')
  return { error: null, ok: true }
}

/** Persist "Move left" / "Move right" on a column header. */
export async function reorderColumns(
  orderedIds: string[]
): Promise<FormState> {
  if (orderedIds.length === 0) return { error: null, ok: true }

  try {
    await reorderTaskCategories(orderedIds)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not reorder.',
      ok: false,
    }
  }

  revalidatePath('/tasks')
  return { error: null, ok: true }
}
