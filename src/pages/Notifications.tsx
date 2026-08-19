import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables, Enums } from '../lib/database.types'

type Notification = Tables<'notifications'>

const PRIORITY_COLOR: Record<Enums<'notification_priority'>, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  high: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  low: 'bg-slate-100 text-slate-500 dark:bg-slate-900/40 dark:text-slate-300',
}

const PRIORITY_RANK: Record<Enums<'notification_priority'>, number> = { critical: 0, high: 1, medium: 2, low: 3 }

export default function Notifications() {
  const { profile } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const orgId = profile?.organization_id

  // Refreshed from the same live exception sources the Dashboard exceptions
  // panel uses - one notification row per category (not per record), so
  // opening this page repeatedly never spams duplicates (upsert on
  // organization_id+type). A category with zero matches is deleted rather
  // than left around stale.
  async function refreshAndLoad() {
    if (!orgId) return
    setLoading(true)

    const now = Date.now()
    const [
      { count: stockShortageCount },
      { data: slaOrders },
      { count: unmappedCount },
      { data: ndrRecords },
      { count: rtoCount },
      { count: reconMismatchCount },
      { count: settlementMismatchCount },
      { data: channels },
      { data: syncLogs },
    ] = await Promise.all([
      supabase.from('orders').select('id', { count: 'exact', head: true }).eq('order_status', 'stock_shortage'),
      supabase.from('orders').select('id, sla_due_at').not('sla_due_at', 'is', null).not('order_status', 'in', '(delivered,cancelled,returned,rto)'),
      supabase.from('unmapped_sku_exceptions').select('id', { count: 'exact', head: true }).eq('resolved', false),
      supabase.from('ndr_records').select('id, outcome'),
      supabase.from('orders').select('id', { count: 'exact', head: true }).eq('order_status', 'rto'),
      supabase.from('reconciliation_entries').select('id', { count: 'exact', head: true }).eq('status', 'mismatch'),
      supabase.from('settlement_transactions').select('id', { count: 'exact', head: true }).eq('match_status', 'mismatch'),
      supabase.from('channels').select('id, enabled, sync_status'),
      supabase.from('sync_logs').select('id, status').order('started_at', { ascending: false }).limit(50),
    ])

    const slaBreachCount = (slaOrders ?? []).filter((o) => new Date(o.sla_due_at!).getTime() < now).length
    const ndrOpenCount = (ndrRecords ?? []).filter((n) => !n.outcome || n.outcome === 'pending').length
    const failedIntegrationCount = (channels ?? []).filter((c) => c.enabled && c.sync_status === 'failed').length
    const failedSyncCount = (syncLogs ?? []).filter((l) => l.status === 'failed').length

    const defs: { type: string; priority: Enums<'notification_priority'>; href: string; count: number; label: string }[] = [
      { type: 'stock_shortage', priority: 'critical', href: '/orders', count: stockShortageCount ?? 0, label: 'stock shortage order(s)' },
      { type: 'sla_breach', priority: 'high', href: '/orders', count: slaBreachCount, label: 'order(s) past SLA' },
      { type: 'unmapped_sku', priority: 'medium', href: '/sku-mapping', count: unmappedCount ?? 0, label: 'unmapped SKU exception(s)' },
      { type: 'ndr', priority: 'medium', href: '/ndr', count: ndrOpenCount, label: 'open NDR record(s)' },
      { type: 'rto', priority: 'high', href: '/shipping', count: rtoCount ?? 0, label: 'RTO order(s)' },
      { type: 'reconciliation_mismatch', priority: 'high', href: '/reconciliation', count: (reconMismatchCount ?? 0) + (settlementMismatchCount ?? 0), label: 'reconciliation mismatch(es)' },
      { type: 'failed_integration', priority: 'critical', href: '/integrations', count: failedIntegrationCount, label: 'failed integration(s)' },
      { type: 'failed_sync', priority: 'medium', href: '/sync-logs', count: failedSyncCount, label: 'failed sync(s) (last 50)' },
    ]

    for (const def of defs) {
      if (def.count > 0) {
        await supabase.from('notifications').upsert(
          {
            organization_id: orgId,
            type: def.type,
            priority: def.priority,
            message: `${def.count} ${def.label}`,
            action_href: def.href,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'organization_id,type' }
        )
      } else {
        await supabase.from('notifications').delete().eq('organization_id', orgId).eq('type', def.type)
      }
    }

    const { data } = await supabase.from('notifications').select('*')
    const sorted = ((data ?? []) as Notification[]).sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.updated_at.localeCompare(a.updated_at))
    setNotifications(sorted)
    setLoading(false)
  }

  useEffect(() => {
    refreshAndLoad()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  async function markRead(n: Notification) {
    await supabase.from('notifications').update({ read: true }).eq('id', n.id)
    setNotifications((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
  }

  async function markAllRead() {
    await supabase.from('notifications').update({ read: true }).eq('organization_id', orgId!).eq('read', false)
    setNotifications((list) => list.map((x) => ({ ...x, read: true })))
  }

  const unreadCount = notifications.filter((n) => !n.read).length

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Notifications</h2>
        {unreadCount > 0 && (
          <button onClick={markAllRead} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
            Mark all read
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">
        Refreshed from live exception data every time this page loads — one entry per category (not per record), matching the Dashboard
        exceptions panel. Resolved categories disappear automatically.
      </p>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {loading ? (
          <Skeleton rows={4} />
        ) : notifications.length === 0 ? (
          <EmptyState icon="🔔" title="No open notifications — everything's clear." />
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-700/60">
            {notifications.map((n) => (
              <Link
                key={n.id}
                to={n.action_href ?? '#'}
                onClick={() => !n.read && markRead(n)}
                className={`block px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/40 ${n.read ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {!n.read && <span className="w-2 h-2 rounded-full bg-indigo-600 shrink-0" />}
                    <span className="text-sm text-slate-900 dark:text-slate-100">{n.message}</span>
                  </div>
                  <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded shrink-0 ${PRIORITY_COLOR[n.priority]}`}>{n.priority}</span>
                </div>
                <div className="text-xs text-slate-400 dark:text-slate-500 mt-1 ml-4">{format(new Date(n.updated_at), 'dd MMM yyyy, HH:mm')}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
