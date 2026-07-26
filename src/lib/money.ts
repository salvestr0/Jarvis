/**
 * Money helpers.
 *
 * Rule: amounts are whole numbers of cents everywhere in this app —
 * in the database, in props, in state. They become a decimal string only at
 * the moment they're shown on screen.
 *
 * Why: floating point can't hold money exactly. In JavaScript,
 * 0.1 + 0.2 === 0.30000000000000004, and 19.99 * 100 === 1998.9999999999998.
 * Those errors compound across a year of transactions until your totals are
 * quietly wrong. Integers can't drift.
 */

export const BASE_CURRENCY = 'SGD'

/**
 * Currency symbols, written out explicitly.
 *
 * Why not let Intl pick: in the en-SG locale, Intl formats SGD as a bare "$"
 * — because locally that's unambiguous. It isn't unambiguous here. Once
 * Phase 2 adds US stocks, a screen showing "$120.00" next to "$1,234.56"
 * where one is USD and one is SGD is a genuinely misleading way to display
 * your net worth.
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  SGD: 'S$',
  USD: 'US$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
}

function symbolFor(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency.toUpperCase()} `
}

/** Format cents for display: 123456 -> "S$1,234.56" */
export function formatMoney(
  cents: number,
  currency: string = BASE_CURRENCY
): string {
  const negative = cents < 0
  const amount = formatAmount(Math.abs(cents))
  return `${negative ? '-' : ''}${symbolFor(currency)}${amount}`
}

/** Format cents without the currency symbol: 123456 -> "1,234.56" */
export function formatAmount(cents: number): string {
  return new Intl.NumberFormat('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

/** Signed display for a transaction row: expense -> "-S$12.34" */
export function formatSigned(
  cents: number,
  direction: 'income' | 'expense',
  currency: string = BASE_CURRENCY
): string {
  const sign = direction === 'expense' ? '-' : '+'
  return `${sign}${formatMoney(cents, currency)}`
}

export type ParseMoneyResult =
  | { ok: true; cents: number }
  | { ok: false; error: string }

/**
 * Turn typed input into cents, without ever creating a float.
 *
 * Accepts "12", "12.3", "12.34", "1,234.56", "$12.34", " 12.34 ".
 * Rejects negatives (direction is a separate field), zero, more than two
 * decimal places, and anything non-numeric.
 */
export function parseMoney(input: string): ParseMoneyResult {
  const raw = String(input ?? '').trim()

  if (!raw) return { ok: false, error: 'Enter an amount.' }

  // Strip currency symbols, spaces and thousands separators.
  const cleaned = raw.replace(/[$\s,]/g, '').replace(/^S\$?/i, '')

  if (cleaned.startsWith('-')) {
    return {
      ok: false,
      error: 'Enter a positive amount — use Income/Expense to set the direction.',
    }
  }

  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '.' || cleaned === '') {
    return { ok: false, error: 'That is not a valid number.' }
  }

  const [whole, fraction = ''] = cleaned.split('.')

  if (fraction.length > 2) {
    return { ok: false, error: 'Amounts can have at most 2 decimal places.' }
  }

  // String maths only — no parseFloat, so no rounding error is possible.
  const wholePart = whole === '' ? 0 : Number(whole)
  const fractionPart = Number(fraction.padEnd(2, '0'))

  if (!Number.isSafeInteger(wholePart) || wholePart > 9_999_999_999) {
    return { ok: false, error: 'That amount is too large.' }
  }

  const cents = wholePart * 100 + fractionPart

  if (cents <= 0) return { ok: false, error: 'Amount must be more than zero.' }

  return { ok: true, cents }
}

/**
 * What a recurring amount costs per month: yearly insurance of S$1,200
 * reads as S$100/mo. This is what stops annual bills understating your real
 * monthly burn for eleven months and spiking it in the twelfth.
 */
export function monthlyEquivalentCents(
  cents: number,
  cadence: 'weekly' | 'monthly' | 'yearly'
): number {
  if (cadence === 'monthly') return cents
  if (cadence === 'yearly') return Math.round(cents / 12)
  return Math.round((cents * 52) / 12)
}

/**
 * Format a market price stored in micros (price x 1,000,000).
 *
 * Prices need variable precision in a way that account balances don't:
 * BTC at 64,699 should read "US$64,699.00", but a memecoin at 0.0000004
 * must not round to "US$0.00". Small values therefore get more decimals.
 */
export function formatPriceMicros(
  micros: number,
  currency: string = 'USD'
): string {
  const value = micros / 1_000_000

  const decimals = value >= 1 ? 2 : value >= 0.01 ? 4 : 8

  const formatted = new Intl.NumberFormat('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  }).format(value)

  return `${symbolFor(currency)}${formatted}`
}

/** Cents -> plain editable string for a form field: 1234 -> "12.34" */
export function centsToInput(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
