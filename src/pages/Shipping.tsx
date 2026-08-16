import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import { buildManifestPdf } from '../lib/manifestPdf'
import type { Tables, Enums } from '../lib/database.types'

type Order = Tables<'orders'>
type Shipment = Tables<'shipments'> & { orders: Tables<'orders'> | null }
type Organization = Tables<'organizations'>

const COURIERS = ['Delhivery', 'Shiprocket', 'Bluedart', 'DTDC', 'Ekart', 'XpressBees', 'Other']

const STATUS_COLOR: Record<Enums<'shipment_status'>, string> = {
  booked: 'bg-slate-100 text-slate-600',
  in_transit: 'bg-blue-100 text-blue-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  rto: 'bg-red-100 text-red-700',
  failed: 'bg-red-100 text-red-700',
}

export default function Shipping() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const [org, setOrg] = useState<Organization | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [generatingManifest, setGeneratingManifest] = useState(false)

  const [orderIdInput, setOrderIdInput] = useState('')
  const [finding, setFinding] = useState(false)
  const [foundOrder, setFoundOrder] = useState<Order | null>(null)
  const [form, setForm] = useState({ courier_name: COURIERS[0], awb_number: '', tracking_url: '' })
  const [saving, setSaving] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const [{ data }, { data: orgRow }] = await Promise.all([
      supabase.from('shipments').select('*, orders(*)').order('created_at', { ascending: false }),
      supabase.from('organizations').select('*').eq('id', orgId).single(),
    ])
    setShipments((data as unknown as Shipment[]) ?? [])
    setOrg(orgRow ?? null)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [orgId])

  async function findOrder() {
    if (!orderIdInput.trim()) return
    setFinding(true)
    setFoundOrder(null)
    const { data: order } = await supabase.from('orders').select('*').eq('amazon_order_id', orderIdInput.trim()).maybeSingle()
    if (!order) {
      showError(`No order found with ID ${orderIdInput.trim()}.`)
      setFinding(false)
      return
    }
    const { data: existing } = await supabase.from('shipments').select('id').eq('order_id', order.id).maybeSingle()
    if (existing) {
      showError(`Order ${order.amazon_order_id} already has a shipment recorded.`)
      setFinding(false)
      return
    }
    if (order.order_status !== 'ready_to_ship') {
      showError(`Order ${order.amazon_order_id} is "${order.order_status}", not Ready to Ship — pack it first, then mark Ready to Ship on the Orders page.`)
      setFinding(false)
      return
    }
    setFoundOrder(order)
    setFinding(false)
  }

  async function submitShipment() {
    if (!orgId || !foundOrder || !form.awb_number.trim()) {
      showError('Find an order and enter an AWB number.')
      return
    }
    setSaving(true)
    const { error: shipError } = await supabase.from('shipments').insert({
      organization_id: orgId,
      order_id: foundOrder.id,
      courier_name: form.courier_name,
      awb_number: form.awb_number.trim(),
      tracking_url: form.tracking_url || null,
    })
    if (shipError) {
      setSaving(false)
      reportError(showError, 'Record shipment', shipError, orgId, profile?.id)
      return
    }
    const { error: orderError } = await supabase.from('orders').update({ order_status: 'shipped' }).eq('id', foundOrder.id)
    setSaving(false)
    if (orderError) {
      reportError(showError, 'Update order status', orderError, orgId, profile?.id)
    }
    showSuccess(`Shipment recorded for ${foundOrder.amazon_order_id} — order marked shipped.`)
    setOrderIdInput('')
    setFoundOrder(null)
    setForm({ courier_name: COURIERS[0], awb_number: '', tracking_url: '' })
    load()
  }

  function toggleSelected(id: string) {
    setSelectedIds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function generateManifest() {
    if (!orgId || !org) return
    const targets = shipments.filter((s) => selectedIds.has(s.id))
    if (targets.length === 0) return
    const couriers = new Set(targets.map((s) => s.courier_name))
    if (couriers.size > 1) {
      showError('Select shipments from one courier at a time.')
      return
    }
    setGeneratingManifest(true)
    const courierName = targets[0].courier_name
    const { data: manifest, error } = await supabase
      .from('manifests')
      .insert({ organization_id: orgId, courier_name: courierName, shipment_count: targets.length, created_by: profile!.id })
      .select()
      .single()
    if (error || !manifest) {
      setGeneratingManifest(false)
      reportError(showError, 'Generate manifest', error ?? new Error('Insert failed'), orgId, profile?.id)
      return
    }
    const { error: updateError } = await supabase
      .from('shipments')
      .update({ manifest_id: manifest.id })
      .in('id', targets.map((s) => s.id))
    setGeneratingManifest(false)
    if (updateError) {
      reportError(showError, 'Link shipments to manifest', updateError, orgId, profile?.id)
      return
    }
    const blob = buildManifestPdf(org, courierName, targets)
    window.open(URL.createObjectURL(blob), '_blank')
    showSuccess(`Manifest generated for ${targets.length} shipment(s).`)
    setSelectedIds(new Set())
    load()
  }

  async function updateStatus(s: Shipment, status: Enums<'shipment_status'>) {
    setUpdatingId(s.id)
    const { error } = await supabase.from('shipments').update({ status, updated_at: new Date().toISOString() }).eq('id', s.id)
    setUpdatingId(null)
    if (error) {
      reportError(showError, 'Update shipment status', error, orgId, profile?.id)
      return
    }
    if (status === 'rto' && s.orders) {
      await supabase.from('orders').update({ order_status: 'rto' }).eq('id', s.order_id)
    } else if (status === 'delivered' && s.orders) {
      await supabase.from('orders').update({ order_status: 'delivered' }).eq('id', s.order_id)
    }
    load()
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">Shipping</h2>
      <p className="text-xs text-slate-400 mb-6">
        Manual AWB entry works today. A real 3PL integration (live tracking pulled automatically) needs your courier account's API
        credentials — same pattern as the Amazon connection under Integrations.
      </p>

      {canEdit && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6">
          <div className="text-xs font-semibold uppercase text-slate-500 mb-3">Record a shipment</div>
          <div className="flex items-end gap-2 mb-3">
            <label className="block">
              <span className="text-xs text-slate-500">Order ID</span>
              <input
                type="text"
                value={orderIdInput}
                onChange={(e) => setOrderIdInput(e.target.value)}
                placeholder="TEST-001"
                className="mt-1 text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 w-48"
              />
            </label>
            <button onClick={findOrder} disabled={finding} className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">
              {finding ? 'Finding…' : 'Find order'}
            </button>
          </div>

          {foundOrder && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-xs text-slate-500">Courier</span>
                <select
                  value={form.courier_name}
                  onChange={(e) => setForm((f) => ({ ...f, courier_name: e.target.value }))}
                  className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                >
                  {COURIERS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">AWB number</span>
                <input
                  type="text"
                  value={form.awb_number}
                  onChange={(e) => setForm((f) => ({ ...f, awb_number: e.target.value }))}
                  className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Tracking URL (optional)</span>
                <input
                  type="text"
                  value={form.tracking_url}
                  onChange={(e) => setForm((f) => ({ ...f, tracking_url: e.target.value }))}
                  className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
              </label>
              <div className="sm:col-span-3">
                <button
                  onClick={submitShipment}
                  disabled={saving}
                  className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Record shipment'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {canEdit && selectedIds.size > 0 && (
          <div className="px-4 py-2.5 border-b border-slate-100 bg-indigo-50 flex items-center gap-3 flex-wrap">
            <span className="text-xs font-medium text-indigo-700">{selectedIds.size} selected</span>
            <button onClick={generateManifest} disabled={generatingManifest} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50">
              {generatingManifest ? 'Generating…' : '📋 Generate manifest'}
            </button>
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-400 hover:text-slate-600">
              Clear
            </button>
          </div>
        )}
        {loading ? (
          <Skeleton />
        ) : shipments.length === 0 ? (
          <EmptyState icon="🚚" title="No shipments recorded yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  {canEdit && <th className="px-4 py-2 font-medium w-8"></th>}
                  <th className="px-4 py-2 font-medium">Order</th>
                  <th className="px-4 py-2 font-medium">Courier</th>
                  <th className="px-4 py-2 font-medium">AWB</th>
                  <th className="px-4 py-2 font-medium">Shipped</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Manifest</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {shipments.map((s) => (
                  <tr key={s.id}>
                    {canEdit && (
                      <td className="px-4 py-2.5">
                        {!s.manifest_id && <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => toggleSelected(s.id)} />}
                      </td>
                    )}
                    <td className="px-4 py-2.5 font-medium text-slate-700">{s.orders?.amazon_order_id ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500">{s.courier_name}</td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {s.tracking_url ? (
                        <a href={s.tracking_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                          {s.awb_number}
                        </a>
                      ) : (
                        s.awb_number
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{format(new Date(s.shipped_at), 'dd MMM yyyy')}</td>
                    <td className="px-4 py-2.5">
                      {canEdit ? (
                        <select
                          value={s.status}
                          onChange={(e) => updateStatus(s, e.target.value as Enums<'shipment_status'>)}
                          disabled={updatingId === s.id}
                          className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded border-0 ${STATUS_COLOR[s.status]}`}
                        >
                          <option value="booked">Booked</option>
                          <option value="in_transit">In transit</option>
                          <option value="delivered">Delivered</option>
                          <option value="rto">RTO</option>
                          <option value="failed">Failed</option>
                        </select>
                      ) : (
                        <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${STATUS_COLOR[s.status]}`}>{s.status}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-400">{s.manifest_id ? '✓ manifested' : '—'}</td>
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
