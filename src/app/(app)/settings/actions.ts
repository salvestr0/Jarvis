'use server'

import { revalidatePath } from 'next/cache'

import type { FormState } from '@/lib/form-state'
import {
  saveSettings as persistSettings,
  type DigestMode,
  type Settings,
} from '@/lib/queries/settings'

function readSettings(formData: FormData):
  | { ok: true; value: Settings }
  | { ok: false; error: string } {
  const mode = String(formData.get('digest_mode') ?? '')
  if (mode !== 'daily' && mode !== 'noteworthy' && mode !== 'off') {
    return { ok: false, error: 'Pick a digest mode.' }
  }

  // An unchecked checkbox simply doesn't appear in FormData — absence is off.
  const on = (name: string) => formData.get(name) === 'on'

  return {
    ok: true,
    value: {
      digest_mode: mode as DigestMode,
      digest_calendar: on('digest_calendar'),
      digest_email: on('digest_email'),
      digest_money: on('digest_money'),
      digest_portfolio: on('digest_portfolio'),
      digest_tasks: on('digest_tasks'),
    },
  }
}

export async function saveSettings(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = readSettings(formData)
  if (!parsed.ok) return { error: parsed.error, ok: false }

  try {
    await persistSettings(parsed.value)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Something went wrong.',
      ok: false,
    }
  }

  revalidatePath('/settings')
  return { error: null, ok: true }
}
