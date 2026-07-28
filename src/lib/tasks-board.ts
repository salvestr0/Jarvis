/**
 * Pure board logic for the tasks kanban — importable from client components
 * and tests alike, so no 'server-only' here. Exported constants also live
 * here because 'use server' files may only export async functions.
 */

export const UNCATEGORISED_KEY = '__uncategorised__'
export const COLUMN_ID_PREFIX = 'col:'

type BoardTask = {
  id: string
  category_id: string | null
  position: number
  created_at: string
}

export type BoardColumnData<T extends BoardTask> = {
  /** Stable droppable key: category id, or UNCATEGORISED_KEY. */
  key: string
  categoryId: string | null
  name: string
  tasks: T[]
}

/**
 * Manual order within a column: position asc, so 0 ("created, never placed")
 * sorts to the top. Among never-placed tasks the newest wins, which puts a
 * just-added task where you can see it.
 */
export function compareBoardTasks(a: BoardTask, b: BoardTask): number {
  if (a.position !== b.position) return a.position - b.position
  return b.created_at.localeCompare(a.created_at)
}

/**
 * Uncategorised always comes first — it's the inbox for tasks created
 * without a category (e.g. from Telegram). A task pointing at a category
 * that no longer exists falls back there too.
 */
export function buildBoard<T extends BoardTask>(
  categories: ReadonlyArray<{ id: string; name: string }>,
  openTasks: ReadonlyArray<T>
): BoardColumnData<T>[] {
  const columns: BoardColumnData<T>[] = [
    { key: UNCATEGORISED_KEY, categoryId: null, name: 'Uncategorised', tasks: [] },
    ...categories.map((c) => ({
      key: c.id,
      categoryId: c.id,
      name: c.name,
      tasks: [] as T[],
    })),
  ]
  const byCategory = new Map(columns.map((c) => [c.categoryId, c]))

  for (const task of openTasks) {
    const column = byCategory.get(task.category_id) ?? columns[0]
    column.tasks.push(task)
  }
  for (const column of columns) column.tasks.sort(compareBoardTasks)
  return columns
}

/**
 * Fingerprint of everything the board renders from server props. When it
 * changes (and no drag/save is in flight) the client adopts server truth.
 */
export function boardSignature(
  categories: ReadonlyArray<{ id: string; name: string }>,
  openTasks: ReadonlyArray<BoardTask>
): string {
  const cats = categories.map((c) => `${c.id}=${c.name}`).join(',')
  const tasks = [...openTasks]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((t) => `${t.id}:${t.category_id ?? ''}:${t.position}`)
    .join(',')
  return `${cats}|${tasks}`
}

/** The key of the column currently holding the task, or null if absent. */
export function findColumnKey<T extends BoardTask>(
  board: ReadonlyArray<BoardColumnData<T>>,
  taskId: string
): string | null {
  for (const column of board) {
    if (column.tasks.some((t) => t.id === taskId)) return column.key
  }
  return null
}

/**
 * Move a task to `toKey` at `toIndex`, returning a new board. Only the
 * source and destination columns are new arrays; untouched columns keep
 * their identity. The index is clamped, so "append" is Infinity-safe.
 */
export function applyMove<T extends BoardTask>(
  board: ReadonlyArray<BoardColumnData<T>>,
  taskId: string,
  toKey: string,
  toIndex: number
): BoardColumnData<T>[] {
  const fromKey = findColumnKey(board, taskId)
  if (fromKey === null) return [...board]
  const task = board
    .find((c) => c.key === fromKey)!
    .tasks.find((t) => t.id === taskId)!

  return board.map((column) => {
    const withoutTask =
      column.key === fromKey
        ? column.tasks.filter((t) => t.id !== taskId)
        : column.tasks
    if (column.key !== toKey) {
      return column.key === fromKey
        ? { ...column, tasks: withoutTask }
        : column
    }
    const index = Math.max(0, Math.min(toIndex, withoutTask.length))
    const tasks = [...withoutTask]
    tasks.splice(index, 0, task)
    return { ...column, tasks }
  })
}
