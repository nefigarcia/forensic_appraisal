/**
 * Decimal-safe money math.
 *
 * Backed by `Prisma.Decimal` (which is `decimal.js` under the hood, so it
 * uses arbitrary-precision base-10 arithmetic — none of the classic
 * `0.1 + 0.2 = 0.30000000000000004` behavior).
 *
 * Precisions used across the app:
 *
 *   Money             Decimal(19, 4)    up to 15 integer digits + 4 fractional
 *   Rate / percentage Decimal(9,  6)    up to  3 integer digits + 6 fractional
 *   Multiple / weight Decimal(9,  6)    same as rate
 *
 * These are the DDL precisions; the in-memory Decimal type carries far
 * more (decimal.js defaults to 20 significant digits, configurable).
 *
 * ─── Naming ────────────────────────────────────────────────────────────
 * Functions come in two flavors:
 *   - `moneyAdd`, `moneySub`, `moneyMul`, `moneyDiv`, `moneySum` — clear
 *     names that grep well.
 *   - Aliases `add`, `sub`, `mul`, `div`, `sum` are exported for callers
 *     that use `import { add as addMoney }` etc.
 *
 * ─── Server vs client boundary ─────────────────────────────────────────
 * A Prisma.Decimal object doesn't round-trip cleanly through Next.js
 * server-action serialization. If a value must reach the client, pass it
 * through `serializeMoney()` (returns a string). The client parses back
 * with `parseMoney()` if it needs to do further math.
 *
 * The larger convention in the codebase: **UI reads Float columns**
 * (populated by the dual-write server actions) for display; the Decimal
 * shadow columns are the authoritative server-side truth for arithmetic.
 * Do not do money math client-side unless the value comes from
 * `serializeMoney()`.
 */

import { Prisma } from '@prisma/client'

export type Money = Prisma.Decimal
/** Constructor alias — `new Money("1.23")` reads well at call sites. */
// eslint-disable-next-line @typescript-eslint/no-redeclare
export const Money = Prisma.Decimal

export type MoneyInput = number | string | Prisma.Decimal | null | undefined

export const MONEY_SCALE = 4          // storage scale for money columns
export const RATE_SCALE  = 6          // storage scale for rate / percent / multiple

// ─────────────────────────────────────────────────
// Construction
// ─────────────────────────────────────────────────

/**
 * Coerce anything reasonable to a Decimal. Nullish becomes 0. This is the
 * one-and-only entry point — never call `new Prisma.Decimal(x)` directly
 * from application code, use `money(x)`.
 */
export function money(input: MoneyInput): Money {
  if (input === null || input === undefined) return new Money(0)
  if (input instanceof Money) return input
  // Guard against `NaN` and `Infinity`, which decimal.js will happily
  // accept and then propagate through every subsequent op.
  if (typeof input === 'number' && !Number.isFinite(input)) {
    throw new RangeError(`money(): non-finite input ${input}`)
  }
  return new Money(input)
}

export const ZERO_MONEY = new Money(0)
export const ONE_MONEY  = new Money(1)

// ─────────────────────────────────────────────────
// Arithmetic
// ─────────────────────────────────────────────────

export function moneyAdd(a: MoneyInput, b: MoneyInput): Money {
  return money(a).plus(money(b))
}

export function moneySub(a: MoneyInput, b: MoneyInput): Money {
  return money(a).minus(money(b))
}

export function moneyMul(a: MoneyInput, b: MoneyInput): Money {
  return money(a).times(money(b))
}

/**
 * Divide `a / b`. Throws on `b == 0` (financial math must not silently
 * produce Infinity/NaN — the caller should decide what a zero-denominator
 * means in their domain).
 */
export function moneyDiv(a: MoneyInput, b: MoneyInput): Money {
  const denom = money(b)
  if (denom.isZero()) throw new RangeError('moneyDiv: division by zero')
  return money(a).div(denom)
}

/** Safe divide — returns `fallback` (default 0) instead of throwing on b==0. */
export function moneyDivSafe(a: MoneyInput, b: MoneyInput, fallback: MoneyInput = 0): Money {
  const denom = money(b)
  return denom.isZero() ? money(fallback) : money(a).div(denom)
}

/** Sum any iterable of MoneyInput. Empty iterable returns 0. */
export function moneySum(values: Iterable<MoneyInput>): Money {
  let acc = new Money(0)
  for (const v of values) acc = acc.plus(money(v))
  return acc
}

// Convenience aliases (allow `import { add } from '@/lib/money'`)
export { moneyAdd as add, moneySub as sub, moneyMul as mul, moneyDiv as div, moneySum as sum }

// ─────────────────────────────────────────────────
// Percent / rate helpers
// ─────────────────────────────────────────────────

/**
 * Apply a rate expressed as a decimal fraction (0.15 → 15 %).
 *   applyRate(1000, 0.15) → 150
 */
export function applyRate(base: MoneyInput, rate: MoneyInput): Money {
  return moneyMul(base, rate)
}

/**
 * Apply a percentage expressed as a whole number (15 → 15 %).
 *   applyPercent(1000, 15) → 150
 */
export function applyPercent(base: MoneyInput, percent: MoneyInput): Money {
  return moneyDivSafe(moneyMul(base, percent), 100)
}

// ─────────────────────────────────────────────────
// Rounding + display formatting
// ─────────────────────────────────────────────────

/** Half-away-from-zero rounding to N decimal places. Used for storage. */
export function roundForStorage(v: MoneyInput, places: number = MONEY_SCALE): Money {
  // decimal.js ROUND_HALF_UP = 4 (constant differs slightly across
  // decimal.js versions — using the numeric value is stable).
  return money(v).toDecimalPlaces(places, Money.ROUND_HALF_UP ?? 4)
}

export interface FormatOptions {
  currency?: string     // ISO code, default USD
  places?:   number     // default 2
  locale?:   string     // default 'en-US'
  compact?:  boolean    // e.g. "$1.2M"
}

/**
 * Storage precision is separate from display formatting — the underlying
 * Decimal never loses precision, but `formatMoney` renders it for humans.
 */
export function formatMoney(v: MoneyInput, opts: FormatOptions = {}): string {
  const { currency = 'USD', places = 2, locale = 'en-US', compact = false } = opts
  const dec = money(v)
  const num = Number(dec.toFixed(Math.max(places, 4))) // 4 places preserved through the Number bounce
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: places,
    maximumFractionDigits: places,
    notation: compact ? 'compact' : 'standard',
  }).format(num)
}

/** Format a rate/percent expressed as a decimal fraction (0.15 → "15.00%"). */
export function formatRate(v: MoneyInput, places = 2): string {
  const dec = money(v).times(100)
  return `${dec.toFixed(places)}%`
}

// ─────────────────────────────────────────────────
// Server ↔ client serialization
// ─────────────────────────────────────────────────

/**
 * Convert a Decimal to a string for transmission across the server-action
 * boundary. `null`/`undefined` pass through as-is.
 */
export function serializeMoney(v: Money | null | undefined): string | null {
  if (v === null || v === undefined) return null
  return money(v).toFixed()
}

/** Parse a serialized money string on the client side. */
export function parseMoney(s: string | null | undefined): Money | null {
  if (s === null || s === undefined || s === '') return null
  return money(s)
}

// ─────────────────────────────────────────────────
// Row-level readers (dual-column migration helpers)
// ─────────────────────────────────────────────────

/**
 * Read a money column from a Prisma row that may have both a legacy Float
 * column and a Slice-4 Decimal shadow. Prefers the Decimal (authoritative)
 * and falls back to the Float only if the Decimal is null.
 *
 * The shadow column name is expected to be `<field>Decimal`.
 */
export function readMoney<
  R extends Record<string, unknown>,
  K extends keyof R & string,
>(row: R | null | undefined, field: K): Money | null {
  if (!row) return null
  const decimalField = `${field}Decimal` as keyof R
  const dv = row[decimalField]
  if (dv !== null && dv !== undefined) return money(dv as MoneyInput)
  const fv = row[field]
  if (fv === null || fv === undefined) return null
  return money(fv as MoneyInput)
}
