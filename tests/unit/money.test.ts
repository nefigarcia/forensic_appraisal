import { describe, it, expect } from 'vitest'
import {
  money,
  moneyAdd, moneySub, moneyMul, moneyDiv, moneyDivSafe, moneySum,
  applyRate, applyPercent,
  roundForStorage, formatMoney, formatRate,
  serializeMoney, parseMoney,
  readMoney,
  ZERO_MONEY, ONE_MONEY,
  MONEY_SCALE,
} from '@/lib/money'

// ─────────────────────────────────────────────────
// 1. Exact decimal behavior (the whole point)
// ─────────────────────────────────────────────────

describe('exact decimal behavior', () => {
  it('adds 0.1 + 0.2 without floating-point drift', () => {
    expect(moneyAdd(0.1, 0.2).toString()).toBe('0.3')
  })

  it('sums a long chain of thirds exactly', () => {
    // The classic float bug: (1/3 + 1/3 + 1/3) as JS-numbers rounds oddly.
    // With strings we pass exact rationals through decimal.js.
    // Prisma.Decimal.toString() strips insignificant trailing zeros, so
    // 1.0000 renders as '1'; the mathematical equality is what matters.
    const total = moneySum(['0.3333', '0.3333', '0.3334'])
    expect(total.toString()).toBe('1')
  })

  it('multiplies a rate against a base without drift', () => {
    // 1_000_000.05 × 0.075 = 75_000.00375, which JS floats muddle.
    const result = moneyMul('1000000.05', '0.075')
    expect(result.toString()).toBe('75000.00375')
  })

  it('accepts number, string, Decimal, and nullish inputs', () => {
    expect(money(1.5).toString()).toBe('1.5')
    expect(money('1.5').toString()).toBe('1.5')
    expect(money(money('1.5')).toString()).toBe('1.5')
    expect(money(null).toString()).toBe('0')
    expect(money(undefined).toString()).toBe('0')
  })

  it('rejects NaN and Infinity at input', () => {
    expect(() => money(NaN)).toThrow(/non-finite/)
    expect(() => money(Infinity)).toThrow(/non-finite/)
    expect(() => money(-Infinity)).toThrow(/non-finite/)
  })

  it('exposes ZERO_MONEY and ONE_MONEY constants', () => {
    expect(ZERO_MONEY.toString()).toBe('0')
    expect(ONE_MONEY.toString()).toBe('1')
  })
})

// ─────────────────────────────────────────────────
// 2. Rounding
// ─────────────────────────────────────────────────

describe('rounding', () => {
  it('rounds half-away-from-zero to storage scale (4 places)', () => {
    expect(roundForStorage('1.23456').toString()).toBe('1.2346')
    expect(roundForStorage('1.23454').toString()).toBe('1.2345')
    expect(roundForStorage('1.23455').toString()).toBe('1.2346')  // half up
    // Negative side symmetry — HALF_UP takes the absolute value away from
    // zero, so -1.23455 rounds to -1.2346.
    expect(roundForStorage('-1.23455').toString()).toBe('-1.2346')
  })

  it('leaves values under scale unchanged', () => {
    expect(roundForStorage('1.23').toString()).toBe('1.23')
  })

  it('accepts a custom scale', () => {
    expect(roundForStorage('1.239', 2).toString()).toBe('1.24')
  })

  it('MONEY_SCALE is 4', () => {
    expect(MONEY_SCALE).toBe(4)
  })
})

// ─────────────────────────────────────────────────
// 3. Negative numbers
// ─────────────────────────────────────────────────

describe('negative numbers', () => {
  it('subtracts to a negative result', () => {
    expect(moneySub(100, 250).toString()).toBe('-150')
  })

  it('adds a negative like subtracting', () => {
    expect(moneyAdd(1000, -350).toString()).toBe('650')
  })

  it('multiplies with negative multiplier', () => {
    expect(moneyMul('7.5', -2).toString()).toBe('-15')
  })

  it('sums a mixed-sign list', () => {
    expect(moneySum([-100, 250, -50, 25]).toString()).toBe('125')
  })
})

// ─────────────────────────────────────────────────
// 4. Percentages / rates
// ─────────────────────────────────────────────────

describe('percentages and rates', () => {
  it('applyRate treats input as a decimal fraction', () => {
    expect(applyRate(1_000, 0.15).toString()).toBe('150')
  })

  it('applyPercent treats input as a whole number', () => {
    expect(applyPercent(1_000, 15).toString()).toBe('150')
  })

  it('formatRate emits "%" suffix', () => {
    expect(formatRate(0.15)).toBe('15.00%')
    expect(formatRate('0.075', 3)).toBe('7.500%')
  })
})

// ─────────────────────────────────────────────────
// 5. Very large values
// ─────────────────────────────────────────────────

describe('very large values', () => {
  it('handles trillions with 4-decimal precision', () => {
    // 999,999,999,999.9999 + 0.0001 = a full trillion.
    const total = moneyAdd('999999999999.9999', '0.0001')
    expect(total.toString()).toBe('1000000000000')
  })

  it('multiplies large × large without silent overflow', () => {
    const total = moneyMul('1000000000', '1000')
    expect(total.toString()).toBe('1000000000000')
  })

  it('sums a large list without accumulating drift', () => {
    // 10,000 × 0.0001 = 1 exactly (JS floats would drift).
    const total = moneySum(Array.from({ length: 10_000 }, () => '0.0001'))
    expect(total.toString()).toBe('1')
  })
})

// ─────────────────────────────────────────────────
// 6. Zero
// ─────────────────────────────────────────────────

describe('zero', () => {
  it('adds and subtracts zero as identity', () => {
    expect(moneyAdd(500, 0).toString()).toBe('500')
    expect(moneySub(500, 0).toString()).toBe('500')
  })

  it('multiplies by zero to zero', () => {
    expect(moneyMul('12345.6789', 0).toString()).toBe('0')
  })

  it('sums an empty iterable to zero', () => {
    expect(moneySum([]).toString()).toBe('0')
  })

  it('detects zero via Decimal.isZero()', () => {
    expect(money(0).isZero()).toBe(true)
    expect(money('0.0000').isZero()).toBe(true)
    expect(money('0.0001').isZero()).toBe(false)
  })
})

// ─────────────────────────────────────────────────
// 7. Divide-by-zero
// ─────────────────────────────────────────────────

describe('divide-by-zero behavior', () => {
  it('moneyDiv throws on b == 0', () => {
    expect(() => moneyDiv(100, 0)).toThrow(/division by zero/)
    expect(() => moneyDiv(100, '0')).toThrow(/division by zero/)
    expect(() => moneyDiv(100, '0.0000')).toThrow(/division by zero/)
  })

  it('moneyDivSafe returns the fallback (default 0) instead', () => {
    expect(moneyDivSafe(100, 0).toString()).toBe('0')
    expect(moneyDivSafe(100, 0, -1).toString()).toBe('-1')
  })

  it('moneyDiv works normally for non-zero denominators', () => {
    expect(moneyDiv(10, 4).toString()).toBe('2.5')
  })
})

// ─────────────────────────────────────────────────
// 8. Display formatting
// ─────────────────────────────────────────────────

describe('display formatting', () => {
  it('formatMoney emits USD by default with 2 places', () => {
    // Different Node versions use slightly different currency spacing; we
    // check for the substring rather than exact whitespace.
    const s = formatMoney('1234567.89')
    expect(s).toMatch(/\$1,234,567\.89/)
  })

  it('formatMoney respects a custom currency and places', () => {
    const s = formatMoney('9.876', { currency: 'EUR', places: 3, locale: 'en-US' })
    expect(s).toContain('9.876')
    expect(s).toContain('€')
  })

  it('formatMoney preserves storage precision by rounding at DISPLAY time only', () => {
    // Internal value is 1.2345 (4 places, MONEY_SCALE), display rounds to 2.
    const dec = money('1.2345')
    expect(formatMoney(dec)).toContain('1.23')
    // …and the original Decimal is untouched.
    expect(dec.toString()).toBe('1.2345')
  })
})

// ─────────────────────────────────────────────────
// 9. Serialization
// ─────────────────────────────────────────────────

describe('server ↔ client serialization', () => {
  it('serializeMoney round-trips through parseMoney', () => {
    const s = serializeMoney(money('1234567.8901'))
    expect(s).toBe('1234567.8901')
    expect(parseMoney(s)!.toString()).toBe('1234567.8901')
  })

  it('handles nullish', () => {
    expect(serializeMoney(null)).toBeNull()
    expect(serializeMoney(undefined)).toBeNull()
    expect(parseMoney(null)).toBeNull()
    expect(parseMoney('')).toBeNull()
  })
})

// ─────────────────────────────────────────────────
// 10. Dual-column reader
// ─────────────────────────────────────────────────

describe('readMoney (dual-column migration helper)', () => {
  it('prefers the Decimal shadow column when populated', () => {
    const row = { value: 1.23, valueDecimal: money('1.2345') }
    expect(readMoney(row, 'value')!.toString()).toBe('1.2345')
  })

  it('falls back to the Float column when the Decimal is null', () => {
    const row = { value: 42, valueDecimal: null }
    expect(readMoney(row, 'value')!.toString()).toBe('42')
  })

  it('returns null when both columns are null / missing', () => {
    const row = { value: null, valueDecimal: null }
    expect(readMoney(row, 'value')).toBeNull()
    expect(readMoney(null, 'value')).toBeNull()
    expect(readMoney(undefined, 'value')).toBeNull()
  })
})
