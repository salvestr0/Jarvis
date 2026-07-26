'use server'

import { revalidatePath } from 'next/cache'

import { parseMoney } from '@/lib/money'
import { todayISO } from '@/lib/date'
import type { FormState } from '@/lib/form-state'
import {
  createProject,
  deleteProject,
  recordMetric,
  updateProject,
  type ProjectInput,
  type ProjectKind,
  type ProjectStatus,
} from '@/lib/queries/projects'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const STATUSES: ProjectStatus[] = [
  'idea',
  'building',
  'beta',
  'launched',
  'paused',
  'archived',
]
const KINDS: ProjectKind[] = ['product', 'content', 'business']

function readProject(
  formData: FormData
): { ok: true; value: ProjectInput } | { ok: false; error: string } {
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { ok: false, error: 'Give the project a name.' }
  if (name.length > 80) {
    return { ok: false, error: 'Name must be under 80 characters.' }
  }

  const status = String(formData.get('status') ?? '') as ProjectStatus
  if (!STATUSES.includes(status)) return { ok: false, error: 'Pick a status.' }

  const kind = String(formData.get('kind') ?? '') as ProjectKind
  if (!KINDS.includes(kind)) return { ok: false, error: 'Pick a type.' }

  const rawTarget = String(formData.get('mrr_target') ?? '').trim()
  let targetCents = 0
  if (rawTarget !== '') {
    const parsed = parseMoney(rawTarget)
    if (!parsed.ok) return { ok: false, error: `MRR target: ${parsed.error}` }
    targetCents = parsed.cents
  }

  const rawLaunch = String(formData.get('launch_date') ?? '').trim()
  const launchDate = rawLaunch === '' ? null : rawLaunch
  if (launchDate !== null && !ISO_DATE.test(launchDate)) {
    return { ok: false, error: 'Launch date is not valid.' }
  }

  const url = String(formData.get('url') ?? '').trim()
  if (url !== '' && !/^https?:\/\/\S+$/i.test(url)) {
    return { ok: false, error: 'URL must start with http:// or https://' }
  }

  const note = String(formData.get('note') ?? '').trim()
  if (note.length > 1000) {
    return { ok: false, error: 'Note is too long (max 1000 characters).' }
  }

  return {
    ok: true,
    value: {
      name,
      status,
      kind,
      launch_date: launchDate,
      mrr_target_cents: targetCents,
      url: url === '' ? null : url,
      note: note === '' ? null : note,
    },
  }
}

export async function saveProject(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = readProject(formData)
  if (!parsed.ok) return { error: parsed.error, ok: false }

  const id = String(formData.get('id') ?? '').trim()

  try {
    if (id) await updateProject(id, parsed.value)
    else await createProject(parsed.value)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Something went wrong.',
      ok: false,
    }
  }

  revalidatePath('/projects')
  return { error: null, ok: true }
}

export async function removeProject(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'Missing project.', ok: false }

  try {
    await deleteProject(id)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not delete.',
      ok: false,
    }
  }

  revalidatePath('/projects')
  return { error: null, ok: true }
}

export async function logMetric(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const projectId = String(formData.get('project_id') ?? '').trim()
  if (!projectId) return { error: 'Missing project.', ok: false }

  const asOf = String(formData.get('as_of') ?? '').trim()
  if (!ISO_DATE.test(asOf)) return { error: 'Pick a date.', ok: false }
  if (asOf > todayISO()) return { error: 'That date is in the future.', ok: false }

  // Zero MRR is a real, meaningful number — it is not an empty field.
  const rawMrr = String(formData.get('mrr') ?? '').trim()
  let mrrCents = 0
  if (rawMrr !== '' && rawMrr !== '0') {
    const parsed = parseMoney(rawMrr)
    if (!parsed.ok) return { error: `MRR: ${parsed.error}`, ok: false }
    mrrCents = parsed.cents
  }

  const rawUsers = String(formData.get('users_count') ?? '').trim()
  let usersCount: number | null = null
  if (rawUsers !== '') {
    const n = Number(rawUsers)
    if (!Number.isInteger(n) || n < 0) {
      return { error: 'User count must be a whole number.', ok: false }
    }
    usersCount = n
  }

  try {
    await recordMetric({
      project_id: projectId,
      as_of: asOf,
      mrr_cents: mrrCents,
      users_count: usersCount,
    })
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not save.',
      ok: false,
    }
  }

  revalidatePath('/projects')
  return { error: null, ok: true }
}
