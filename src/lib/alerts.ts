/**
 * Price-alert logic — pure, node --test covered (tasks/price-alerts-design.md).
 *
 * USD prices travel as MICROS (price × 1,000,000) integers, matching
 * src/lib/prices.ts, so a sub-cent memecoin target doesn't round to zero.
 * MICROS is redefined here rather than imported because prices.ts is
 * server-only and this module must load under plain node for tests.
 */

const MICROS = 1_000_000

export type AlertDirection = 'above' | 'below'

export type ParsedUsd = { ok: true; micros: number } | { ok: false; error: string }

/**
 * "$120,000", "0.35", "1.5" → micros. String math for the fraction so six
 * decimal places survive without float drift. Cap keeps a fat-fingered
 * "12000000000" from becoming a forever-pending absurdity.
 */
export function parseUsdToMicros(text: string): ParsedUsd {
  const cleaned = text.replace(/[$,\s]/g, '')
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(cleaned)
  if (!m) {
    return {
      ok: false,
      error: 'target_price must be a plain USD amount like "120000" or "0.35" (max 6 decimals).',
    }
  }
  const whole = Number(m[1])
  const frac = Number((m[2] ?? '').padEnd(6, '0') || '0')
  const micros = whole * MICROS + frac
  if (micros <= 0) return { ok: false, error: 'target_price must be more than zero.' }
  if (whole > 100_000_000) {
    return { ok: false, error: 'target_price is implausibly large (over $100M).' }
  }
  return { ok: true, micros }
}

/** Whole dollars stay clean ($120,000); cents show as cents; sub-dollar keeps its precision. */
export function formatUsdMicros(micros: number): string {
  const dollars = micros / MICROS
  if (micros % MICROS === 0) return `$${dollars.toLocaleString('en-US')}`
  if (dollars >= 1) {
    return `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  // Sub-dollar: up to 6 decimals, trailing zeros trimmed ("$0.35", "$0.000021").
  return `$${dollars.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`
}

/** The crossing predicate: >= for above, <= for below. */
export function alertCrossed(
  direction: AlertDirection,
  targetMicros: number,
  priceMicros: number
): boolean {
  return direction === 'above' ? priceMicros >= targetMicros : priceMicros <= targetMicros
}

/** The Telegram message a fired alert sends. Plain text, self-explaining. */
export function alertMessage(
  symbol: string,
  direction: AlertDirection,
  targetMicros: number,
  priceMicros: number
): string {
  const arrow = direction === 'above' ? '📈' : '📉'
  return [
    `${arrow} ${symbol} is at ${formatUsdMicros(priceMicros)} — crossed ${direction} your ${formatUsdMicros(targetMicros)} alert.`,
    'This alert is done; ask me for a new one if you want to keep watching.',
  ].join('\n')
}
