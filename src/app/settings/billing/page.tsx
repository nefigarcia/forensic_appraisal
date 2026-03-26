import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import {
  CreditCard, CheckCircle2, Zap, Users, Briefcase, AlertCircle, ArrowRight, Star,
} from 'lucide-react'
import { getBillingInfo } from '@/app/actions/billing-actions'
import { PLANS, PlanId } from '@/lib/plans'
import { format } from 'date-fns'
import { CheckoutButton } from './checkout-button'
import { PortalButton } from './portal-button'
import { cn } from '@/lib/utils'

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; canceled?: string }>
}) {
  const params  = await searchParams
  const billing = await getBillingInfo()

  const statusColors: Record<string, string> = {
    TRIAL:    'bg-blue-100   text-blue-800',
    ACTIVE:   'bg-emerald-100 text-emerald-800',
    PAST_DUE: 'bg-orange-100  text-orange-800',
    CANCELED: 'bg-red-100    text-red-800',
    PAUSED:   'bg-slate-100  text-slate-600',
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center px-6 border-b bg-white shadow-sm">
          <div className="flex items-center gap-3">
            <SidebarTrigger />
            <div className="h-5 w-px bg-border/60" />
            <div>
              <h1 className="text-base font-black text-primary tracking-tight leading-tight" style={{ fontFamily: "'Playfair Display', serif" }}>Billing &amp; Plans</h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">Manage your subscription</p>
            </div>
          </div>
        </header>

        <main className="flex-1 p-8 max-w-5xl mx-auto w-full space-y-8">

          {/* Success / Cancel banners */}
          {params.success && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-5 py-4 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
              <p className="text-sm font-semibold text-emerald-800">Subscription activated! Your plan has been upgraded.</p>
            </div>
          )}
          {params.canceled && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-5 py-4 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
              <p className="text-sm font-semibold text-amber-800">Checkout canceled. Your plan was not changed.</p>
            </div>
          )}

          {/* Current plan card */}
          {billing && (
            <Card className="border-none shadow-sm bg-white overflow-hidden">
              <CardHeader className="border-b bg-muted/10 py-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                    <CreditCard className="h-4 w-4 text-primary" />
                    Current Plan
                  </CardTitle>
                  <Badge className={cn('text-[10px] font-bold', statusColors[billing.subscriptionStatus] ?? statusColors.TRIAL)}>
                    {billing.subscriptionStatus}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid gap-6 md:grid-cols-3">
                  {/* Plan name */}
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Plan</p>
                    <p className="text-2xl font-black text-primary">{billing.planDetails.name}</p>
                    <p className="text-sm text-muted-foreground">{billing.planDetails.priceLabel}</p>
                    {billing.currentPeriodEnd && (
                      <p className="text-[11px] text-muted-foreground">
                        Renews {format(billing.currentPeriodEnd, 'MMM d, yyyy')}
                      </p>
                    )}
                    {billing.trialEndsAt && billing.subscriptionStatus === 'TRIAL' && (
                      <p className="text-[11px] text-amber-600 font-semibold">
                        Trial ends {format(billing.trialEndsAt, 'MMM d, yyyy')}
                      </p>
                    )}
                  </div>

                  {/* Case usage */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                        <Briefcase className="h-3 w-3" /> Cases
                      </p>
                      <p className="text-sm font-bold text-primary">
                        {billing.caseCount} / {billing.casesLimit === 999999 ? '∞' : billing.casesLimit}
                      </p>
                    </div>
                    <Progress
                      value={billing.casesLimit === 999999 ? 10 : (billing.caseCount / billing.casesLimit) * 100}
                      className="h-2 bg-muted"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {billing.casesLimit === 999999 ? 'Unlimited' : `${billing.casesLimit - billing.caseCount} remaining`}
                    </p>
                  </div>

                  {/* User usage */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                        <Users className="h-3 w-3" /> Team Members
                      </p>
                      <p className="text-sm font-bold text-primary">
                        {billing.userCount} / {billing.usersLimit === 999999 ? '∞' : billing.usersLimit}
                      </p>
                    </div>
                    <Progress
                      value={billing.usersLimit === 999999 ? 10 : (billing.userCount / billing.usersLimit) * 100}
                      className="h-2 bg-muted"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {billing.usersLimit === 999999 ? 'Unlimited' : `${billing.usersLimit - billing.userCount} remaining`}
                    </p>
                  </div>
                </div>

                {/* Manage subscription */}
                {billing.stripeCustomerId && (
                  <div className="mt-6 pt-6 border-t flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      Manage payment methods, invoices, and cancellation.
                    </p>
                    <PortalButton />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Plan cards */}
          <div>
            <h2 className="text-lg font-bold text-primary mb-4">Available Plans</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {(Object.values(PLANS) as (typeof PLANS)[PlanId][]).map(plan => {
                const isCurrent = billing?.plan === plan.id
                return (
                  <Card
                    key={plan.id}
                    className={cn(
                      'border-none shadow-sm flex flex-col overflow-hidden transition-shadow',
                      plan.highlighted ? 'ring-2 ring-primary shadow-lg' : 'bg-white',
                      isCurrent && 'ring-2 ring-emerald-400',
                    )}
                  >
                    {plan.highlighted && (
                      <div className="bg-primary text-white text-[10px] font-black uppercase tracking-widest text-center py-1.5 flex items-center justify-center gap-1">
                        <Star className="h-3 w-3 fill-accent text-accent" /> Most Popular
                      </div>
                    )}
                    {isCurrent && !plan.highlighted && (
                      <div className="bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest text-center py-1.5">
                        Current Plan
                      </div>
                    )}
                    <CardContent className="p-5 flex flex-col flex-1">
                      <div className="mb-4">
                        <p className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-1">{plan.name}</p>
                        <p className="text-2xl font-black text-primary">{plan.priceLabel}</p>
                        <p className="text-xs text-muted-foreground mt-1">{plan.description}</p>
                      </div>

                      <ul className="space-y-2 mb-6 flex-1">
                        {plan.features.map(f => (
                          <li key={f} className="flex items-start gap-2 text-xs text-slate-700">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                            {f}
                          </li>
                        ))}
                      </ul>

                      {isCurrent ? (
                        <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold text-center py-2 flex items-center justify-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Active
                        </div>
                      ) : plan.id === 'TRIAL' ? (
                        <div className="rounded-lg bg-muted text-muted-foreground text-[11px] font-bold text-center py-2">
                          Free / Default
                        </div>
                      ) : plan.id === 'ENTERPRISE' ? (
                        <a
                          href="mailto:sales@valuvault.ai?subject=Enterprise%20Plan%20Inquiry"
                          className="block rounded-lg bg-primary text-white text-[11px] font-bold text-center py-2 hover:bg-primary/90 transition-colors"
                        >
                          Contact Sales
                        </a>
                      ) : (
                        <CheckoutButton planId={plan.id} label={`Upgrade to ${plan.name}`} />
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>

          {/* FAQ */}
          <Card className="border-none shadow-sm bg-white">
            <CardContent className="p-6 space-y-4">
              <h3 className="text-sm font-bold text-primary uppercase tracking-widest">Billing FAQ</h3>
              <Separator />
              {[
                {
                  q: 'What happens when I hit my case limit?',
                  a: 'New case creation is blocked with a clear message. Existing cases remain fully accessible. Upgrade to unlock more.',
                },
                {
                  q: 'Can I cancel at any time?',
                  a: 'Yes. Cancel via the Manage Subscription button. Your plan stays active until the end of the billing period.',
                },
                {
                  q: 'Is my financial data safe?',
                  a: 'All documents are encrypted at rest in S3. Financial data never leaves your organization\'s isolated workspace.',
                },
                {
                  q: 'Do you offer annual billing?',
                  a: 'Annual billing with a 20% discount is available — contact sales@valuvault.ai.',
                },
              ].map(({ q, a }) => (
                <div key={q}>
                  <p className="text-sm font-semibold text-primary">{q}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{a}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
