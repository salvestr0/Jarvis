import type { Metadata } from 'next'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

import { LoginForm } from './login-form'

export const metadata: Metadata = {
  title: 'Sign in — Jarvis',
}

// searchParams is async in Next.js 16 — synchronous access was removed.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  const initialError =
    error === 'not_authorized'
      ? 'That account is not authorised to use this app.'
      : undefined

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Jarvis</CardTitle>
          <CardDescription>Private. One account only.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm initialError={initialError} />
        </CardContent>
      </Card>
    </main>
  )
}
