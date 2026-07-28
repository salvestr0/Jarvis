import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applyMove,
  boardSignature,
  buildBoard,
  compareBoardTasks,
  findColumnKey,
  UNCATEGORISED_KEY,
} from './tasks-board.ts'

type T = {
  id: string
  category_id: string | null
  position: number
  created_at: string
}

function task(overrides: Partial<T>): T {
  return {
    id: 'id',
    category_id: null,
    position: 0,
    created_at: '2026-07-01T00:00:00Z',
    ...overrides,
  }
}

const cats = [
  { id: 'work', name: 'Work' },
  { id: 'tcg', name: 'TCG' },
]

test('uncategorised is first and empty categories still get a column', () => {
  const board = buildBoard(cats, [])
  assert.deepEqual(
    board.map((c) => c.key),
    [UNCATEGORISED_KEY, 'work', 'tcg']
  )
  assert.equal(board[0].categoryId, null)
  assert.ok(board.every((c) => c.tasks.length === 0))
})

test('tasks land in their column sorted by position', () => {
  const board = buildBoard(cats, [
    task({ id: 'b', category_id: 'work', position: 2 }),
    task({ id: 'a', category_id: 'work', position: 1 }),
    task({ id: 'u', position: 1 }),
  ])
  assert.deepEqual(board[1].tasks.map((t) => t.id), ['a', 'b'])
  assert.deepEqual(board[0].tasks.map((t) => t.id), ['u'])
})

test('a never-placed task (position 0) sorts to the top, newest first', () => {
  const placed = task({ id: 'old', position: 1 })
  const fresh = task({ id: 'new', created_at: '2026-07-28T00:00:00Z' })
  const fresher = task({ id: 'newer', created_at: '2026-07-28T12:00:00Z' })
  const sorted = [placed, fresh, fresher].sort(compareBoardTasks)
  assert.deepEqual(sorted.map((t) => t.id), ['newer', 'new', 'old'])
})

test('an orphaned category_id falls back to Uncategorised', () => {
  const board = buildBoard(cats, [
    task({ id: 'ghost', category_id: 'deleted-category', position: 3 }),
  ])
  assert.deepEqual(board[0].tasks.map((t) => t.id), ['ghost'])
})

test('applyMove across columns keeps both sides contiguous', () => {
  const board = buildBoard(cats, [
    task({ id: 'a', category_id: 'work', position: 1 }),
    task({ id: 'b', category_id: 'work', position: 2 }),
    task({ id: 'c', category_id: 'tcg', position: 1 }),
  ])
  const moved = applyMove(board, 'a', 'tcg', 1)
  assert.deepEqual(moved[1].tasks.map((t) => t.id), ['b'])
  assert.deepEqual(moved[2].tasks.map((t) => t.id), ['c', 'a'])
  // Untouched columns keep their identity, so React can skip re-rendering.
  assert.equal(moved[0], board[0])
})

test('applyMove clamps: index 0, end of column, and beyond', () => {
  const board = buildBoard(cats, [
    task({ id: 'a', category_id: 'work', position: 1 }),
    task({ id: 'b', category_id: 'work', position: 2 }),
    task({ id: 'c', category_id: 'work', position: 3 }),
  ])
  assert.deepEqual(
    applyMove(board, 'c', 'work', 0)[1].tasks.map((t) => t.id),
    ['c', 'a', 'b']
  )
  assert.deepEqual(
    applyMove(board, 'a', 'work', 99)[1].tasks.map((t) => t.id),
    ['b', 'c', 'a']
  )
  assert.deepEqual(
    applyMove(board, 'a', UNCATEGORISED_KEY, 99)[0].tasks.map((t) => t.id),
    ['a']
  )
})

test('applyMove with an unknown task is a no-op copy', () => {
  const board = buildBoard(cats, [task({ id: 'a', category_id: 'work' })])
  const moved = applyMove(board, 'nope', 'tcg', 0)
  assert.deepEqual(moved.map((c) => c.tasks.length), [0, 1, 0])
})

test('findColumnKey resolves the holding column', () => {
  const board = buildBoard(cats, [task({ id: 'a', category_id: 'tcg' })])
  assert.equal(findColumnKey(board, 'a'), 'tcg')
  assert.equal(findColumnKey(board, 'missing'), null)
})

test('boardSignature changes on moves and renames, stays put otherwise', () => {
  const tasks = [
    task({ id: 'a', category_id: 'work', position: 1 }),
    task({ id: 'b', position: 1 }),
  ]
  const before = boardSignature(cats, tasks)
  assert.equal(boardSignature(cats, [...tasks].reverse()), before)

  const moved = [{ ...tasks[0], position: 2 }, tasks[1]]
  assert.notEqual(boardSignature(cats, moved), before)

  const renamed = [{ id: 'work', name: 'Werk' }, cats[1]]
  assert.notEqual(boardSignature(renamed, tasks), before)
})
