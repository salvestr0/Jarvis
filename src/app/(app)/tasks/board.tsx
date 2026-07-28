'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { toast } from 'sonner'
import { PlusIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { TaskRow } from '@/lib/queries/tasks'
import {
  COLUMN_ID_PREFIX,
  applyMove,
  boardSignature,
  buildBoard,
  findColumnKey,
  type BoardColumnData,
} from '@/lib/tasks-board'

import { moveTask, reorderColumns, type BoardMove } from './board-actions'
import { ColumnMenu } from './column-menu'
import { CategoryDialog, TaskDialog } from './dialogs'
import {
  SortableTaskCard,
  TaskCardBody,
  type CategoryOption,
  type GoalOption,
} from './task-card'

type Column = BoardColumnData<TaskRow>

function columnKeyFor(board: Column[], overId: string): string | null {
  return overId.startsWith(COLUMN_ID_PREFIX)
    ? overId.slice(COLUMN_ID_PREFIX.length)
    : findColumnKey(board, overId)
}

export function TaskBoard({
  categories,
  tasks,
  goals,
}: {
  categories: ReadonlyArray<CategoryOption>
  tasks: ReadonlyArray<TaskRow>
  goals: ReadonlyArray<GoalOption>
}) {
  const serverBoard = useMemo(
    () => buildBoard(categories, tasks as TaskRow[]),
    [categories, tasks]
  )
  const signature = useMemo(
    () => boardSignature(categories, tasks as TaskRow[]),
    [categories, tasks]
  )

  const [board, setBoard] = useState<Column[]>(serverBoard)
  const [base, setBase] = useState(signature)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // React's "adjust state when props change" — render-phase, no effect, no
  // double paint. Never adopt mid-drag or while a save is round-tripping:
  // when the save lands, serverBoard already equals the local board, so the
  // adoption is a silent no-op and nothing jumps.
  if (base !== signature && draggingId === null && !pending) {
    setBase(signature)
    setBoard(serverBoard)
  }

  // handleDragOver mutates state between renders; refs keep the drag-end
  // handler honest about what's actually on screen.
  const boardRef = useRef(board)
  boardRef.current = board
  const snapshotRef = useRef<Column[] | null>(null)
  const originKeyRef = useRef<string | null>(null)

  const sensors = useSensors(
    // distance 6 keeps plain clicks (toggle, Edit, Delete) from starting
    // a drag, and keyboard drags stay available for accessibility.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id)
    setDraggingId(id)
    snapshotRef.current = boardRef.current
    originKeyRef.current = findColumnKey(boardRef.current, id)
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)

    setBoard((prev) => {
      const fromKey = findColumnKey(prev, activeId)
      const toKey = columnKeyFor(prev, overId)
      // Within-column preview is dnd-kit's job (SortableContext transforms);
      // only a column change needs a real state move here.
      if (!fromKey || !toKey || fromKey === toKey) return prev

      const dest = prev.find((c) => c.key === toKey)
      if (!dest) return prev

      let index = dest.tasks.length
      if (!overId.startsWith(COLUMN_ID_PREFIX)) {
        const overIndex = dest.tasks.findIndex((t) => t.id === overId)
        const translated = active.rect.current.translated
        const below =
          translated !== null &&
          translated.top > over.rect.top + over.rect.height / 2
        index = overIndex >= 0 ? overIndex + (below ? 1 : 0) : dest.tasks.length
      }
      const next = applyMove(prev, activeId, toKey, index)
      boardRef.current = next
      return next
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    const activeId = String(active.id)
    setDraggingId(null)

    const snapshot = snapshotRef.current
    snapshotRef.current = null

    if (!over) {
      // Dropped nowhere — undo any cross-column preview moves.
      if (snapshot) setBoard(snapshot)
      return
    }

    let next = boardRef.current
    const overId = String(over.id)
    const fromKey = findColumnKey(next, activeId)
    const toKey = columnKeyFor(next, overId)
    if (!fromKey) return

    // Finalise a within-column reorder (cross-column already happened in
    // handleDragOver).
    if (
      toKey === fromKey &&
      overId !== activeId &&
      !overId.startsWith(COLUMN_ID_PREFIX)
    ) {
      const column = next.find((c) => c.key === fromKey)
      const oldIndex = column?.tasks.findIndex((t) => t.id === activeId) ?? -1
      const newIndex = column?.tasks.findIndex((t) => t.id === overId) ?? -1
      if (column && oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
        next = next.map((c) =>
          c.key === fromKey
            ? { ...c, tasks: arrayMove(c.tasks, oldIndex, newIndex) }
            : c
        )
        boardRef.current = next
        setBoard(next)
      }
    }

    const destKey = findColumnKey(next, activeId)
    const destColumn = next.find((c) => c.key === destKey)
    if (!destKey || !destColumn) return

    const payload: BoardMove = {
      taskId: activeId,
      to: {
        categoryId: destColumn.categoryId,
        orderedIds: destColumn.tasks.map((t) => t.id),
      },
    }
    const originKey = originKeyRef.current
    if (originKey && originKey !== destKey) {
      const origin = next.find((c) => c.key === originKey)
      if (origin) {
        payload.from = {
          categoryId: origin.categoryId,
          orderedIds: origin.tasks.map((t) => t.id),
        }
      }
    }

    // A drop that changed nothing costs nothing.
    if (snapshot && originKey === destKey) {
      const before = snapshot.find((c) => c.key === destKey)
      const beforeIds = before?.tasks.map((t) => t.id).join(',')
      if (beforeIds === payload.to.orderedIds.join(',')) return
    }

    startTransition(async () => {
      const result = await moveTask(payload)
      if (!result.ok && result.error) {
        toast.error(result.error)
        // Forces the render-phase reconcile to re-adopt server truth,
        // snapping the card back where the database says it is.
        setBase('')
      }
    })
    // No router.refresh(): revalidatePath in the action already carried the
    // updated page back in the same response.
  }

  function handleDragCancel() {
    setDraggingId(null)
    if (snapshotRef.current) setBoard(snapshotRef.current)
    snapshotRef.current = null
  }

  function moveColumn(categoryId: string, direction: -1 | 1) {
    const uncategorised = board.filter((c) => c.categoryId === null)
    const named = board.filter((c) => c.categoryId !== null)
    const index = named.findIndex((c) => c.categoryId === categoryId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= named.length) return

    const reordered = arrayMove(named, index, target)
    setBoard([...uncategorised, ...reordered])
    startTransition(async () => {
      const result = await reorderColumns(
        reordered.map((c) => c.categoryId as string)
      )
      if (!result.ok && result.error) {
        toast.error(result.error)
        setBase('')
      }
    })
  }

  const activeTask =
    draggingId === null
      ? null
      : (board
          .flatMap((c) => c.tasks)
          .find((t) => t.id === draggingId) ?? null)

  const namedColumns = board.filter((c) => c.categoryId !== null)

  return (
    <DndContext
      id="task-board"
      sensors={sensors}
      collisionDetection={closestCorners}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="-mx-4 flex items-start gap-4 overflow-x-auto px-4 pb-4">
        {board.map((column) => {
          const namedIndex = namedColumns.findIndex(
            (c) => c.key === column.key
          )
          return (
            <BoardColumnView
              key={column.key}
              column={column}
              goals={goals}
              categories={categories}
              canMoveLeft={namedIndex > 0}
              canMoveRight={
                namedIndex >= 0 && namedIndex < namedColumns.length - 1
              }
              onMoveColumn={moveColumn}
            />
          )
        })}
        <AddCategoryColumn isFirst={categories.length === 0} />
      </div>

      <DragOverlay>
        {activeTask ? (
          <TaskCardBody
            task={activeTask}
            goals={goals}
            categories={categories}
            overlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function BoardColumnView({
  column,
  goals,
  categories,
  canMoveLeft,
  canMoveRight,
  onMoveColumn,
}: {
  column: Column
  goals: ReadonlyArray<GoalOption>
  categories: ReadonlyArray<CategoryOption>
  canMoveLeft: boolean
  canMoveRight: boolean
  onMoveColumn: (categoryId: string, direction: -1 | 1) => void
}) {
  // The droppable on the column body is what lets an EMPTY column accept
  // drops — a SortableContext with zero items has nothing to collide with.
  const { setNodeRef, isOver } = useDroppable({
    id: COLUMN_ID_PREFIX + column.key,
  })
  const isUncategorised = column.categoryId === null

  return (
    <section className="w-72 shrink-0" aria-label={column.name}>
      <div className="flex items-center gap-2 px-1">
        <h2
          className={cn(
            'truncate text-sm font-semibold',
            isUncategorised && 'text-muted-foreground'
          )}
        >
          {column.name}
        </h2>
        <span className="text-xs text-muted-foreground">
          {column.tasks.length}
        </span>
        <div className="ml-auto flex shrink-0 items-center">
          <TaskDialog
            goals={goals}
            categories={categories}
            defaultCategoryId={column.categoryId ?? undefined}
            trigger={
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Add task to ${column.name}`}
              >
                <PlusIcon className="size-4" />
              </Button>
            }
          />
          {column.categoryId !== null ? (
            <ColumnMenu
              category={{ id: column.categoryId, name: column.name }}
              taskCount={column.tasks.length}
              canMoveLeft={canMoveLeft}
              canMoveRight={canMoveRight}
              onMove={(direction) =>
                onMoveColumn(column.categoryId as string, direction)
              }
            />
          ) : null}
        </div>
      </div>

      <SortableContext
        items={column.tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className={cn(
            'mt-2 flex min-h-24 flex-col gap-2 rounded-lg p-1 transition-colors',
            isOver && 'bg-accent/50'
          )}
        >
          {column.tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              goals={goals}
              categories={categories}
            />
          ))}
          {column.tasks.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
              {isUncategorised ? 'Drop here to un-file' : 'Drop tasks here'}
            </div>
          ) : null}
        </div>
      </SortableContext>
    </section>
  )
}

function AddCategoryColumn({ isFirst }: { isFirst: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="w-72 shrink-0">
      {/* Mirrors a column's header row + body inset so the dashed box lines
          up with the "Drop tasks here" placeholders next to it. */}
      <div aria-hidden className="h-7" />
      <div className="mt-2 p-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed p-4 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <PlusIcon className="size-4" />
          {isFirst ? 'Create your first category' : 'Add category'}
        </button>
      </div>
      <CategoryDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}
