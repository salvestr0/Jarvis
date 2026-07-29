'use client'

import { useActionState, useEffect, useId, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/field'
import { emptyFormState } from '@/lib/form-state'
import type { TaskRow } from '@/lib/queries/tasks'

import { renameInbox, saveCategory, saveTask } from './actions'

function SubmitButton({ idle }: { idle: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : idle}
    </Button>
  )
}

export function TaskDialog({
  existing,
  goals,
  categories,
  defaultCategoryId,
  inboxLabel = 'Uncategorised',
  trigger,
}: {
  existing?: TaskRow
  goals: ReadonlyArray<{ id: string; title: string }>
  categories: ReadonlyArray<{ id: string; name: string }>
  defaultCategoryId?: string
  inboxLabel?: string
  trigger: React.ReactElement
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState(saveTask, emptyFormState)
  const formId = useId()
  const router = useRouter()
  const isEdit = Boolean(existing)

  useEffect(() => {
    if (!state.ok) return
    setOpen(false)
    router.refresh()
    toast.success(isEdit ? 'Task updated' : 'Task added')
  }, [state, isEdit, router])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit task' : 'Add task'}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {existing ? <input type="hidden" name="id" value={existing.id} /> : null}

          <div className="space-y-2">
            <Label htmlFor={`${formId}-title`}>Task</Label>
            <Input
              id={`${formId}-title`}
              name="title"
              maxLength={200}
              placeholder="e.g. Record the intro Short"
              defaultValue={existing?.title ?? ''}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-priority`}>Priority</Label>
              <NativeSelect
                id={`${formId}-priority`}
                name="priority"
                defaultValue={existing?.priority ?? 'medium'}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </NativeSelect>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${formId}-due`}>Due date</Label>
              <Input
                id={`${formId}-due`}
                name="due_on"
                type="date"
                defaultValue={existing?.due_on ?? ''}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${formId}-category`}>Category</Label>
            <NativeSelect
              id={`${formId}-category`}
              name="category_id"
              defaultValue={
                existing ? (existing.category_id ?? '') : (defaultCategoryId ?? '')
              }
            >
              <option value="">{inboxLabel}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${formId}-goal`}>Pushes forward</Label>
            <NativeSelect
              id={`${formId}-goal`}
              name="goal_id"
              defaultValue={existing?.goal_id ?? ''}
            >
              <option value="">No goal — just needs doing</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">
              Linking a task to a goal shows you why it&apos;s on the list
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${formId}-note`}>Notes</Label>
            <Input
              id={`${formId}-note`}
              name="note"
              maxLength={1000}
              defaultValue={existing?.note ?? ''}
            />
          </div>

          {state.error ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {state.error}
            </p>
          ) : null}

          <DialogFooter>
            <SubmitButton idle={isEdit ? 'Save changes' : 'Add task'} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Create or rename a board category. Controlled from outside (no trigger):
 * the column menu opens it as a sibling so it survives the menu closing.
 */
export function CategoryDialog({
  existing,
  open,
  onOpenChange,
}: {
  existing?: { id: string; name: string }
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [state, formAction] = useActionState(saveCategory, emptyFormState)
  const formId = useId()
  const router = useRouter()
  const isEdit = Boolean(existing)

  useEffect(() => {
    if (!state.ok) return
    onOpenChange(false)
    router.refresh()
    toast.success(isEdit ? 'Category renamed' : 'Category added')
  }, [state, isEdit, router, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Rename category' : 'Add category'}
          </DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {existing ? (
            <input type="hidden" name="id" value={existing.id} />
          ) : null}

          <div className="space-y-2">
            <Label htmlFor={`${formId}-name`}>Name</Label>
            <Input
              id={`${formId}-name`}
              name="name"
              maxLength={60}
              placeholder="e.g. Content"
              defaultValue={existing?.name ?? ''}
              required
            />
          </div>

          {state.error ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {state.error}
            </p>
          ) : null}

          <DialogFooter>
            <SubmitButton idle={isEdit ? 'Save' : 'Add category'} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Rename the inbox column ("Uncategorised"). It isn't a category row — the
 * label is a per-user setting — so it gets its own action and dialog.
 */
export function InboxDialog({
  label,
  open,
  onOpenChange,
}: {
  label: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [state, formAction] = useActionState(renameInbox, emptyFormState)
  const formId = useId()
  const router = useRouter()

  useEffect(() => {
    if (!state.ok) return
    onOpenChange(false)
    router.refresh()
    toast.success('Column renamed')
  }, [state, router, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename column</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`${formId}-name`}>Name</Label>
            <Input
              id={`${formId}-name`}
              name="name"
              maxLength={60}
              defaultValue={label}
              required
            />
            <p className="text-xs text-muted-foreground">
              This column is the inbox — tasks created without a category
              (including from Telegram) land here.
            </p>
          </div>

          {state.error ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {state.error}
            </p>
          ) : null}

          <DialogFooter>
            <SubmitButton idle="Save" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
