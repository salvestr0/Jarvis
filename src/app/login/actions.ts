'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { isAllowedEmail } from '@/lib/supabase/env'

export type LoginState = { error: string | null }

export async function signIn(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!email || !password) {
    return { error: 'Enter both your email and password.' }
  }

  // Reject non-allowlisted emails before we even talk to Supabase.
  // Deliberately returns the same generic message as a wrong password, so
  // this page can't be used to discover which email is the real one.
  if (!isAllowedEmail(email)) {
    return { error: 'Incorrect email or password.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: 'Incorrect email or password.' }
  }

  revalidatePath('/', 'layout')
  redirect('/')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
