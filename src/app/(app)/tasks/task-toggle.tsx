'use client'

import { useActionState, useEffect } from 'react'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CircleCheckIcon, CircleIcon } from 'lucide-react'

import { emptyFormState } from '@/lib/form-state'

import { toggleTask } from './actions'

function ToggleButton({ done, title }: { done: boolean; title: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={done ? `Reopen "${title}"` : `Mark "${title}" done`}
      className="shrink-0 rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
    >
      {done ? (
        <CircleCheckIcon className="size-5 text-emerald-600 dark:text-emerald-500" />
      ) : (
        <CircleIcon className="size-5" />
      )}
    </button>
  )
}

/** The checkbox at the start of each task row — one tap to finish or reopen. */
export function TaskToggle({
  id,
  done,
  title,
}: {
  id: string
  done: boolean
  title: string
}) {
  const [state, formAction] = useActionState(toggleTask, emptyFormState)
  const router = useRouter()

  useEffect(() => {
    if (state.error) {
      toast.error(state.error)
    } else if (state.ok) {
      router.refresh()
    }
  }, [state, router])

  return (
    <form action={formAction} className="flex items-center">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="done" value={done ? 'false' : 'true'} />
      <ToggleButton done={done} title={title} />
    </form>
  )
}
