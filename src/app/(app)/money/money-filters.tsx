'use client'

import { useRef } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/field'
import { hasActiveFilter, type MoneyFilter } from '@/lib/filters'
import type { Account, Category } from '@/lib/types'

/**
 * Filter bar for the Money page.
 *
 * All state lives in the URL, none in React: each change navigates to the
 * same page with different search params and the server re-renders every
 * section from the filtered rows. That's what keeps the summary cards, the
 * breakdown, the table and the recurring list telling the same story — and
 * makes a filtered view shareable and refresh-proof.
 *
 * Current values arrive as props from the server rather than via
 * useSearchParams, so this component has exactly one source of truth.
 */
export function MoneyFilters({
  month,
  filter,
  categories,
  accounts,
}: {
  month: string
  filter: MoneyFilter
  categories: Category[]
  accounts: Account[]
}) {
  const router = useRouter()
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The search input is uncontrolled (controlled + router navigation would
  // fight the cursor), so Clear has to empty it by hand through this ref.
  const searchRef = useRef<HTMLInputElement>(null)

  function urlWith(next: Partial<Record<'type' | 'category' | 'account' | 'q', string>>) {
    const merged = {
      type: filter.type ?? '',
      category: filter.categoryId ?? '',
      account: filter.accountId ?? '',
      q: filter.q ?? '',
      ...next,
    }

    const params = new URLSearchParams({ month })
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value)
    }
    return `/money?${params.toString()}`
  }

  function apply(next: Partial<Record<'type' | 'category' | 'account' | 'q', string>>) {
    router.replace(urlWith(next), { scroll: false })
  }

  const incomeCategories = categories.filter((c) => c.direction === 'income')
  const expenseCategories = categories.filter((c) => c.direction === 'expense')

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        ref={searchRef}
        aria-label="Search transactions"
        placeholder="Search…"
        className="h-8 w-36"
        defaultValue={filter.q ?? ''}
        onChange={(e) => {
          // Debounced: navigate once you pause typing, not on every keystroke.
          const value = e.target.value.trim()
          if (searchTimer.current) clearTimeout(searchTimer.current)
          searchTimer.current = setTimeout(() => apply({ q: value }), 300)
        }}
      />

      <NativeSelect
        aria-label="Filter by type"
        className="h-8 w-auto"
        value={filter.type ?? 'all'}
        onChange={(e) => {
          const value = e.target.value
          // A category from the wrong direction can't match anything, so
          // switching type also clears the category filter.
          apply({ type: value === 'all' ? '' : value, category: '' })
        }}
      >
        <option value="all">In + out</option>
        <option value="income">Income</option>
        <option value="expense">Expenses</option>
      </NativeSelect>

      <NativeSelect
        aria-label="Filter by category"
        className="h-8 w-auto max-w-40"
        value={filter.categoryId ?? 'all'}
        onChange={(e) => {
          const value = e.target.value
          apply({ category: value === 'all' ? '' : value })
        }}
      >
        <option value="all">All categories</option>
        <option value="uncategorised">Uncategorised</option>
        {filter.type !== 'income' ? (
          <optgroup label="Expenses">
            {expenseCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {filter.type !== 'expense' ? (
          <optgroup label="Income">
            {incomeCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </NativeSelect>

      <NativeSelect
        aria-label="Filter by account"
        className="h-8 w-auto max-w-32"
        value={filter.accountId ?? 'all'}
        onChange={(e) => {
          const value = e.target.value
          apply({ account: value === 'all' ? '' : value })
        }}
      >
        <option value="all">All accounts</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </NativeSelect>

      {hasActiveFilter(filter) ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-muted-foreground"
          onClick={() => {
            if (searchTimer.current) clearTimeout(searchTimer.current)
            if (searchRef.current) searchRef.current.value = ''
            router.replace(`/money?month=${month}`, { scroll: false })
          }}
        >
          Clear
        </Button>
      ) : null}
    </div>
  )
}
