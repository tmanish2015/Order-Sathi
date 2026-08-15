import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { formatINR } from '../lib/format'
import type { Tables } from '../lib/database.types'

type Order = Tables<'orders'> & { channels: Tables<'channels'> | null }
type Channel = Tables<'channels'>

const STATUS_COLOR: Record<Order['order_status'], string> = {
  pending: 'bg-amber-100 text-amber-700',
  shipped: 'bg-blue-100 text-blue-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
  returned: 'bg-red-100 text-red-700',
}

export default function Dashboard() {
  const { profile } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const orgId = profile?.organization_id

  useEffect(() => {
    if (!orgId) return
    ;(async () => {
      const [{ data: o }, { data: c }] = await Promise.all([
        supabase.from('orders').select('*, channels(*)').order('order_date', { ascending: false }).limit(50),
        supabase.from('channels').select('*'),
      ])
      setOrders((o as unknown as Order[]) ?? [])
      setChannels(c ?? [])
      setLoading(false)
    })()
  }, [orgId])

  const connectedChannels = channels.filter((c) => c.status === 'connected')
  const gross = orders.reduce((sum, o) => sum + Number(o.gross_amount), 0)
  const pending = orders.filter((o) => o.order_status === 'pending').length
  const shipped = orders.filter((o) => o.order_status === 'shipped').length

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Orders</h2>
          <p className="text-xs text-slate-400 mt-0.5">{format(new Date(), 'EEEE, dd MMMM yyyy')}</p>
        </div>
        <Link to="/integrations" className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700">
          🔌 Connect Amazon
        </Link>
      </div>

      {channels.length === 0 && !loading && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-800">
          No Amazon channel connected yet. Orders won't sync until SP-API credentials are added —{' '}
          <Link to="/integrations" className="underline font-medium">connect one here</Link>.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <Stat label="Gross sales (last 50 orders)" value={formatINR(gross)} accent="indigo" />
        <Stat label="Pending" value={String(pending)} accent="amber" />
        <Stat label="Shipped" value={String(shipped)} accent="purple" />
        <Stat label="Channels connected" value={String(connectedChannels.length)} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 text-xs font-semibold uppercase text-slate-500">
          Recent orders
        </div>
        {loading ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">Loading…</p>
        ) : orders.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">No orders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-2 font-medium">Order ID</th>
                  <th className="px-4 py-2 font-medium">Channel</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-2.5 font-medium text-slate-700">{o.amazon_order_id}</td>
                    <td className="px-4 py-2.5 text-slate-500">{o.channels?.display_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500">{format(new Date(o.order_date), 'dd MMM yyyy')}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${STATUS_COLOR[o.order_status]}`}>
                        {o.order_status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-700">{formatINR(Number(o.gross_amount))}</td>
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

const ACCENTS = {
  indigo: 'from-indigo-500 to-indigo-600',
  purple: 'from-purple-500 to-purple-600',
  amber: 'from-amber-500 to-amber-600',
} as const

function Stat({ label, value, accent }: { label: string; value: string; accent?: keyof typeof ACCENTS }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5 sm:p-4 relative overflow-hidden">
      {accent && <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${ACCENTS[accent]}`} />}
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-lg sm:text-xl font-semibold mt-1 text-slate-900">{value}</div>
    </div>
  )
}
