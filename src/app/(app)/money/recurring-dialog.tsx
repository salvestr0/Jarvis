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
import { centsToInput } from '@/lib/money'
import { todayISO } from '@/lib/date'
import type { Category, RecurringRow } from '@/lib/types'

import { saveRecurring } from './recurring-actions'
import { emptyFormState } from './form-state'

function SaveButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add recurring'}
    </Button>
  )
}

export function RecurringDialog({
  categories,
  existing,
  trigger,
}: {
  categories: Category[]
  existing?: RecurringRow
  trigger: React.ReactElement
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState(saveRecurring, emptyFormState)
  const [direction, setDirection] = useState(existing?.direction ?? 'expense')
  const [addingCategory, setAddingCategory] = useState(false)
  const formId = useId()
  const router = useRouter()

  const isEdit = Boolean(existing)

  useEffect(() => {
    if (!state.ok) return

    setOpen(false)
    router.refresh()
    toast.success(isEdit ? 'Recurring payment updated' : 'Recurring payment added')
  }, [state, isEdit, router])

  const visibleCategories = categories.filter((c) => c.direction === direction)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Edit recurring payment' : 'Add recurring payment'}
          </DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {existing ? <input type="hidden" name="id" value={existing.id} /> : null}

          <div className="space-y-2">
            <Label htmlFor={`${formId}-name`}>Name</Label>
            <Input
              id={`${formId}-name`}
              name="name"
              maxLength={80}
              placeholder="e.g. Netflix, Car insurance"
              defaultValue={existing?.name ?? ''}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-direction`}>Type</Label>
              <NativeSelect
                id={`${formId}-direction`}
                name="direction"
                value={direction}
                onChange={(e) => {
                  setDirection(e.target.value as 'income' | 'expense')
                  // The category select remounts and resets to Uncategorised
                  // when direction flips, so the name field must reset too.
                  setAddingCategory(false)
                }}
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </NativeSelect>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${formId}-amount`}>Amount (SGD)</Label>
              <Input
                id={`${formId}-amount`}
                name="amount"
                inputMode="decimal"
                placeholder="0.00"
                defaultValue={
                  existing ? centsToInput(existing.amount_cents) : ''
                }
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-cadence`}>Repeats</Label>
              <NativeSelect
                id={`${formId}-cadence`}
                name="cadence"
                defaultValue={existing?.cadence ?? 'monthly'}
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="weekly">Weekly</option>
              </NativeSelect>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${formId}-next-due`}>Next due</Label>
              {/* No max: unlike a transaction, the next bill is usually in the future. */}
              <Input
                id={`${formId}-next-due`}
                name="next_due"
                type="date"
                defaultValue={existing?.next_due ?? todayISO()}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${formId}-category`}>Category</Label>
            <NativeSelect
              id={`${formId}-category`}
              name="category_id"
              defaultValue={existing?.category_id ?? 'none'}
              key={direction}
              onChange={(e) => setAddingCategory(e.target.value === 'new')}
            >
              <option value="none">Uncategorised</option>
              {visibleCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="new">+ New category…</option>
            </NativeSelect>
          </div>

          {addingCategory ? (
            <div className="space-y-2">
              <Label htmlFor={`${formId}-new-category`}>New category name</Label>
              <Input
                id={`${formId}-new-category`}
                name="new_category_name"
                maxLength={40}
                placeholder="e.g. Insurance"
                autoFocus
                required
              />
            </div>
          ) : null}

          {state.error ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {state.error}
            </p>
          ) : null}

          <DialogFooter>
            <SaveButton isEdit={isEdit} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
