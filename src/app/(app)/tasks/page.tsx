import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DeleteForm } from '@/components/delete-form'
import { PageHeader } from '@/components/page-header'
import { todayISO } from '@/lib/date'
import { getGoals } from '@/lib/queries/goals'
import { getTasks, type TaskRow } from '@/lib/queries/tasks'

import { removeTask } from './actions'
import { TaskDialog } from './dialogs'
import { TaskToggle } from './task-toggle'

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const

/**
 * Open tasks in the order you should look at them: overdue first, then by
 * due date, then priority. Undated tasks sink below dated ones — a date is
 * a commitment, and commitments come first.
 */
function sortOpen(tasks: TaskRow[]): TaskRow[] {
  return [...tasks].sort((a, b) => {
    if (a.due_on !== b.due_on) {
      if (a.due_on === null) return 1
      if (b.due_on === null) return -1
      return a.due_on < b.due_on ? -1 : 1
    }
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  })
}

function TaskItem({
  task,
  goals,
}: {
  task: TaskRow
  goals: ReadonlyArray<{ id: string; title: string }>
}) {
  const overdue = !task.done && task.due_on !== null && task.due_on < todayISO()

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="pt-0.5">
        <TaskToggle id={task.id} done={task.done} title={task.title} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              task.done ? 'text-muted-foreground line-through' : 'font-medium'
            }
          >
            {task.title}
          </span>
          {!task.done && task.priority === 'high' ? (
            <Badge>high</Badge>
          ) : null}
          {!task.done && task.priority === 'low' ? (
            <Badge variant="outline">low</Badge>
          ) : null}
          {overdue ? <Badge variant="destructive">overdue</Badge> : null}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {task.due_on ? `Due ${task.due_on}` : 'No due date'}
          {task.goal_title ? ` · → ${task.goal_title}` : ''}
          {task.note ? ` · ${task.note}` : ''}
        </p>
      </div>

      <div className="flex shrink-0 items-center">
        <TaskDialog
          existing={task}
          goals={goals}
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

export default async function TasksPage() {
  const [tasks, allGoals] = await Promise.all([getTasks(), getGoals()])

  // Only active goals are offered as link targets; finished ones are history.
  const goalOptions = allGoals
    .filter((g) => g.status === 'active')
    .map((g) => ({ id: g.id, title: g.title }))

  const open = sortOpen(tasks.filter((t) => !t.done))
  const done = tasks
    .filter((t) => t.done)
    .sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? ''))

  return (
    <>
      <PageHeader
        title="Tasks"
        description="What needs doing, in the order it needs doing."
        action={
          <TaskDialog goals={goalOptions} trigger={<Button>Add task</Button>} />
        }
      />

      <div className="space-y-6">
        {open.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <p className="text-sm font-medium">Nothing open</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add a task, or enjoy the rare feeling of a clear list.
            </p>
          </div>
        ) : (
          <Card>
            <CardContent className="divide-y p-0">
              {open.map((t) => (
                <TaskItem key={t.id} task={t} goals={goalOptions} />
              ))}
            </CardContent>
          </Card>
        )}

        {done.length > 0 ? (
          <section>
            <h2 className="text-sm font-semibold">
              Done{' '}
              <span className="font-normal text-muted-foreground">
                ({done.length})
              </span>
            </h2>
            <Card className="mt-3 opacity-70">
              <CardContent className="divide-y p-0">
                {done.map((t) => (
                  <TaskItem key={t.id} task={t} goals={goalOptions} />
                ))}
              </CardContent>
            </Card>
          </section>
        ) : null}
      </div>
    </>
  )
}
