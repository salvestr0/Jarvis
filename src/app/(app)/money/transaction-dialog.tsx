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
import type { Account, Category, TransactionRow } from '@/lib/types'

import { saveTransaction } from './actions'
import { emptyFormState } from './form-state'

function SaveButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add transaction'}
    </Button>
  )
}

export function TransactionDialog({
  categories,
  accounts,
  month,
  existing,
  trigger,
}: {
  categories: Category[]
  accounts: Account[]
  month: string
  existing?: TransactionRow
  trigger: React.ReactElement
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState(saveTransaction, emptyFormState)
  const [direction, setDirection] = useState(existing?.direction ?? 'expense')
  const [addingCategory, setAddingCategory] = useState(false)
  const formId = useId()
  const router = useRouter()

  const isEdit = Boolean(existing)

  useEffect(() => {
    if (!state.ok) return

    setOpen(false)
    // router.refresh() re-fetches this page from the server and swaps in the
    // new HTML, keeping your scroll position and anything you'd typed.
    //
    // revalidatePath() alone (in the server action) isn't enough here: it
    // clears the SERVER's cache, but this page is rendered fresh per request
    // and has no server cache. The stale copy is the one your BROWSER is
    // holding, and only the client router can throw that away.
    router.refresh()
    toast.success(isEdit ? 'Transaction updated' : 'Transaction added')
  }, [state, isEdit, router])

  // Only show categories matching the chosen direction — picking "Salary" for
  // an expense would be nonsense, so don't offer it.
  const visibleCategories = categories.filter((c) => c.direction === direction)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit transaction' : 'Add transaction'}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {existing ? <input type="hidden" name="id" value={existing.id} /> : null}
          <input type="hidden" name="month" value={month} />

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

          <div className="space-y-2">
            <Label htmlFor={`${formId}-date`}>Date</Label>
            <Input
              id={`${formId}-date`}
              name="occurred_on"
              type="date"
              max={todayISO()}
              defaultValue={existing?.occurred_on ?? todayISO()}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
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

            <div className="space-y-2">
              <Label htmlFor={`${formId}-account`}>Account</Label>
              <NativeSelect
                id={`${formId}-account`}
                name="account_id"
                defaultValue={existing?.account_id ?? 'none'}
              >
                <option value="none">None</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
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

          <div className="space-y-2">
            <Label htmlFor={`${formId}-note`}>Note (optional)</Label>
            <Input
              id={`${formId}-note`}
              name="note"
              maxLength={280}
              placeholder="e.g. Charizard slab — Carousell"
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
            <SaveButton isEdit={isEdit} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
