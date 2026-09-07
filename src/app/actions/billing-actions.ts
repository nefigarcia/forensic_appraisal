'use server'

import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'
import { getPlan, PLANS, PlanId } from '@/lib/plans'
import { redirect } from 'next/navigation'
import { requireOrganization } from '@/lib/authz'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:9002'

// ─────────────────────────────────────────────────
// READ BILLING STATE
// ─────────────────────────────────────────────────

export async function getBillingInfo() {
  let session
  try { session = await requireOrganization() } catch { return null }

  // @ts-ignore — new billing fields; Prisma client will be current after `prisma generate`
  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    include: {
      _count: { select: { users: true, cases: true } },
    },
  }) as any
  if (!org) return null

  const plan = getPlan(org.plan)

  return {
    orgId:               org.id,
    orgName:             org.name,
    plan:                org.plan as PlanId,
    planDetails:         plan,
    subscriptionStatus:  org.subscriptionStatus  ?? 'TRIAL',
    currentPeriodEnd:    org.currentPeriodEnd     ?? null,
    stripeCustomerId:    org.stripeCustomerId     ?? null,
    stripeSubscriptionId: org.stripeSubscriptionId ?? null,
    caseCount:           org._count.cases,
    userCount:           org._count.users,
    casesLimit:          org.casesLimit           ?? 3,
    usersLimit:          org.usersLimit           ?? 1,
    trialEndsAt:         org.trialEndsAt,
  }
}

// ─────────────────────────────────────────────────
// CREATE STRIPE CHECKOUT SESSION
// ─────────────────────────────────────────────────

export async function createCheckoutSession(planId: PlanId) {
  const session = await requireOrganization()

  const plan = PLANS[planId]
  if (!plan.stripePriceId) throw new Error(`Plan ${planId} has no Stripe price configured.`)

  // @ts-ignore
  const org = await prisma.organization.findUnique({ where: { id: session.organizationId } }) as any
  if (!org) throw new Error('Organization not found')

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    customer: org.stripeCustomerId ?? undefined,
    customer_email: org.stripeCustomerId ? undefined : session.email,
    success_url: `${APP_URL}/settings/billing?success=1`,
    cancel_url:  `${APP_URL}/settings/billing?canceled=1`,
    metadata: {
      organizationId: org.id,
      planId,
    },
    subscription_data: {
      metadata: { organizationId: org.id, planId },
    },
  })

  if (!checkoutSession.url) throw new Error('Failed to create checkout session')
  redirect(checkoutSession.url)
}

// ─────────────────────────────────────────────────
// CREATE STRIPE CUSTOMER PORTAL SESSION
// ─────────────────────────────────────────────────

export async function createPortalSession() {
  const session = await requireOrganization()

  // @ts-ignore
  const org = await prisma.organization.findUnique({ where: { id: session.organizationId } }) as any
  if (!org?.stripeCustomerId) throw new Error('No billing account found. Please subscribe first.')

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: `${APP_URL}/settings/billing`,
  })

  redirect(portalSession.url)
}

// ─────────────────────────────────────────────────
// APPLY PLAN LIMITS AFTER WEBHOOK (internal)
// ─────────────────────────────────────────────────
// NOTE(slice-1): This export lives in a 'use server' file, which makes it
// remotely callable as a server-action RPC. It trusts a client-supplied
// organizationId. Slice 2 will move it out of this module into a plain
// server-only helper invoked only from the Stripe webhook route. Not moved
// in Slice 1 to keep the scope tight (tenant enforcement only).

export async function applyPlanToOrg(organizationId: string, planId: PlanId) {
  const plan = PLANS[planId]
  // @ts-ignore
  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      plan:        planId,
      casesLimit:  plan.casesLimit === -1 ? 999999 : plan.casesLimit,
      usersLimit:  plan.usersLimit === -1 ? 999999 : plan.usersLimit,
    },
  })
}
