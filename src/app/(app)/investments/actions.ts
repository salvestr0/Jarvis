'use server'

import { revalidatePath } from 'next/cache'

import { parseMoney } from '@/lib/money'
import { parseQuantity } from '@/lib/quantity'
import {
  createHolding,
  deleteHolding,
  refreshPrices,
  updateHolding,
  type HoldingInput,
  type HoldingKind,
} from '@/lib/queries/investments'

import type { FormState } from './form-state'

const SYMBOL_PATTERN = /^[A-Za-z0-9.\-^]{1,20}$/

function readForm(
  formData: FormData
): { ok: true; value: HoldingInput } | { ok: false; error: string } {
  const kind = String(formData.get('kind') ?? '') as HoldingKind
  if (kind !== 'crypto' && kind !== 'stock' && kind !== 'manual') {
    return { ok: false, error: 'Pick crypto, stock or investment plan.' }
  }

  const name = String(formData.get('name') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim()

  if (note.length > 280) {
    return { ok: false, error: 'Note is too long (max 280 characters).' }
  }

  // Cost basis may legitimately be zero (airdrops, gifts), so an empty box
  // means zero rather than an error.
  const rawCost = String(formData.get('cost_basis') ?? '').trim()
  let costCents = 0
  if (rawCost !== '') {
    const cost = parseMoney(rawCost)
    if (!cost.ok) return { ok: false, error: `Cost basis: ${cost.error}` }
    costCents = cost.cents
  }

  // Manual holdings (investment plans etc.) have no ticker, quantity or price
  // feed — a name and a self-reported current value stand in for all three.
  if (kind === 'manual') {
    if (!name) return { ok: false, error: 'Give the plan a name.' }
    if (name.length > 80) {
      return { ok: false, error: 'Name is too long (max 80 characters).' }
    }

    // Empty value is allowed and shows as "not priced" — better than forcing
    // a guess before the first statement arrives.
    const rawValue = String(formData.get('manual_value') ?? '').trim()
    let manualValueCents: number | null = null
    if (rawValue !== '') {
      const value = parseMoney(rawValue)
      if (!value.ok) return { ok: false, error: `Current value: ${value.error}` }
      manualValueCents = value.cents
    }

    // The schema still needs a unique symbol per holding; derive a stable
    // slug from the name so the user never has to invent a fake ticker.
    const symbol =
      name
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .slice(0, 20)
        .replace(/^-+|-+$/g, '') || 'PLAN'

    return {
      ok: true,
      value: {
        kind,
        symbol,
        name,
        quantity: 1,
        cost_basis_cents: costCents,
        cost_currency: 'SGD',
        price_currency: 'SGD',
        note: note === '' ? null : note,
        manual_value_cents: manualValueCents,
      },
    }
  }

  const symbol = String(formData.get('symbol') ?? '')
    .trim()
    .toUpperCase()

  if (!SYMBOL_PATTERN.test(symbol)) {
    return {
      ok: false,
      error: 'Enter a ticker like BTC, AAPL or D05.SI (letters, numbers, dots).',
    }
  }

  const quantity = parseQuantity(String(formData.get('quantity') ?? ''))
  if (!quantity.ok) return { ok: false, error: quantity.error }

  const priceCurrency = String(formData.get('price_currency') ?? 'USD')
    .trim()
    .toUpperCase()
  if (!/^[A-Z]{3}$/.test(priceCurrency)) {
    return { ok: false, error: 'Price currency must be a 3-letter code.' }
  }

  return {
    ok: true,
    value: {
      kind,
      symbol,
      name: name === '' ? null : name,
      quantity: quantity.value,
      cost_basis_cents: costCents,
      cost_currency: 'SGD',
      price_currency: priceCurrency,
      note: note === '' ? null : note,
      manual_value_cents: null,
    },
  }
}

export async function saveHolding(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = readForm(formData)
  if (!parsed.ok) return { error: parsed.error, ok: false }

  const id = String(formData.get('id') ?? '').trim()

  try {
    if (id) await updateHolding(id, parsed.value)
    else await createHolding(parsed.value)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Something went wrong.',
      ok: false,
    }
  }

  revalidatePath('/investments')
  revalidatePath('/')
  return { error: null, ok: true }
}

export async function removeHolding(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { error: 'Missing holding.', ok: false }

  try {
    await deleteHolding(id)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not delete.',
      ok: false,
    }
  }

  revalidatePath('/investments')
  revalidatePath('/')
  return { error: null, ok: true }
}

export async function refreshPricesAction(
  _prev: FormState,
  _formData: FormData
): Promise<FormState> {
  try {
    const report = await refreshPrices()

    const parts: string[] = []
    if (report.updated > 0) {
      parts.push(`Updated ${report.updated} price${report.updated === 1 ? '' : 's'}`)
    } else {
      parts.push('No prices updated')
    }
    if (report.fxAsOf) parts.push(`FX as of ${report.fxAsOf}`)

    // Partial failure is reported, not hidden. Silently showing a stale
    // number as if it were current is the worst possible outcome here.
    if (report.failures.length > 0) {
      const detail = report.failures
        .map((f) => `${f.symbol}: ${f.reason}`)
        .join('; ')
      return {
        error: `Some prices failed — ${detail}`,
        ok: true,
        message: parts.join(' · '),
      }
    }

    if (report.fxError) {
      return { error: `FX: ${report.fxError}`, ok: true, message: parts.join(' · ') }
    }

    revalidatePath('/investments')
    revalidatePath('/')
    return { error: null, ok: true, message: parts.join(' · ') }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Refresh failed.',
      ok: false,
    }
  }
}
