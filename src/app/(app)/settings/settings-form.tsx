'use client'

import { useActionState, useEffect, useId } from 'react'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/field'
import { emptyFormState } from '@/lib/form-state'
import type { Settings } from '@/lib/queries/settings'

import { saveSettings } from './actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save settings'}
    </Button>
  )
}

const SECTIONS: Array<{ name: keyof Settings; label: string; hint: string }> = [
  { name: 'digest_calendar', label: 'Calendar', hint: "Today's events" },
  { name: 'digest_email', label: 'Email', hint: 'Unread from the last day' },
  { name: 'digest_money', label: 'Money', hint: 'Bills due, spending pace' },
  { name: 'digest_portfolio', label: 'Portfolio', hint: 'Big moves, new highs' },
  { name: 'digest_tasks', label: 'Tasks & goals', hint: 'Overdue and upcoming' },
]

export function SettingsForm({ initial }: { initial: Settings }) {
  const [state, formAction] = useActionState(saveSettings, emptyFormState)
  const formId = useId()
  const router = useRouter()

  useEffect(() => {
    if (!state.ok) return
    router.refresh()
    toast.success('Settings saved')
  }, [state, router])

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor={`${formId}-mode`}>Morning digest</Label>
        <NativeSelect
          id={`${formId}-mode`}
          name="digest_mode"
          defaultValue={initial.digest_mode}
        >
          <option value="daily">Every morning — always send the daily digest</option>
          <option value="noteworthy">
            Only when noteworthy — stay quiet unless something needs attention
          </option>
          <option value="off">Off — no proactive messages</option>
        </NativeSelect>
        <p className="text-xs text-muted-foreground">
          Sent to Telegram between 10:00 and 11:00 each morning, after the daily
          price update.
        </p>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">What the digest covers</legend>
        {SECTIONS.map(({ name, label, hint }) => (
          <label
            key={name}
            className="flex cursor-pointer items-center gap-3 text-sm"
          >
            <input
              type="checkbox"
              name={name}
              defaultChecked={Boolean(initial[name])}
              className="size-4 accent-primary"
            />
            <span>{label}</span>
            <span className="text-xs text-muted-foreground">{hint}</span>
          </label>
        ))}
      </fieldset>

      {state.error ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  )
}
