'use server'

import { revalidatePath } from 'next/cache'

import { parseMoney } from '@/lib/money'
import { todayISO } from '@/lib/date'
import type { FormState } from '@/lib/form-state'
import {
  createJob,
  createWin,
  deleteJob,
  deleteWin,
  updateJob,
  type JobInput,
  type SalaryPeriod,
  type WinInput,
} from '@/lib/queries/career'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function readJob(
  formData: FormData
): { ok: true; value: JobInput } | { ok: false; error: string } {
  const employer = String(formData.get('employer') ?? '').trim()
  const title = String(formData.get('title') ?? '').trim()

  if (!employer) return { ok: false, error: 'Enter the employer name.' }
  if (!title) return { ok: false, error: 'Enter your job title.' }
  if (employer.length > 120 || title.length > 120) {
    return { ok: false, error: 'Employer and title must be under 120 characters.' }
  }

  const startedOn = String(formData.get('started_on') ?? '').trim()
  if (!ISO_DATE.test(startedOn)) return { ok: false, error: 'Pick a start date.' }

  const rawEnd = String(formData.get('ended_on') ?? '').trim()
  const endedOn = rawEnd === '' ? null : rawEnd
  if (endedOn !== null && !ISO_DATE.test(endedOn)) {
    return { ok: false, error: 'End date is not valid.' }
  }
  if (endedOn !== null && endedOn < startedOn) {
    return { ok: false, error: 'End date cannot be before the start date.' }
  }

  // Blank salary means "not recorded", which is different from zero.
  const rawSalary = String(formData.get('salary') ?? '').trim()
  let salaryCents: number | null = null
  if (rawSalary !== '') {
    const parsed = parseMoney(rawSalary)
    if (!parsed.ok) return { ok: false, error: `Salary: ${parsed.error}` }
    salaryCents = parsed.cents
  }

  const period = String(formData.get('salary_period') ?? 'monthly') as SalaryPeriod
  if (period !== 'monthly' && period !== 'annual') {
    return { ok: false, error: 'Pick monthly or annual.' }
  }

  const note = String(formData.get('note') ?? '').trim()
  if (note.length > 1000) {
    return { ok: false, error: 'Note is too long (max 1000 characters).' }
  }

  return {
    ok: true,
    value: {
      employer,
      title,
      started_on: startedOn,
      ended_on: endedOn,
      salary_cents: salaryCents,
      salary_currency: 'SGD',
      salary_period: period,
      note: note === '' ? null : note,
    },
  }
}

export async function saveJob(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = readJob(formData)
  if (!parsed.ok) return { error: parsed.error, ok: false }

  const id = String(formData.get('id') ?? '').trim()

  try {
    if (id) await updateJob(id, parsed.value)
    else await createJob(parsed.value)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Something went wrong.',
      ok: false,
    }
  }

  revalidatePath('/career')
  return { error: null, ok: true }
}

export async function removeJob(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'Missing job.', ok: false }

  try {
    await deleteJob(id)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not delete.',
      ok: false,
    }
  }

  revalidatePath('/career')
  return { error: null, ok: true }
}

export async function saveWin(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const title = String(formData.get('title') ?? '').trim()
  if (!title) return { error: 'What did you ship?', ok: false }
  if (title.length > 200) {
    return { error: 'Keep the title under 200 characters.', ok: false }
  }

  const occurredOn = String(formData.get('occurred_on') ?? '').trim()
  if (!ISO_DATE.test(occurredOn)) return { error: 'Pick a date.', ok: false }
  if (occurredOn > todayISO()) {
    return { error: 'That date is in the future.', ok: false }
  }

  const rawJob = String(formData.get('job_id') ?? '').trim()
  const detail = String(formData.get('detail') ?? '').trim()

  if (detail.length > 2000) {
    return { error: 'Detail is too long (max 2000 characters).', ok: false }
  }

  const input: WinInput = {
    job_id: rawJob === '' || rawJob === 'none' ? null : rawJob,
    occurred_on: occurredOn,
    title,
    detail: detail === '' ? null : detail,
  }

  try {
    await createWin(input)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not save.',
      ok: false,
    }
  }

  revalidatePath('/career')
  return { error: null, ok: true }
}

export async function removeWin(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'Missing entry.', ok: false }

  try {
    await deleteWin(id)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not delete.',
      ok: false,
    }
  }

  revalidatePath('/career')
  return { error: null, ok: true }
}
