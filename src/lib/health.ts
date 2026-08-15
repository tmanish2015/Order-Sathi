import { differenceInDays } from 'date-fns'
import type { Tables } from './database.types'

type Subscription = Tables<'subscriptions'>

export type Health = 'healthy' | 'watch' | 'at_risk' | 'no_subscription'

export function computeHealth(subs: Subscription[]): Health {
  if (subs.length === 0) return 'no_subscription'

  const hasCancelled = subs.some((s) => s.status === 'cancelled')
  const hasBadPastDue = subs.some((s) => s.status === 'past_due' && s.failed_charge_count >= 2)
  if (hasCancelled || hasBadPastDue) return 'at_risk'

  const hasPastDue = subs.some((s) => s.status === 'past_due')
  const dueSoon = subs.some(
    (s) => s.status === 'active' && s.next_due_date && differenceInDays(new Date(s.next_due_date), new Date()) <= 7
  )
  if (hasPastDue || dueSoon) return 'watch'

  return 'healthy'
}

export const HEALTH_LABEL: Record<Health, string> = {
  healthy: '🟢 Healthy',
  watch: '🟡 Watch',
  at_risk: '🔴 At risk',
  no_subscription: '⚪ No subscription',
}

export const HEALTH_COLOR: Record<Health, string> = {
  healthy: 'bg-emerald-100 text-emerald-700',
  watch: 'bg-amber-100 text-amber-700',
  at_risk: 'bg-red-100 text-red-700',
  no_subscription: 'bg-slate-100 text-slate-500',
}
