import { AppShell } from '@/components/app-shell'
import { requireUser } from '@/lib/auth'

/**
 * Layout for every signed-in page.
 *
 * The (app) folder is a "route group" — the brackets mean it does NOT appear
 * in the URL. It exists purely so every page inside shares this auth check
 * and this navigation bar, without having to repeat either.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireUser()

  return <AppShell email={user.email ?? null}>{children}</AppShell>
}
