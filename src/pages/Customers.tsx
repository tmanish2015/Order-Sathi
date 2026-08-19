import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { formatINR } from '../lib/format'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables } from '../lib/database.types'

type Order = Tables<'orders'>
type Return = Tables<'order_returns'>
type Channel = Tables<'channels'>

interface CustomerRow {
  key: string
  name: string
  orderCount: number
  totalSpend: number
  aov: number
  lastOrderDate: string
  returns: number
  rto: number
  cancellations: number
  preferredChannel: string
}

const UNIDENTIFIED_KEY = '__unidentified__'

export default function Customers() {
  const { profile } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [returns, setReturns] = useState<Return[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [sortBy, setSortBy] = useState<'spend' | 'orders' | 'recent'>('spend')

  const orgId = profile?.organization_id

  useEffect(() => {
    if (!orgId) return
    ;(async () => {
      setLoading(true)
      const [{ data: o }, { data: r }, { data: c }] = await Promise.all([
        supabase.from('orders').select('*'),
        supabase.from('order_returns').select('*'),
        supabase.from('channels').select('*'),
      ])
      setOrders(o ?? [])
      setReturns(r ?? [])
      setChannels(c ?? [])
      setLoading(false)
    })()
  }, [orgId])

  const channelById = new Map(channels.map((c) => [c.id, c.display_name]))

  const customers = useMemo(() => {
    const groups = new Map<string, { name: string; orders: Order[] }>()
    for (const o of orders) {
      const raw = o.customer_name?.trim()
      const key = raw ? raw.toLowerCase() : UNIDENTIFIED_KEY
      const existing = groups.get(key) ?? { name: raw || 'Unidentified', orders: [] }
      existing.orders.push(o)
      groups.set(key, existing)
    }

    const rows: CustomerRow[] = Array.from(groups.entries()).map(([key, g]) => {
      const orderIds = new Set(g.orders.map((o) => o.id))
      const totalSpend = g.orders.reduce((s, o) => s + Number(o.gross_amount), 0)
      const returnCount = returns.filter((r) => orderIds.has(r.order_id) && r.return_type === 'customer_return').length
      const rtoCount = returns.filter((r) => orderIds.has(r.order_id) && r.return_type === 'rto').length
      const cancellations = g.orders.filter((o) => o.order_status === 'cancelled').length
      const channelCounts: Record<string, number> = {}
      for (const o of g.orders) channelCounts[o.channel_id] = (channelCounts[o.channel_id] ?? 0) + 1
      const preferredChannelId = Object.entries(channelCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
      const lastOrderDate = g.orders.reduce((latest, o) => (o.order_date > latest ? o.order_date : latest), g.orders[0].order_date)
      return {
        key,
        name: g.name,
        orderCount: g.orders.length,
        totalSpend,
        aov: totalSpend / g.orders.length,
        lastOrderDate,
        returns: returnCount,
        rto: rtoCount,
        cancellations,
        preferredChannel: preferredChannelId ? channelById.get(preferredChannelId) ?? '—' : '—',
      }
    })

    let filtered = rows
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      filtered = filtered.filter((r) => r.name.toLowerCase().includes(q))
    }
    return filtered.sort((a, b) =>
      sortBy === 'spend' ? b.totalSpend - a.totalSpend : sortBy === 'orders' ? b.orderCount - a.orderCount : b.lastOrderDate.localeCompare(a.lastOrderDate)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, returns, channels, search, sortBy])

  const identifiedCount = customers.filter((c) => c.key !== UNIDENTIFIED_KEY).length
  const unidentifiedOrders = customers.find((c) => c.key === UNIDENTIFIED_KEY)?.orderCount ?? 0

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">Customer Intelligence</h2>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">
        Operational customer analytics derived from order history — not a CRM. Grouped by buyer name on the order, which Amazon often
        withholds without a PII data-access grant (same limitation already noted in the SP-API sync connector) — those orders are grouped
        under "Unidentified" rather than guessed at.
      </p>
      {unidentifiedOrders > 0 && (
        <p className="text-xs text-amber-600 mb-4">{unidentifiedOrders} order(s) have no buyer name available and can't be attributed to a customer.</p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-3.5">
          <div className="text-xs text-slate-400 dark:text-slate-500">Identified customers</div>
          <div className="text-lg font-semibold mt-1 text-slate-900 dark:text-slate-100">{identifiedCount}</div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-3.5">
          <div className="text-xs text-slate-400 dark:text-slate-500">Total orders</div>
          <div className="text-lg font-semibold mt-1 text-slate-900 dark:text-slate-100">{orders.length}</div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-3.5">
          <div className="text-xs text-slate-400 dark:text-slate-500">Total revenue</div>
          <div className="text-lg font-semibold mt-1 text-slate-900 dark:text-slate-100">{formatINR(orders.reduce((s, o) => s + Number(o.gross_amount), 0))}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer name…" className="text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 w-56 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="text-sm rounded-lg border border-slate-300 px-2 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100">
          <option value="spend">Sort: highest spend (LTV)</option>
          <option value="orders">Sort: most orders</option>
          <option value="recent">Sort: most recent order</option>
        </select>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {loading ? (
          <Skeleton rows={3} />
        ) : customers.length === 0 ? (
          <EmptyState icon="👤" title="No orders yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-700/60">
                  <th className="px-4 py-2 font-medium">Customer</th>
                  <th className="px-4 py-2 font-medium text-right">Orders</th>
                  <th className="px-4 py-2 font-medium text-right">Total spend (LTV)</th>
                  <th className="px-4 py-2 font-medium text-right">AOV</th>
                  <th className="px-4 py-2 font-medium">Last order</th>
                  <th className="px-4 py-2 font-medium text-right">Returns</th>
                  <th className="px-4 py-2 font-medium text-right">RTO</th>
                  <th className="px-4 py-2 font-medium text-right">Cancelled</th>
                  <th className="px-4 py-2 font-medium">Preferred channel</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
                {customers.map((c) => (
                  <tr key={c.key} className={c.key === UNIDENTIFIED_KEY ? 'text-slate-400 dark:text-slate-500' : ''}>
                    <td className="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-300">{c.name}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{c.orderCount}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-300 font-medium">{formatINR(c.totalSpend)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{formatINR(c.aov)}</td>
                    <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{format(new Date(c.lastOrderDate), 'dd MMM yyyy')}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{c.returns}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{c.rto}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{c.cancellations}</td>
                    <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{c.preferredChannel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
