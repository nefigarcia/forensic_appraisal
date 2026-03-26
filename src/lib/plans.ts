/**
 * Plan definitions — single source of truth for limits, features, and Stripe price IDs.
 * Price IDs are read from env vars so they work across test/live Stripe environments.
 */

export type PlanId = 'TRIAL' | 'SOLO' | 'FIRM' | 'ENTERPRISE'

export interface Plan {
  id: PlanId
  name: string
  description: string
  price: number           // USD per month (0 = free / contact)
  priceLabel: string
  stripePriceId: string | null  // null = no Stripe checkout (trial / enterprise sales)
  casesLimit: number      // -1 = unlimited
  usersLimit: number      // -1 = unlimited
  features: string[]
  highlighted?: boolean
}

export const PLANS: Record<PlanId, Plan> = {
  TRIAL: {
    id: 'TRIAL',
    name: 'Free Trial',
    description: '14-day full-access trial. No credit card required.',
    price: 0,
    priceLabel: 'Free',
    stripePriceId: null,
    casesLimit: 3,
    usersLimit: 1,
    features: [
      'Up to 3 cases',
      'AI document extraction',
      'Forensic ledger',
      'Basic valuation engine',
      'Audit trail',
    ],
  },
  SOLO: {
    id: 'SOLO',
    name: 'Solo Practitioner',
    description: 'For independent forensic appraisers.',
    price: 149,
    priceLabel: '$149 / mo',
    stripePriceId: process.env.STRIPE_PRICE_SOLO ?? null,
    casesLimit: 15,
    usersLimit: 1,
    features: [
      'Up to 15 active cases',
      'Full AI extraction + confidence scores',
      'Anomaly detection',
      'DCF + GPCM valuation engine',
      'Report narrative drafting (AI)',
      'Audit trail & chain of custody',
      'Excel export',
    ],
  },
  FIRM: {
    id: 'FIRM',
    name: 'Firm',
    description: 'For small to mid-size appraisal firms.',
    price: 499,
    priceLabel: '$499 / mo',
    stripePriceId: process.env.STRIPE_PRICE_FIRM ?? null,
    casesLimit: 100,
    usersLimit: 10,
    features: [
      'Up to 100 active cases',
      'Up to 10 team members',
      'Role-based access control',
      'All Solo features',
      'Priority AI queue',
      'SharePoint / OneDrive connector',
      'Dedicated support',
    ],
    highlighted: true,
  },
  ENTERPRISE: {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'Unlimited scale for large firms and institutions.',
    price: 0,
    priceLabel: 'Contact us',
    stripePriceId: process.env.STRIPE_PRICE_ENTERPRISE ?? null,
    casesLimit: -1,
    usersLimit: -1,
    features: [
      'Unlimited cases & users',
      'SSO / SAML',
      'Custom AI model tuning',
      'On-premise deployment option',
      'SLA guarantee',
      'All Firm features',
      'Dedicated CSM',
    ],
  },
}

export function getPlan(planId: string): Plan {
  return PLANS[(planId as PlanId)] ?? PLANS.TRIAL
}

export function isWithinCaseLimit(plan: Plan, currentCaseCount: number): boolean {
  if (plan.casesLimit === -1) return true
  return currentCaseCount < plan.casesLimit
}

export function isWithinUserLimit(plan: Plan, currentUserCount: number): boolean {
  if (plan.usersLimit === -1) return true
  return currentUserCount < plan.usersLimit
}
