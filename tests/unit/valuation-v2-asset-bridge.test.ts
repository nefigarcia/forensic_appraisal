import { describe, it, expect } from 'vitest'
import { computeAssetApproach, rowFairValue } from '@/lib/valuation-v2/asset'
import { computeBridge } from '@/lib/valuation-v2/bridge'
import { orientAmount } from '@/lib/valuation-v2/statuses'

describe('asset approach', () => {
  it('fairValue = reportedValue + adjustment (signed)', () => {
    expect(rowFairValue({ side: 'ASSET', reportedValue: '100', adjustment: '25' }).toString()).toBe('125')
    expect(rowFairValue({ side: 'ASSET', reportedValue: '100', adjustment: '-40' }).toString()).toBe('60')
  })

  it('adjustedNetAssets = ΣassetFV − ΣliabilityFV', () => {
    const r = computeAssetApproach([
      { side: 'ASSET',     reportedValue: '1000', adjustment: '200' },
      { side: 'ASSET',     reportedValue: '500',  adjustment: '-50' },
      { side: 'LIABILITY', reportedValue: '600',  adjustment: '100' },
    ])
    expect(r.totalAssets.toString()).toBe('1650')       // 1200 + 450
    expect(r.totalLiabilities.toString()).toBe('700')   // 600 + 100
    expect(r.adjustedNetAssets.toString()).toBe('950')  // 1650 - 700
  })

  it('excludes rows with isIncluded=false', () => {
    const r = computeAssetApproach([
      { side: 'ASSET', reportedValue: '100', adjustment: '0' },
      { side: 'ASSET', reportedValue: '9999999', adjustment: '0', isIncluded: false },
    ])
    expect(r.adjustedNetAssets.toString()).toBe('100')
  })
})

describe('bridge — enterprise → equity', () => {
  it('signed sum of items applied to enterprise value', () => {
    // Enterprise value = 20_000_000
    // + Cash (2M) - Debt (5M) - Pension liability (0.5M) + Non-op real estate (1M)
    const r = computeBridge('20000000', [
      { category: 'CASH',           label: 'Non-op cash',      amount: '2000000'  },
      { category: 'DEBT',           label: 'Term loan',        amount: '-5000000' },
      { category: 'DEBT_LIKE',      label: 'Unfunded pension', amount: '-500000'  },
      { category: 'NON_OPERATING',  label: 'Idle real estate', amount: '1000000'  },
    ])
    expect(r.bridgeNet.toString()).toBe('-2500000')
    expect(r.equityValue.toString()).toBe('17500000')
  })

  it('empty items → equity == enterprise', () => {
    const r = computeBridge('1000', [])
    expect(r.bridgeNet.toString()).toBe('0')
    expect(r.equityValue.toString()).toBe('1000')
  })

  it('orientAmount applies the conventional sign per category', () => {
    expect(orientAmount('CASH',              1000)).toBe( 1000)
    expect(orientAmount('DEBT',              1000)).toBe(-1000)
    expect(orientAmount('DEBT_LIKE',         1000)).toBe(-1000)
    expect(orientAmount('PREFERRED_EQUITY',  1000)).toBe(-1000)
    expect(orientAmount('NCI',               1000)).toBe(-1000)
    // NON_OPERATING preserves caller sign
    expect(orientAmount('NON_OPERATING',     1000)).toBe( 1000)
    expect(orientAmount('NON_OPERATING',    -1000)).toBe(-1000)
    expect(orientAmount('OTHER',             1000)).toBe( 1000)
  })
})
