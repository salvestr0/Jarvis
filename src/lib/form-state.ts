/**
 * Shared state shape for every form in the app.
 *
 * Lives here rather than beside the actions because a file marked
 * `'use server'` may only export async functions — a plain constant there is
 * a build error. See tasks/lessons.md.
 */

export type FormState = {
  error: string | null
  ok: boolean
  /** Optional success detail, e.g. "Updated 3 prices · FX as of 2026-07-24". */
  message?: string
}

export const emptyFormState: FormState = { error: null, ok: false }
