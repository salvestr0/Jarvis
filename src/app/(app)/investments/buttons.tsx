'use client'

import { useActionState, useEffect } from 'react'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { emptyFormState } from '@/lib/form-state'

import { refreshPricesAction } from './actions'

function Inner() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? 'Fetching…' : 'Refresh prices'}
    </Button>
  )
}

export function RefreshPricesButton() {
  const [state, formAction] = useActionState(refreshPricesAction, emptyFormState)
  const router = useRouter()

  useEffect(() => {
    // A refresh can partially succeed — some prices update while others fail.
    // Both facts get surfaced rather than only the happy one, because a stale
    // number shown as if it were current is the worst outcome here.
    if (state.message) toast.success(state.message)
    if (state.error) toast.error(state.error, { duration: 8000 })
    if (state.ok) router.refresh()
  }, [state, router])

  return (
    <form action={formAction}>
      <Inner />
    </form>
  )
}
