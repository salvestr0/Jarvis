'use client'

import { useActionState, useEffect } from 'react'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { emptyFormState } from '@/lib/form-state'

import { logRecurring } from './recurring-actions'

function Inner() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? 'Logging…' : 'Log payment'}
    </Button>
  )
}

/**
 * One click turns a recurring item into a real transaction for this period
 * and moves its due date forward one cadence. No confirm dialog — it isn't
 * destructive, and a wrongly logged payment is one Delete away in the
 * transaction table above.
 */
export function RecurringLogForm({ id }: { id: string }) {
  const [state, formAction] = useActionState(logRecurring, emptyFormState)
  const router = useRouter()

  useEffect(() => {
    if (state.error) {
      toast.error(state.error)
    } else if (state.ok) {
      router.refresh()
      toast.success('Payment logged')
    }
  }, [state, router])

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <Inner />
    </form>
  )
}
