import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { signOut } from '@/app/login/actions'

import { NavLinks } from './nav-links'

export const NAV_ITEMS = [
  { href: '/', label: 'Dashboard' },
  { href: '/money', label: 'Money' },
  { href: '/investments', label: 'Investments' },
  { href: '/career', label: 'Career' },
  { href: '/projects', label: 'Projects' },
  { href: '/settings', label: 'Settings' },
] as const

export function AppShell({
  children,
  email,
}: {
  children: React.ReactNode
  email: string | null
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3">
          <Link href="/" className="font-semibold tracking-tight">
            Jarvis
          </Link>

          <NavLinks items={NAV_ITEMS} />

          <div className="ml-auto flex items-center gap-3">
            {email ? (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {email}
              </span>
            ) : null}
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  )
}
