'use client'

import { useActionState, useEffect } from 'react'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { emptyFormState, type FormState } from '@/lib/form-state'

function Inner({ label, confirmText }: { label: string; confirmText: string }) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      disabled={pending}
      className="text-muted-foreground hover:text-destructive"
      onClick={(e) => {
        // Deleting your own records should never be a single misplaced click.
        if (!confirm(confirmText)) e.preventDefault()
      }}
    >
      {pending ? '…' : label}
    </Button>
  )
}

/**
 * Reusable delete button backed by a server action.
 *
 * The action itself is passed in as a prop — server actions are values, so a
 * client component can receive one and call it. That's what lets this single
 * component delete transactions, holdings, jobs and wins without knowing
 * anything about them.
 */
export function DeleteForm({
  action,
  id,
  label = 'Delete',
  confirmText = 'Delete this? This cannot be undone.',
  successMessage = 'Deleted',
  extraFields,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>
  id: string
  label?: string
  confirmText?: string
  successMessage?: string
  extraFields?: Record<string, string>
}) {
  const [state, formAction] = useActionState(action, emptyFormState)
  const router = useRouter()

  useEffect(() => {
    if (state.error) {
      toast.error(state.error)
    } else if (state.ok) {
      router.refresh()
      toast.success(successMessage)
    }
  }, [state, router, successMessage])

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={id} />
      {extraFields
        ? Object.entries(extraFields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))
        : null}
      <Inner label={label} confirmText={confirmText} />
    </form>
  )
}
