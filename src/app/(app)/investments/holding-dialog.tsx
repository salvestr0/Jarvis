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
} from '@/components/ui/dialog'
import { DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/field'
import { centsToInput } from '@/lib/money'
import { formatQuantity } from '@/lib/quantity'
import type { Holding } from '@/lib/queries/investments'

import { saveHolding } from './actions'
import { emptyFormState } from './form-state'

function SaveButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add holding'}
    </Button>
  )
}

export function HoldingDialog({
  existing,
  trigger,
}: {
  existing?: Holding
  trigger: React.ReactElement
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState(saveHolding, emptyFormState)
  const [kind, setKind] = useState(existing?.kind ?? 'crypto')
  const formId = useId()
  const router = useRouter()

  const isEdit = Boolean(existing)

  useEffect(() => {
    if (!state.ok) return
    setOpen(false)
    router.refresh()
    toast.success(isEdit ? 'Holding updated' : 'Holding added')
  }, [state, isEdit, router])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit holding' : 'Add holding'}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {existing ? <input type="hidden" name="id" value={existing.id} /> : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-kind`}>Type</Label>
              <NativeSelect
                id={`${formId}-kind`}
                name="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as 'crypto' | 'stock')}
              >
                <option value="crypto">Crypto</option>
                <option value="stock">Stock / ETF</option>
              </NativeSelect>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${formId}-symbol`}>Ticker</Label>
              <Input
                id={`${formId}-symbol`}
                name="symbol"
                placeholder={kind === 'crypto' ? 'BTC' : 'AAPL'}
                defaultValue={existing?.symbol ?? ''}
                autoCapitalize="characters"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${formId}-quantity`}>Quantity</Label>
            <Input
              id={`${formId}-quantity`}
              name="quantity"
              inputMode="decimal"
              placeholder={kind === 'crypto' ? '0.0035' : '10'}
              defaultValue={existing ? formatQuantity(existing.quantity) : ''}
              required
            />
            <p className="text-xs text-muted-foreground">
              Fractional amounts are fine — up to 10 decimal places.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-cost`}>Total cost (SGD)</Label>
              <Input
                id={`${formId}-cost`}
                name="cost_basis"
                inputMode="decimal"
                placeholder="0.00"
                defaultValue={
                  existing ? centsToInput(existing.cost_basis_cents) : ''
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${formId}-pricecur`}>Priced in</Label>
              <NativeSelect
                id={`${formId}-pricecur`}
                name="price_currency"
                defaultValue={existing?.price_currency ?? 'USD'}
              >
                <option value="USD">USD</option>
                <option value="SGD">SGD</option>
              </NativeSelect>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Total cost is everything you paid in SGD, all buys added together —
            that&apos;s what your profit is measured against.
          </p>

          <div className="space-y-2">
            <Label htmlFor={`${formId}-note`}>Note (optional)</Label>
            <Input
              id={`${formId}-note`}
              name="note"
              maxLength={280}
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
