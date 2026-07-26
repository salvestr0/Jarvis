'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

export function NavLinks({
  items,
}: {
  items: ReadonlyArray<{ href: string; label: string }>
}) {
  const pathname = usePathname()

  return (
    <nav className="-mx-1 flex items-center gap-1 overflow-x-auto">
      {items.map((item) => {
        const active =
          item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href)

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors',
              active
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
