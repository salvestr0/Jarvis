import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DeleteForm } from '@/components/delete-form'
import { PageHeader } from '@/components/page-header'
import { getGoals } from '@/lib/queries/goals'
import { getTasksInboxLabel } from '@/lib/queries/settings'
import { getTaskCategories } from '@/lib/queries/task-categories'
import { getTasks, type TaskRow } from '@/lib/queries/tasks'

import { removeTask } from './actions'
import { TaskBoard } from './board'
import { TaskDialog } from './dialogs'
import { TaskBadges } from './task-card'
import { TaskToggle } from './task-toggle'

/** Row layout for the Done list — finished work reads fine as a list. */
function TaskItem({
  task,
  goals,
  categories,
  inboxLabel,
}: {
  task: TaskRow
  goals: ReadonlyArray<{ id: string; title: string }>
  categories: ReadonlyArray<{ id: string; name: string }>
  inboxLabel: string
}) {
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
          <TaskBadges task={task} />
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

export default async function TasksPage() {
  const [tasks, allGoals, categories, inboxLabel] = await Promise.all([
    getTasks(),
    getGoals(),
    getTaskCategories(),
    getTasksInboxLabel(),
  ])

  // Only active goals are offered as link targets; finished ones are history.
  const goalOptions = allGoals
    .filter((g) => g.status === 'active')
    .map((g) => ({ id: g.id, title: g.title }))

  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }))

  // The board owns the ordering of open tasks — it's manual now.
  const open = tasks.filter((t) => !t.done)
  const done = tasks
    .filter((t) => t.done)
    .sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? ''))

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Sort your work into columns; drag cards wherever they belong."
        action={
          <TaskDialog
            goals={goalOptions}
            categories={categoryOptions}
            inboxLabel={inboxLabel}
            trigger={<Button>Add task</Button>}
          />
        }
      />

      <div className="space-y-6">
        <TaskBoard
          categories={categoryOptions}
          tasks={open}
          goals={goalOptions}
          inboxLabel={inboxLabel}
        />

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
                  <TaskItem
                    key={t.id}
                    task={t}
                    goals={goalOptions}
                    categories={categoryOptions}
                    inboxLabel={inboxLabel}
                  />
                ))}
              </CardContent>
            </Card>
          </section>
        ) : null}
      </div>
    </>
  )
}
