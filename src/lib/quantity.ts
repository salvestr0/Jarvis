/**
 * Parsing for holding quantities.
 *
 * Separate from money.ts because the rules genuinely differ: money is always
 * exactly 2 decimal places, while a crypto quantity can be 0.00042315 BTC.
 * The database column is numeric(30,10), so 10 decimal places is the limit.
 */

export const MAX_QUANTITY_DECIMALS = 10

export type ParseQuantityResult =
  | { ok: true; value: number; text: string }
  | { ok: false; error: string }

export function parseQuantity(input: string): ParseQuantityResult {
  const raw = String(input ?? '').trim()
  if (!raw) return { ok: false, error: 'Enter a quantity.' }

  const cleaned = raw.replace(/[\s,]/g, '')

  if (cleaned.startsWith('-')) {
    return { ok: false, error: 'Quantity must be positive.' }
  }

  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '.' || cleaned === '') {
    return { ok: false, error: 'That is not a valid number.' }
  }

  const [, fraction = ''] = cleaned.split('.')
  if (fraction.length > MAX_QUANTITY_DECIMALS) {
    return {
      ok: false,
      error: `At most ${MAX_QUANTITY_DECIMALS} decimal places.`,
    }
  }

  const value = Number(cleaned)

  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: 'Quantity must be more than zero.' }
  }

  if (value > 1e15) {
    return { ok: false, error: 'That quantity is too large.' }
  }

  // Keep the original text: it is what gets sent to Postgres, so a value like
  // 0.1 is stored as the exact decimal 0.1 rather than the nearest float.
  return { ok: true, value, text: cleaned }
}

/** Trim trailing zeros for display: "0.5000000000" -> "0.5" */
export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const fixed = value.toFixed(MAX_QUANTITY_DECIMALS)
  return fixed.replace(/\.?0+$/, '') || '0'
}
