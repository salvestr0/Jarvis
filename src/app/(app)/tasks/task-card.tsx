'use client'

import type { CSSProperties, HTMLAttributes } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DeleteForm } from '@/components/delete-form'
import { cn } from '@/lib/utils'
import { todayISO } from '@/lib/date'
import type { TaskRow } from '@/lib/queries/tasks'

import { removeTask } from './actions'
import { TaskDialog } from './dialogs'
import { TaskToggle } from './task-toggle'

export type CategoryOption = { id: string; name: string }
export type GoalOption = { id: string; title: string }

/** Priority + overdue badges, shared by the board cards and the Done list. */
export function TaskBadges({ task }: { task: TaskRow }) {
  // todayISO is pinned to Asia/Singapore, so server and client agree.
  const overdue = !task.done && task.due_on !== null && task.due_on < todayISO()

  return (
    <>
      {!task.done && task.priority === 'high' ? <Badge>high</Badge> : null}
      {!task.done && task.priority === 'low' ? (
        <Badge variant="outline">low</Badge>
      ) : null}
      {overdue ? <Badge variant="destructive">overdue</Badge> : null}
    </>
  )
}

/**
 * The card itself, sans drag wiring, so the DragOverlay can render the exact
 * same thing. `grabProps` (dnd-kit listeners) land on the content block, not
 * the card root — the toggle and footer buttons must stay plainly clickable.
 */
export function TaskCardBody({
  task,
  goals,
  categories,
  inboxLabel,
  grabProps,
  overlay = false,
}: {
  task: TaskRow
  goals: ReadonlyArray<GoalOption>
  categories: ReadonlyArray<CategoryOption>
  inboxLabel?: string
  grabProps?: HTMLAttributes<HTMLDivElement>
  overlay?: boolean
}) {
  return (
    <div
      className={cn(
        'group rounded-lg border bg-card p-3 shadow-xs',
        overlay && 'shadow-md ring-1 ring-foreground/10'
      )}
    >
      <div className="flex items-start gap-2">
        <div className="pt-0.5">
          <TaskToggle id={task.id} done={task.done} title={task.title} />
        </div>

        <div
          {...grabProps}
          className={cn(
            'min-w-0 flex-1 touch-none',
            overlay ? 'cursor-grabbing' : 'cursor-grab active:cursor-grabbing'
          )}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{task.title}</span>
            <TaskBadges task={task} />
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {task.due_on ? `Due ${task.due_on}` : 'No due date'}
            {task.goal_title ? ` · → ${task.goal_title}` : ''}
            {task.note ? ` · ${task.note}` : ''}
          </p>
        </div>
      </div>

      <div className="mt-1 flex items-center justify-end opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
        <TaskDialog
          existing={task}
          goals={goals}
          categories={categories}
          inboxLabel={inboxLabel}
          trigger={
            <Button variant="ghost" size="sm">
              Edit
            </Button>
          }
        />
        <DeleteForm
          action={removeTask}
          id={task.id}
          confirmText={`Delete "${task.title}"?`}
          successMessage="Task deleted"
        />
      </div>
    </div>
  )
}

export function SortableTaskCard({
  task,
  goals,
  categories,
  inboxLabel,
}: {
  task: TaskRow
  goals: ReadonlyArray<GoalOption>
  categories: ReadonlyArray<CategoryOption>
  inboxLabel?: string
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    // The transform lives on this wrapper. Dialogs and menus inside the card
    // portal to document.body (Base UI), so they escape it and position fine.
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && 'opacity-40')}
    >
      <TaskCardBody
        task={task}
        goals={goals}
        categories={categories}
        inboxLabel={inboxLabel}
        grabProps={
          { ...attributes, ...listeners } as HTMLAttributes<HTMLDivElement>
        }
      />
    </div>
  )
}
