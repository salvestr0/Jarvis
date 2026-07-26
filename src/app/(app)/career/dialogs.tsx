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
import { centsToInput } from '@/lib/money'
import { todayISO } from '@/lib/date'
import type { Job } from '@/lib/queries/career'

import { saveJob, saveWin } from './actions'

function SubmitButton({ idle }: { idle: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : idle}
    </Button>
  )
}

export function JobDialog({
  existing,
  trigger,
}: {
  existing?: Job
  trigger: React.ReactElement
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState(saveJob, emptyFormState)
  const formId = useId()
  const router = useRouter()
  const isEdit = Boolean(existing)

  useEffect(() => {
    if (!state.ok) return
    setOpen(false)
    router.refresh()
    toast.success(isEdit ? 'Job updated' : 'Job added')
  }, [state, isEdit, router])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit role' : 'Add role'}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {existing ? <input type="hidden" name="id" value={existing.id} /> : null}

          <div className="space-y-2">
            <Label htmlFor={`${formId}-employer`}>Employer</Label>
            <Input
              id={`${formId}-employer`}
              name="employer"
              defaultValue={existing?.employer ?? ''}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${formId}-title`}>Job title</Label>
            <Input
              id={`${formId}-title`}
              name="title"
              defaultValue={existing?.title ?? ''}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-start`}>Started</Label>
              <Input
                id={`${formId}-start`}
                name="started_on"
                type="date"
                defaultValue={existing?.started_on ?? todayISO()}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-end`}>Ended</Label>
              <Input
                id={`${formId}-end`}
                name="ended_on"
                type="date"
                defaultValue={existing?.ended_on ?? ''}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank if current
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-salary`}>Salary (SGD)</Label>
              <Input
                id={`${formId}-salary`}
                name="salary"
                inputMode="decimal"
                placeholder="0.00"
                defaultValue={
                  existing?.salary_cents != null
                    ? centsToInput(existing.salary_cents)
                    : ''
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-period`}>Per</Label>
              <NativeSelect
                id={`${formId}-period`}
                name="salary_period"
                defaultValue={existing?.salary_period ?? 'monthly'}
              >
                <option value="monthly">Month</option>
                <option value="annual">Year</option>
              </NativeSelect>
            </div>
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
            <SubmitButton idle={isEdit ? 'Save changes' : 'Add role'} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function WinDialog({
  jobs,
  trigger,
}: {
  jobs: Job[]
  trigger: React.ReactElement
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState(saveWin, emptyFormState)
  const formId = useId()
  const router = useRouter()

  useEffect(() => {
    if (!state.ok) return
    setOpen(false)
    router.refresh()
    toast.success('Win logged')
  }, [state, router])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log a win</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`${formId}-title`}>What did you ship?</Label>
            <Input
              id={`${formId}-title`}
              name="title"
              maxLength={200}
              placeholder="Automated the invoice entry workflow"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-date`}>When</Label>
              <Input
                id={`${formId}-date`}
                name="occurred_on"
                type="date"
                max={todayISO()}
                defaultValue={todayISO()}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-job`}>Role</Label>
              <NativeSelect
                id={`${formId}-job`}
                name="job_id"
                defaultValue={jobs[0]?.id ?? 'none'}
              >
                <option value="none">Not work-related</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.employer}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${formId}-detail`}>
              Detail — what changed because of it?
            </Label>
            <Input
              id={`${formId}-detail`}
              name="detail"
              maxLength={2000}
              placeholder="Cut manual entry from ~2h/day to ~15min"
            />
            <p className="text-xs text-muted-foreground">
              Write the outcome, not the task. This is what goes on a resume.
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
            <SubmitButton idle="Log win" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
