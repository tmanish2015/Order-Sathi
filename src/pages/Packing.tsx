import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables } from '../lib/database.types'

type Order = Tables<'orders'>
type LineItem = Tables<'order_line_items'> & { skus: Tables<'skus'> | null }

interface PackForm {
  package_count: string
  weight_kg: string
  length_cm: string
  width_cm: string
  height_cm: string
}

const BLANK_FORM: PackForm = { package_count: '1', weight_kg: '', length_cm: '', width_cm: '', height_cm: '' }

export default function Packing() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [orders, setOrders] = useState<Order[]>([])
  const [linesByOrder, setLinesByOrder] = useState<Record<string, LineItem[]>>({})
  const [loading, setLoading] = useState(true)
  const [forms, setForms] = useState<Record<string, PackForm>>({})
  const [packingId, setPackingId] = useState<string | null>(null)

  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const { data: pickedOrders } = await supabase.from('orders').select('*').eq('order_status', 'picked').order('order_date')
    setOrders(pickedOrders ?? [])
    if (pickedOrders && pickedOrders.length > 0) {
      const { data: lines } = await supabase.from('order_line_items').select('*, skus(*)').in('order_id', pickedOrders.map((o) => o.id))
      const byOrder: Record<string, LineItem[]> = {}
      for (const l of (lines as unknown as LineItem[]) ?? []) byOrder[l.order_id] = [...(byOrder[l.order_id] ?? []), l]
      setLinesByOrder(byOrder)
    } else {
      setLinesByOrder({})
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  function formFor(orderId: string): PackForm {
    return forms[orderId] ?? BLANK_FORM
  }

  function updateForm(orderId: string, patch: Partial<PackForm>) {
    setForms((f) => ({ ...f, [orderId]: { ...formFor(orderId), ...patch } }))
  }

  async function markPacked(order: Order) {
    const lines = linesByOrder[order.id] ?? []
    // Cannot pack unless every line's picked_qty covers its allocated_qty -
    // an order only reaches 'picked' status once that's already true, but
    // re-check here since Packing is meant to be the enforcement point, not
    // just a display of a status set elsewhere.
    const shortfall = lines.some((l) => l.picked_qty < l.allocated_qty)
    if (shortfall) {
      showError(`${order.amazon_order_id} has unpicked quantity remaining — cannot pack.`)
      return
    }
    const form = formFor(order.id)
    setPackingId(order.id)
    try {
      const { error: pkgError } = await supabase.from('packages').insert({
        organization_id: orgId!,
        order_id: order.id,
        package_count: Number(form.package_count) || 1,
        weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
        length_cm: form.length_cm ? Number(form.length_cm) : null,
        width_cm: form.width_cm ? Number(form.width_cm) : null,
        height_cm: form.height_cm ? Number(form.height_cm) : null,
        packed_by: profile!.id,
      })
      if (pkgError) throw pkgError

      for (const l of lines) {
        await supabase.from('order_line_items').update({ packed_qty: l.picked_qty }).eq('id', l.id)
      }
      const { error: statusError } = await supabase.from('orders').update({ order_status: 'packed' }).eq('id', order.id)
      if (statusError) throw statusError

      showSuccess(`${order.amazon_order_id} marked packed.`)
      load()
    } catch (err) {
      reportError(showError, 'Mark packed', err as { message: string }, orgId, profile?.id)
    } finally {
      setPackingId(null)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">Packing</h2>
      <p className="text-xs text-slate-400 mb-6">
        Orders that have been fully picked, waiting to be packed. Packing is blocked until every line's picked quantity covers what was
        allocated.
      </p>

      {loading ? (
        <Skeleton rows={3} />
      ) : orders.length === 0 ? (
        <EmptyState icon="📦" title="No orders waiting to be packed." />
      ) : (
        <div className="space-y-4">
          {orders.map((order) => {
            const lines = linesByOrder[order.id] ?? []
            const form = formFor(order.id)
            return (
              <div key={order.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="font-medium text-sm text-slate-900">{order.amazon_order_id}</div>
                    {order.customer_name && <div className="text-xs text-slate-400">{order.customer_name}</div>}
                  </div>
                </div>

                <table className="w-full text-sm mb-3">
                  <thead>
                    <tr className="text-left text-xs text-slate-400">
                      <th className="py-1 font-medium">SKU</th>
                      <th className="py-1 font-medium">Title</th>
                      <th className="py-1 font-medium text-right">Ordered</th>
                      <th className="py-1 font-medium text-right">Picked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id}>
                        <td className="py-1 text-slate-700">{l.skus?.sku}</td>
                        <td className="py-1 text-slate-500">{l.skus?.title}</td>
                        <td className="py-1 text-right text-slate-500">{l.quantity}</td>
                        <td className="py-1 text-right text-emerald-600 font-medium">{l.picked_qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {canEdit && (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                    <label className="block">
                      <span className="text-xs text-slate-500">Packages</span>
                      <input type="number" min="1" value={form.package_count} onChange={(e) => updateForm(order.id, { package_count: e.target.value })} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1.5" />
                    </label>
                    <label className="block">
                      <span className="text-xs text-slate-500">Weight (kg)</span>
                      <input type="number" step="0.01" value={form.weight_kg} onChange={(e) => updateForm(order.id, { weight_kg: e.target.value })} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1.5" />
                    </label>
                    <label className="block">
                      <span className="text-xs text-slate-500">L (cm)</span>
                      <input type="number" value={form.length_cm} onChange={(e) => updateForm(order.id, { length_cm: e.target.value })} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1.5" />
                    </label>
                    <label className="block">
                      <span className="text-xs text-slate-500">W (cm)</span>
                      <input type="number" value={form.width_cm} onChange={(e) => updateForm(order.id, { width_cm: e.target.value })} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1.5" />
                    </label>
                    <label className="block">
                      <span className="text-xs text-slate-500">H (cm)</span>
                      <input type="number" value={form.height_cm} onChange={(e) => updateForm(order.id, { height_cm: e.target.value })} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1.5" />
                    </label>
                  </div>
                )}

                {canEdit && (
                  <button
                    onClick={() => markPacked(order)}
                    disabled={packingId === order.id}
                    className="mt-3 text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {packingId === order.id ? 'Packing…' : 'Mark packed'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
