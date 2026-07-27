export type Direction = 'income' | 'expense'

export type AccountKind =
  | 'cash'
  | 'bank'
  | 'brokerage'
  | 'crypto_wallet'
  | 'other'

export type Account = {
  id: string
  name: string
  kind: AccountKind
  currency: string
  archived: boolean
  opening_balance_cents: number
}

export type Category = {
  id: string
  name: string
  direction: Direction
}

export type Transaction = {
  id: string
  occurred_on: string // 'YYYY-MM-DD'
  direction: Direction
  amount_cents: number
  currency: string
  category_id: string | null
  account_id: string | null
  note: string | null
}

/** A transaction joined with the names of its category and account. */
export type TransactionRow = Transaction & {
  category_name: string | null
  account_name: string | null
}

export type Cadence = 'weekly' | 'monthly' | 'yearly'

export type Recurring = {
  id: string
  name: string
  direction: Direction
  amount_cents: number
  currency: string
  cadence: Cadence
  next_due: string | null // 'YYYY-MM-DD'
  category_id: string | null
  active: boolean
}

/** A recurring item joined with the name of its category. */
export type RecurringRow = Recurring & {
  category_name: string | null
}

export type MonthSummary = {
  incomeCents: number
  expenseCents: number
  netCents: number
  count: number
}

export type CategoryTotal = {
  categoryId: string | null
  name: string
  direction: Direction
  totalCents: number
}
