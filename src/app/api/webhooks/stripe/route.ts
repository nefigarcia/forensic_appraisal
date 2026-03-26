import { NextRequest, NextResponse } from 'next/server'
import { stripe, STRIPE_WEBHOOK_SECRET } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { PLANS, PlanId } from '@/lib/plans'
import Stripe from 'stripe'

export const dynamic = 'force-dynamic'

// ── helpers ───────────────────────────────────────────────────────────────────

/** Resolve planId from a Stripe price ID */
function planFromPriceId(priceId: string): PlanId {
  for (const [planId, plan] of Object.entries(PLANS)) {
    if (plan.stripePriceId === priceId) return planId as PlanId
  }
  return 'SOLO'
}

async function activateSubscription(organizationId: string, planId: PlanId, sub: Stripe.Subscription) {
  const plan = PLANS[planId]
  // billing_cycle_anchor is the timestamp the cycle is anchored to; use it as period reference
  const periodEnd = new Date((sub.billing_cycle_anchor ?? Date.now() / 1000) * 1000)

  // @ts-ignore — new fields added by schema migration; Prisma client regeneration will fix this
  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      plan:                 planId,
      subscriptionStatus:   sub.status.toUpperCase(),
      stripeSubscriptionId: sub.id,
      stripePriceId:        sub.items.data[0]?.price.id ?? null,
      currentPeriodEnd:     periodEnd,
      casesLimit:           plan.casesLimit === -1 ? 999999 : plan.casesLimit,
      usersLimit:           plan.usersLimit === -1 ? 999999 : plan.usersLimit,
    },
  })
}

// ── handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig  = req.headers.get('stripe-signature') ?? ''

  if (!STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET)
  } catch (err: any) {
    return NextResponse.json({ error: `Webhook error: ${err.message}` }, { status: 400 })
  }

  try {
    switch (event.type) {

      // ── Checkout completed → activate subscription ─────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const orgId   = session.metadata?.organizationId
        const planId  = (session.metadata?.planId ?? 'SOLO') as PlanId
        if (!orgId) break

        if (session.customer) {
          // @ts-ignore
          await prisma.organization.update({ where: { id: orgId }, data: { stripeCustomerId: session.customer as string } })
        }

        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string)
          await activateSubscription(orgId, planId, sub)
        }
        break
      }

      // ── Subscription updated ───────────────────────────────────────────
      case 'customer.subscription.updated': {
        const sub   = event.data.object as Stripe.Subscription
        const orgId = sub.metadata?.organizationId
        if (!orgId) break
        const planId = planFromPriceId(sub.items.data[0]?.price.id ?? '')
        await activateSubscription(orgId, planId, sub)
        break
      }

      // ── Subscription deleted → revert to TRIAL ────────────────────────
      case 'customer.subscription.deleted': {
        const sub   = event.data.object as Stripe.Subscription
        const orgId = sub.metadata?.organizationId
        if (!orgId) break
        // @ts-ignore
        await prisma.organization.update({
          where: { id: orgId },
          data: {
            plan:                 'TRIAL',
            subscriptionStatus:   'CANCELED',
            stripeSubscriptionId: null,
            stripePriceId:        null,
            currentPeriodEnd:     null,
            casesLimit:           3,
            usersLimit:           1,
          },
        })
        break
      }

      // ── Invoice payment failed → PAST_DUE ────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        // New Stripe API: subscription is under parent.subscription_details
        const subRef = (invoice as any).parent?.subscription_details?.subscription
          ?? (invoice as any).subscription
        if (!subRef) break
        const sub   = await stripe.subscriptions.retrieve(typeof subRef === 'string' ? subRef : subRef.id)
        const orgId = sub.metadata?.organizationId
        if (!orgId) break
        // @ts-ignore
        await prisma.organization.update({ where: { id: orgId }, data: { subscriptionStatus: 'PAST_DUE' } })
        break
      }

      default:
        break
    }
  } catch (err: any) {
    console.error('[stripe webhook] Handler error:', err)
    return NextResponse.json({ error: 'Internal handler error' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
