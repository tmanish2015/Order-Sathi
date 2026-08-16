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
type Courier = Tables<'couriers'>
type TrackingEvent = Tables<'shipment_tracking_events'>

const STATUS_COLOR: Record<Enums<'shipment_status'>, string> = {
  courier_assigned: 'bg-slate-100 text-slate-600',
  awb_assigned: 'bg-slate-100 text-slate-600',
  manifested: 'bg-indigo-100 text-indigo-700',
  shipped: 'bg-cyan-100 text-cyan-700',
  in_transit: 'bg-blue-100 text-blue-700',
  ndr: 'bg-amber-100 text-amber-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  rto: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
  failed: 'bg-red-100 text-red-700',
}

export default function Shipping() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
  const [org, setOrg] = useState<Organization | null>(null)
  const [couriers, setCouriers] = useState<Courier[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [generatingManifest, setGeneratingManifest] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [eventsByShipment, setEventsByShipment] = useState<Record<string, TrackingEvent[]>>({})

  const [orderIdInput, setOrderIdInput] = useState('')
  const [finding, setFinding] = useState(false)
  const [foundOrder, setFoundOrder] = useState<Order | null>(null)
  const [form, setForm] = useState({ courier_name: '', awb_number: '', tracking_url: '' })
  const [saving, setSaving] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const [showCourierPanel, setShowCourierPanel] = useState(false)
  const [courierForm, setCourierForm] = useState({ name: '', service_type: '', cod_support: false })
  const [savingCourier, setSavingCourier] = useState(false)

  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const [{ data }, { data: orgRow }, { data: courierRows }] = await Promise.all([
      supabase.from('shipments').select('*, orders(*)').order('created_at', { ascending: false }),
      supabase.from('organizations').select('*').eq('id', orgId).single(),
      supabase.from('couriers').select('*').eq('active', true).order('name'),
    ])
    setShipments((data as unknown as Shipment[]) ?? [])
    setOrg(orgRow ?? null)
    setCouriers(courierRows ?? [])
    if (courierRows && courierRows.length > 0 && !form.courier_name) setForm((f) => ({ ...f, courier_name: courierRows[0].name }))
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  async function addCourier() {
    if (!orgId || !courierForm.name.trim()) {
      showError('Courier name is required.')
      return
    }
    setSavingCourier(true)
    const { error } = await supabase.from('couriers').insert({
      organization_id: orgId,
      name: courierForm.name.trim(),
      service_type: courierForm.service_type || null,
      cod_support: courierForm.cod_support,
    })
    setSavingCourier(false)
    if (error) {
      reportError(showError, 'Add courier', error, orgId, profile?.id)
      return
    }
    showSuccess(`Courier "${courierForm.name}" added.`)
    setCourierForm({ name: '', service_type: '', cod_support: false })
    load()
  }

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
    if (!orgId || !foundOrder || !form.courier_name || !form.awb_number.trim()) {
      showError('Find an order, pick a courier, and enter an AWB number.')
      return
    }
    setSaving(true)
    const { data: shipment, error: shipError } = await supabase
      .from('shipments')
      .insert({
        organization_id: orgId,
        order_id: foundOrder.id,
        courier_name: form.courier_name,
        awb_number: form.awb_number.trim(),
        tracking_url: form.tracking_url || null,
        status: 'awb_assigned',
      })
      .select()
      .single()
    if (shipError || !shipment) {
      setSaving(false)
      reportError(showError, 'Record shipment', shipError ?? new Error('Insert failed'), orgId, profile?.id)
      return
    }
    await supabase.from('shipment_tracking_events').insert({ organization_id: orgId, shipment_id: shipment.id, status: 'awb_assigned', remarks: 'AWB assigned' })
    const { error: orderError } = await supabase.from('orders').update({ order_status: 'shipped' }).eq('id', foundOrder.id)
    setSaving(false)
    if (orderError) {
      reportError(showError, 'Update order status', orderError, orgId, profile?.id)
    }
    showSuccess(`Shipment recorded for ${foundOrder.amazon_order_id} — order marked shipped.`)
    setOrderIdInput('')
    setFoundOrder(null)
    setForm((f) => ({ ...f, awb_number: '', tracking_url: '' }))
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
    const couriersInSelection = new Set(targets.map((s) => s.courier_name))
    if (couriersInSelection.size > 1) {
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
      .update({ manifest_id: manifest.id, status: 'manifested' })
      .in('id', targets.map((s) => s.id))
    if (!updateError) {
      await supabase.from('shipment_tracking_events').insert(
        targets.map((s) => ({ organization_id: orgId, shipment_id: s.id, status: 'manifested' as const, remarks: `Manifest ${manifest.id.slice(0, 8)}` }))
      )
    }
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

  async function expand(s: Shipment) {
    setExpandedId(expandedId === s.id ? null : s.id)
    if (eventsByShipment[s.id]) return
    const { data } = await supabase.from('shipment_tracking_events').select('*').eq('shipment_id', s.id).order('event_time', { ascending: false })
    setEventsByShipment((m) => ({ ...m, [s.id]: data ?? [] }))
  }

  // Tracking history is append-only - each status change adds an event
  // rather than overwriting anything, so the full journey stays visible.
  async function updateStatus(s: Shipment, status: Enums<'shipment_status'>) {
    setUpdatingId(s.id)
    const { error } = await supabase.from('shipments').update({ status, updated_at: new Date().toISOString() }).eq('id', s.id)
    if (error) {
      setUpdatingId(null)
      reportError(showError, 'Update shipment status', error, orgId, profile?.id)
      return
    }
    await supabase.from('shipment_tracking_events').insert({ organization_id: orgId!, shipment_id: s.id, status })

    if (status === 'rto' && s.orders) {
      await supabase.from('orders').update({ order_status: 'rto' }).eq('id', s.order_id)
    } else if (status === 'delivered' && s.orders) {
      await supabase.from('orders').update({ order_status: 'delivered' }).eq('id', s.order_id)
    } else if (status === 'cancelled' && s.orders) {
      await supabase.from('orders').update({ order_status: 'cancelled' }).eq('id', s.order_id)
    } else if (status === 'ndr') {
      await supabase.from('ndr_records').insert({
        organization_id: orgId!,
        order_id: s.order_id,
        shipment_id: s.id,
        awb_number: s.awb_number,
        attempt_number: 1,
        created_by: profile!.id,
      })
    }
    setUpdatingId(null)
    setEventsByShipment((m) => {
      const rest = { ...m }
      delete rest[s.id]
      return rest
    })
    load()
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold text-slate-900">Shipping</h2>
        {profile?.role === 'admin' && (
          <button onClick={() => setShowCourierPanel((v) => !v)} className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
            {showCourierPanel ? 'Cancel' : '🚚 Manage couriers'}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400 mb-6">
        Manual AWB entry works today. A real 3PL integration (live tracking pulled automatically) needs a courier account's API
        credentials — architecture supports it, none is wired up live yet.
      </p>

      {showCourierPanel && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6">
          <div className="text-xs font-semibold uppercase text-slate-500 mb-3">Couriers</div>
          <div className="space-y-1 mb-3">
            {couriers.length === 0 ? (
              <p className="text-sm text-slate-400">No couriers configured yet.</p>
            ) : (
              couriers.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">
                    {c.name} {c.service_type && <span className="text-slate-400">· {c.service_type}</span>} {c.cod_support && <span className="text-emerald-600 text-xs">COD</span>}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">{c.api_status.replace('_', ' ')}</span>
                </div>
              ))
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
            <input type="text" placeholder="Name" value={courierForm.name} onChange={(e) => setCourierForm((f) => ({ ...f, name: e.target.value }))} className="text-sm rounded-lg border border-slate-300 px-2.5 py-1.5" />
            <input type="text" placeholder="Service type" value={courierForm.service_type} onChange={(e) => setCourierForm((f) => ({ ...f, service_type: e.target.value }))} className="text-sm rounded-lg border border-slate-300 px-2.5 py-1.5" />
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={courierForm.cod_support} onChange={(e) => setCourierForm((f) => ({ ...f, cod_support: e.target.checked }))} />
              COD support
            </label>
            <button onClick={addCourier} disabled={savingCourier} className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50">
              {savingCourier ? 'Saving…' : '+ Add courier'}
            </button>
          </div>
        </div>
      )}

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
                {couriers.length === 0 ? (
                  <p className="text-xs text-red-600 mt-1">No couriers configured — add one above first.</p>
                ) : (
                  <select
                    value={form.courier_name}
                    onChange={(e) => setForm((f) => ({ ...f, courier_name: e.target.value }))}
                    className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                  >
                    {couriers.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
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
                  disabled={saving || couriers.length === 0}
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
                  <>
                  <tr key={s.id}>
                    {canEdit && (
                      <td className="px-4 py-2.5">
                        {!s.manifest_id && <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => toggleSelected(s.id)} />}
                      </td>
                    )}
                    <td className="px-4 py-2.5 font-medium text-slate-700">
                      <button onClick={() => expand(s)} className="hover:underline">
                        {s.orders?.amazon_order_id ?? '—'}
                      </button>
                    </td>
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
                          <option value="awb_assigned">AWB Assigned</option>
                          <option value="manifested">Manifested</option>
                          <option value="shipped">Shipped</option>
                          <option value="in_transit">In transit</option>
                          <option value="ndr">NDR</option>
                          <option value="delivered">Delivered</option>
                          <option value="rto">RTO</option>
                          <option value="cancelled">Cancelled</option>
                          <option value="failed">Failed</option>
                        </select>
                      ) : (
                        <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${STATUS_COLOR[s.status]}`}>{s.status}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-400">{s.manifest_id ? '✓ manifested' : '—'}</td>
                  </tr>
                  {expandedId === s.id && (
                    <tr>
                      <td colSpan={7} className="px-4 py-3 bg-slate-50">
                        <div className="text-xs font-semibold uppercase text-slate-500 mb-2">Tracking history</div>
                        {(eventsByShipment[s.id] ?? []).length === 0 ? (
                          <p className="text-xs text-slate-400">No events yet.</p>
                        ) : (
                          <div className="space-y-1">
                            {(eventsByShipment[s.id] ?? []).map((e) => (
                              <div key={e.id} className="text-xs text-slate-600 flex items-center gap-2">
                                <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${STATUS_COLOR[e.status]}`}>{e.status}</span>
                                <span>{format(new Date(e.event_time), 'dd MMM yyyy, HH:mm')}</span>
                                {e.remarks && <span className="text-slate-400">— {e.remarks}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
