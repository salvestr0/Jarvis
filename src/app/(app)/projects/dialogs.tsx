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
import type { Project, ProjectWithProgress } from '@/lib/queries/projects'

import { logMetric, saveProject } from './actions'

function SubmitButton({ idle }: { idle: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : idle}
    </Button>
  )
}

export function ProjectDialog({
  existing,
  trigger,
}: {
  existing?: Project
  trigger: React.ReactElement
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState(saveProject, emptyFormState)
  const formId = useId()
  const router = useRouter()
  const isEdit = Boolean(existing)

  useEffect(() => {
    if (!state.ok) return
    setOpen(false)
    router.refresh()
    toast.success(isEdit ? 'Project updated' : 'Project added')
  }, [state, isEdit, router])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit project' : 'Add project'}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {existing ? <input type="hidden" name="id" value={existing.id} /> : null}

          <div className="space-y-2">
            <Label htmlFor={`${formId}-name`}>Name</Label>
            <Input
              id={`${formId}-name`}
              name="name"
              maxLength={80}
              defaultValue={existing?.name ?? ''}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-status`}>Status</Label>
              <NativeSelect
                id={`${formId}-status`}
                name="status"
                defaultValue={existing?.status ?? 'building'}
              >
                <option value="idea">Idea</option>
                <option value="building">Building</option>
                <option value="beta">Beta</option>
                <option value="launched">Launched</option>
                <option value="paused">Paused</option>
                <option value="archived">Archived</option>
              </NativeSelect>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${formId}-kind`}>Type</Label>
              <NativeSelect
                id={`${formId}-kind`}
                name="kind"
                defaultValue={existing?.kind ?? 'product'}
              >
                <option value="product">Product</option>
                <option value="content">Content</option>
                <option value="business">Business</option>
              </NativeSelect>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-target`}>MRR target (SGD)</Label>
              <Input
                id={`${formId}-target`}
                name="mrr_target"
                inputMode="decimal"
                placeholder="1000.00"
                defaultValue={
                  existing ? centsToInput(existing.mrr_target_cents) : ''
                }
              />
              <p className="text-xs text-muted-foreground">
                Leave blank if it isn&apos;t a revenue play
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${formId}-launch`}>Launch date</Label>
              <Input
                id={`${formId}-launch`}
                name="launch_date"
                type="date"
                defaultValue={existing?.launch_date ?? ''}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${formId}-url`}>URL</Label>
            <Input
              id={`${formId}-url`}
              name="url"
              type="url"
              placeholder="https://"
              defaultValue={existing?.url ?? ''}
            />
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
            <SubmitButton idle={isEdit ? 'Save changes' : 'Add project'} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function MetricDialog({
  project,
  trigger,
}: {
  project: ProjectWithProgress
  trigger: React.ReactElement
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState(logMetric, emptyFormState)
  const formId = useId()
  const router = useRouter()

  useEffect(() => {
    if (!state.ok) return
    setOpen(false)
    router.refresh()
    toast.success('Numbers updated')
  }, [state, router])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Update {project.name}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="project_id" value={project.id} />

          <div className="space-y-2">
            <Label htmlFor={`${formId}-mrr`}>MRR right now (SGD)</Label>
            <Input
              id={`${formId}-mrr`}
              name="mrr"
              inputMode="decimal"
              placeholder="0.00"
              defaultValue={centsToInput(project.currentMrrCents)}
            />
            <p className="text-xs text-muted-foreground">
              Zero is a real number — log it. Watching it stay flat is data too.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-users`}>Users</Label>
              <Input
                id={`${formId}-users`}
                name="users_count"
                inputMode="numeric"
                placeholder="0"
                defaultValue={project.usersCount ?? ''}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-date`}>As of</Label>
              <Input
                id={`${formId}-date`}
                name="as_of"
                type="date"
                max={todayISO()}
                defaultValue={todayISO()}
                required
              />
            </div>
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
