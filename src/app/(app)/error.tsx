'use client'

import { useEffect } from 'react'

import { Button } from '@/components/ui/button'

/**
 * Catches any error thrown while rendering a signed-in page.
 *
 * Without this, a failed database call shows Next's raw error screen — which
 * in production says nothing useful at all. This at least tells you what
 * broke and gives you a way back.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  // The most likely cause early on: the SQL migration hasn't been run yet.
  const looksLikeMissingTable =
    /relation .* does not exist|schema cache|does not exist/i.test(error.message)

  return (
    <div className="rounded-lg border border-dashed p-10 text-center">
      <h2 className="text-base font-medium">Something went wrong</h2>

      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        {looksLikeMissingTable
          ? 'It looks like the database tables have not been created yet. Run the SQL in supabase/migrations/ in your Supabase SQL editor, then reload.'
          : error.message}
      </p>

      <Button className="mt-4" variant="outline" onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
