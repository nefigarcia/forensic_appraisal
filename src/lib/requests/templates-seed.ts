/**
 * Built-in template presets. Firms can clone these into
 * organization-owned templates and then edit freely. The presets
 * themselves are not stored as rows — a firm creates its first
 * template by calling `cloneRequestTemplateFromSeed(seedKey)`.
 *
 * Adding a new preset is a code change (single-file). Firms authoring
 * their own don't touch this file.
 */

import type { RequestItemCategory, RequestItemPriority } from './categories'

export interface SeedTemplateItem {
  title:        string
  description?: string
  category:     RequestItemCategory
  priority:     RequestItemPriority
}

export interface SeedTemplate {
  key:            string
  name:           string
  description:    string
  engagementType: 'BUSINESS_VALUATION' | 'DIVORCE' | 'LITIGATION' | 'ESTATE' | 'OTHER'
  items:          SeedTemplateItem[]
}

export const SEED_TEMPLATES: readonly SeedTemplate[] = [
  {
    key:            'bv-small-business',
    name:           'Business Valuation — Small Business',
    description:    'Typical PBC list for a small-business valuation engagement.',
    engagementType: 'BUSINESS_VALUATION',
    items: [
      { title: 'Federal income tax returns (last 5 years)',        category: 'TAX',        priority: 'HIGH' },
      { title: 'State income tax returns (last 5 years)',          category: 'TAX',        priority: 'NORMAL' },
      { title: 'Audited or reviewed financial statements (5 yr)',  category: 'FINANCIAL',  priority: 'HIGH' },
      { title: 'Internal profit and loss statements (last 5 yr)',  category: 'FINANCIAL',  priority: 'HIGH' },
      { title: 'Balance sheets (last 5 years)',                    category: 'FINANCIAL',  priority: 'HIGH' },
      { title: 'General ledger (current + prior year)',            category: 'FINANCIAL',  priority: 'HIGH' },
      { title: 'Bank statements (last 12 months)',                 category: 'BANK',       priority: 'HIGH' },
      { title: 'Merchant / credit card statements (last 12 mo)',   category: 'BANK',       priority: 'NORMAL' },
      { title: 'Articles of incorporation / operating agreement',  category: 'LEGAL',      priority: 'NORMAL' },
      { title: 'Buy/sell agreements',                              category: 'LEGAL',      priority: 'NORMAL' },
      { title: 'Related-party leases and loans',                   category: 'LEGAL',      priority: 'HIGH' },
      { title: 'Owner compensation and benefits detail',           category: 'HR',         priority: 'HIGH' },
      { title: 'Employee count / roster',                          category: 'HR',         priority: 'NORMAL' },
      { title: 'Top 10 customers with revenue',                    category: 'OPERATIONS', priority: 'HIGH' },
      { title: 'Top 10 vendors',                                   category: 'OPERATIONS', priority: 'NORMAL' },
      { title: 'Board minutes (last 3 years)',                     category: 'GOVERNANCE', priority: 'NORMAL' },
      { title: 'Capitalization table',                             category: 'GOVERNANCE', priority: 'NORMAL' },
      { title: 'Business plan / forecasts',                        category: 'OPERATIONS', priority: 'NORMAL' },
    ],
  },
  {
    key:            'divorce-basic',
    name:           'Divorce / Marital Dissolution',
    description:    'Financial disclosure package for a divorce engagement.',
    engagementType: 'DIVORCE',
    items: [
      { title: 'Joint federal tax returns (last 5 years)',         category: 'TAX',        priority: 'HIGH' },
      { title: 'Individual tax returns of each spouse (5 yr)',     category: 'TAX',        priority: 'HIGH' },
      { title: 'W-2 / 1099 (last 3 years) per spouse',             category: 'TAX',        priority: 'HIGH' },
      { title: 'Pay stubs (last 6 months) per spouse',             category: 'FINANCIAL',  priority: 'HIGH' },
      { title: 'All bank account statements (last 24 months)',     category: 'BANK',       priority: 'HIGH' },
      { title: 'All brokerage account statements (last 24 months)',category: 'BANK',       priority: 'HIGH' },
      { title: 'Retirement account statements (last 24 months)',   category: 'BANK',       priority: 'HIGH' },
      { title: 'Real estate deeds and mortgage statements',        category: 'LEGAL',      priority: 'HIGH' },
      { title: 'Business ownership records',                       category: 'GOVERNANCE', priority: 'HIGH' },
      { title: 'Life insurance policies + cash values',            category: 'FINANCIAL',  priority: 'NORMAL' },
    ],
  },
  {
    key:            'litigation-support',
    name:           'Litigation Support — Economic Damages',
    description:    'PBC list for an economic-damages / lost-profits engagement.',
    engagementType: 'LITIGATION',
    items: [
      { title: 'Tax returns (last 5 years)',                       category: 'TAX',        priority: 'HIGH' },
      { title: 'Financial statements pre- and post-event',         category: 'FINANCIAL',  priority: 'HIGH' },
      { title: 'Monthly P&L for the last 36 months',               category: 'FINANCIAL',  priority: 'HIGH' },
      { title: 'Customer contracts affected by the event',         category: 'LEGAL',      priority: 'HIGH' },
      { title: 'Correspondence relating to the event',             category: 'LEGAL',      priority: 'NORMAL' },
      { title: 'Sales pipeline / CRM export',                      category: 'OPERATIONS', priority: 'HIGH' },
      { title: 'Payroll register for the affected period',         category: 'HR',         priority: 'NORMAL' },
      { title: 'Insurance policies covering the loss',             category: 'LEGAL',      priority: 'NORMAL' },
    ],
  },
]

export function findSeedTemplate(key: string): SeedTemplate | undefined {
  return SEED_TEMPLATES.find(t => t.key === key)
}
