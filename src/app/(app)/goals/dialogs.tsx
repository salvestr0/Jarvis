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
import type { Goal } from '@/lib/queries/goals'

import { markGoalStatus, saveGoal } from './actions'

function SubmitButton({ idle }: { idle: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : idle}
    </Button>
  )
}

export function GoalDialog({
  existing,
  trigger,
}: {
  existing?: Goal
  trigger: React.ReactElement
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState(saveGoal, emptyFormState)
  const formId = useId()
  const router = useRouter()
  const isEdit = Boolean(existing)

  useEffect(() => {
    if (!state.ok) return
    setOpen(false)
    router.refresh()
    toast.success(isEdit ? 'Goal updated' : 'Goal added')
  }, [state, isEdit, router])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit goal' : 'Add goal'}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {existing ? <input type="hidden" name="id" value={existing.id} /> : null}

          <div className="space-y-2">
            <Label htmlFor={`${formId}-title`}>Goal</Label>
            <Input
              id={`${formId}-title`}
              name="title"
              maxLength={120}
              placeholder="e.g. Hit 1k MRR with my first product"
              defaultValue={existing?.title ?? ''}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-horizon`}>Horizon</Label>
              <NativeSelect
                id={`${formId}-horizon`}
                name="horizon"
                defaultValue={existing?.horizon ?? 'short'}
              >
                <option value="short">Short term</option>
                <option value="long">Long term</option>
              </NativeSelect>
              <p className="text-xs text-muted-foreground">
                Short = weeks or months. Long = the big picture.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${formId}-status`}>Status</Label>
              <NativeSelect
                id={`${formId}-status`}
                name="status"
                defaultValue={existing?.status ?? 'active'}
              >
                <option value="active">Active</option>
                <option value="achieved">Achieved</option>
                <option value="dropped">Dropped</option>
              </NativeSelect>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${formId}-target`}>Target date</Label>
            <Input
              id={`${formId}-target`}
              name="target_date"
              type="date"
              defaultValue={existing?.target_date ?? ''}
            />
            <p className="text-xs text-muted-foreground">
              Optional — leave blank if there&apos;s no deadline
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${formId}-note`}>Why it matters</Label>
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
            <SubmitButton idle={isEdit ? 'Save changes' : 'Add goal'} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * One-click "Mark achieved" — finishing a goal should feel like a single
 * satisfying press, not a trip through the edit dialog.
 */
export function AchieveButton({ goal }: { goal: Goal }) {
  const [state, formAction] = useActionState(markGoalStatus, emptyFormState)
  const router = useRouter()

  useEffect(() => {
    if (state.error) {
      toast.error(state.error)
    } else if (state.ok) {
      router.refresh()
      toast.success('Goal achieved 🎉')
    }
  }, [state, router])

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={goal.id} />
      <input type="hidden" name="status" value="achieved" />
      <Button type="submit" variant="outline" size="sm">
        Mark achieved
      </Button>
    </form>
  )
}
