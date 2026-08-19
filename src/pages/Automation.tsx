import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import ConfirmDialog from '../components/ConfirmDialog'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables, Enums, Json } from '../lib/database.types'

type Rule = Tables<'automation_rules'>
type Sku = Tables<'skus'>
type Channel = Tables<'channels'>
type Warehouse = Tables<'warehouses'>
type Courier = Tables<'couriers'>

const TRIGGER_LABEL: Record<Enums<'automation_trigger'>, string> = {
  inventory_low: 'Inventory: Available Stock < Reorder Level',
  order_value_channel: 'Order: Channel = X AND Value > Y',
  shipping_cod_pincode: 'Shipping: COD AND Pincode prefix = X',
  return_qc_resalable: 'Returns: QC Outcome = Resalable',
}

const TRIGGER_EVALUATED: Record<Enums<'automation_trigger'>, boolean> = {
  inventory_low: true,
  order_value_channel: false,
  shipping_cod_pincode: false,
  return_qc_resalable: true, // already the existing hardcoded QC behavior in Returns.tsx
}

export default function Automation() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [rules, setRules] = useState<Rule[]>([])
  const [skus, setSkus] = useState<Sku[]>([])
  const [ledger, setLedger] = useState<{ sku_id: string; quantity_delta: number }[]>([])
  const [lineItems, setLineItems] = useState<{ sku_id: string; allocated_qty: number; order_id: string }[]>([])
  const [orders, setOrders] = useState<{ id: string; order_status: string }[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [couriers, setCouriers] = useState<Courier[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Rule | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    name: '',
    trigger_type: 'inventory_low' as Enums<'automation_trigger'>,
    channel_id: '',
    min_value: '',
    warehouse_id: '',
    pincode_prefix: '',
    courier_id: '',
  })

  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const [{ data: r }, { data: s }, { data: l }, { data: li }, { data: o }, { data: c }, { data: w }, { data: cr }] = await Promise.all([
      supabase.from('automation_rules').select('*').order('created_at', { ascending: false }),
      supabase.from('skus').select('*').eq('active', true).eq('is_bundle', false).order('sku'),
      supabase.from('inventory_ledger').select('sku_id, quantity_delta'),
      supabase.from('order_line_items').select('sku_id, allocated_qty, order_id'),
      supabase.from('orders').select('id, order_status'),
      supabase.from('channels').select('*'),
      supabase.from('warehouses').select('*'),
      supabase.from('couriers').select('*').eq('active', true),
    ])
    setRules(r ?? [])
    setSkus(s ?? [])
    setLedger(l ?? [])
    setLineItems(li ?? [])
    setOrders(o ?? [])
    setChannels(c ?? [])
    setWarehouses(w ?? [])
    setCouriers(cr ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  // Read-only evaluation of the one wired trigger type: which SKUs
  // currently match "available stock < reorder level". Reuses the same
  // physical-minus-allocated math as Inventory/Orders - no new stock logic.
  const TERMINAL = ['delivered', 'cancelled', 'returned', 'rto']
  const openOrderIds = new Set(orders.filter((o) => !TERMINAL.includes(o.order_status)).map((o) => o.id))
  const stockBySku: Record<string, number> = {}
  for (const row of ledger) stockBySku[row.sku_id] = (stockBySku[row.sku_id] ?? 0) + row.quantity_delta
  const allocatedBySku: Record<string, number> = {}
  for (const li of lineItems) {
    if (!openOrderIds.has(li.order_id)) continue
    allocatedBySku[li.sku_id] = (allocatedBySku[li.sku_id] ?? 0) + li.allocated_qty
  }
  const matchingSkus = skus.filter((s) => {
    const available = Math.max((stockBySku[s.id] ?? 0) - (allocatedBySku[s.id] ?? 0), 0)
    return available <= s.reorder_level
  })

  function describeRule(r: Rule): string {
    const c = r.conditions as Record<string, Json>
    const a = r.actions as Record<string, Json>
    switch (r.trigger_type) {
      case 'inventory_low':
        return 'THEN flag SKU for reorder (see Forecast page for suggested quantities)'
      case 'order_value_channel': {
        const channel = channels.find((ch) => ch.id === c.channel_id)?.display_name ?? 'any channel'
        const warehouse = warehouses.find((w) => w.id === a.warehouse_id)?.name ?? '—'
        return `IF Channel = ${channel} AND Order Value > ₹${c.min_value ?? 0} THEN Assign Warehouse = ${warehouse}`
      }
      case 'shipping_cod_pincode': {
        const courier = couriers.find((co) => co.id === a.courier_id)?.name ?? '—'
        return `IF COD AND Pincode starts with ${c.pincode_prefix ?? '—'} THEN Assign Courier = ${courier}`
      }
      case 'return_qc_resalable':
        return 'THEN move return to Available Stock (already enforced by the Returns QC workflow)'
    }
  }

  async function createRule() {
    if (!orgId || !form.name.trim()) {
      showError('Name is required.')
      return
    }
    let conditions: Record<string, Json> = {}
    let actions: Record<string, Json> = {}
    if (form.trigger_type === 'order_value_channel') {
      if (!form.channel_id || !form.min_value || !form.warehouse_id) {
        showError('Channel, min value, and warehouse are all required for this trigger.')
        return
      }
      conditions = { channel_id: form.channel_id, min_value: Number(form.min_value) }
      actions = { warehouse_id: form.warehouse_id }
    } else if (form.trigger_type === 'shipping_cod_pincode') {
      if (!form.pincode_prefix.trim() || !form.courier_id) {
        showError('Pincode prefix and courier are both required for this trigger.')
        return
      }
      conditions = { pincode_prefix: form.pincode_prefix.trim() }
      actions = { courier_id: form.courier_id }
    }
    setSaving(true)
    const { error } = await supabase.from('automation_rules').insert({
      organization_id: orgId,
      name: form.name.trim(),
      trigger_type: form.trigger_type,
      conditions,
      actions,
      created_by: profile!.id,
    })
    setSaving(false)
    if (error) {
      reportError(showError, 'Create automation rule', error, orgId, profile?.id)
      return
    }
    showSuccess(`Rule "${form.name}" created.`)
    setForm({ name: '', trigger_type: 'inventory_low', channel_id: '', min_value: '', warehouse_id: '', pincode_prefix: '', courier_id: '' })
    setShowNew(false)
    load()
  }

  async function toggleActive(r: Rule) {
    const { error } = await supabase.from('automation_rules').update({ active: !r.active }).eq('id', r.id)
    if (error) {
      reportError(showError, 'Update rule', error, orgId, profile?.id)
      return
    }
    load()
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const { error } = await supabase.from('automation_rules').delete().eq('id', deleteTarget.id)
    setDeleting(false)
    setDeleteTarget(null)
    if (error) {
      reportError(showError, 'Delete rule', error, orgId, profile?.id)
      return
    }
    showSuccess('Rule deleted.')
    load()
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Automation</h2>
        {canEdit && (
          <button onClick={() => setShowNew((v) => !v)} className="text-sm rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700/40">
            {showNew ? 'Cancel' : '+ New rule'}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">
        Deliberately small and honest: <strong>Inventory</strong> and <strong>Returns QC</strong> triggers are actually evaluated (live
        below / already enforced by the QC workflow). <strong>Order</strong> and <strong>Shipping</strong> triggers can be defined here
        for planning, but aren't wired into order creation or shipment assignment yet — that would touch already-stable mutation paths
        and is deferred rather than rushed.
      </p>

      {showNew && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Rule name</span>
              <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Trigger</span>
              <select value={form.trigger_type} onChange={(e) => setForm((f) => ({ ...f, trigger_type: e.target.value as Enums<'automation_trigger'> }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100">
                {(Object.keys(TRIGGER_LABEL) as Enums<'automation_trigger'>[]).map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {form.trigger_type === 'order_value_channel' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <label className="block">
                <span className="text-xs text-slate-500 dark:text-slate-400">Channel</span>
                <select value={form.channel_id} onChange={(e) => setForm((f) => ({ ...f, channel_id: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100">
                  <option value="">Select…</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-slate-500 dark:text-slate-400">Min order value (₹)</span>
                <input type="number" value={form.min_value} onChange={(e) => setForm((f) => ({ ...f, min_value: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500 dark:text-slate-400">Assign warehouse</span>
                <select value={form.warehouse_id} onChange={(e) => setForm((f) => ({ ...f, warehouse_id: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100">
                  <option value="">Select…</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {form.trigger_type === 'shipping_cod_pincode' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <label className="block">
                <span className="text-xs text-slate-500 dark:text-slate-400">Pincode prefix (e.g. 302)</span>
                <input type="text" value={form.pincode_prefix} onChange={(e) => setForm((f) => ({ ...f, pincode_prefix: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500 dark:text-slate-400">Assign courier</span>
                <select value={form.courier_id} onChange={(e) => setForm((f) => ({ ...f, courier_id: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100">
                  <option value="">Select…</option>
                  {couriers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {(form.trigger_type === 'inventory_low' || form.trigger_type === 'return_qc_resalable') && (
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">No extra conditions needed — this trigger applies globally.</p>
          )}

          <button onClick={createRule} disabled={saving} className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Create rule'}
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden mb-6">
        {loading ? (
          <Skeleton rows={3} />
        ) : rules.length === 0 ? (
          <EmptyState icon="⚡" title="No automation rules yet." />
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-700/60">
            {rules.map((r) => (
              <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-medium text-sm text-slate-900 dark:text-slate-100">
                    {r.name}
                    {!TRIGGER_EVALUATED[r.trigger_type] && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 rounded px-1.5 py-0.5">Not wired yet</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{describeRule(r)}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${r.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-400 dark:bg-slate-900/40 dark:text-slate-300'}`}>
                    {r.active ? 'active' : 'inactive'}
                  </span>
                  {canEdit && (
                    <>
                      <button onClick={() => toggleActive(r)} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                        {r.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => setDeleteTarget(r)} className="text-xs text-slate-400 dark:text-slate-500 hover:text-red-600">
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!loading && rules.some((r) => r.trigger_type === 'inventory_low' && r.active) && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/60 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
            Currently matching (Inventory: Available &lt; Reorder Level) — {matchingSkus.length} SKU(s)
          </div>
          {matchingSkus.length === 0 ? (
            <EmptyState icon="✅" title="No SKUs currently below reorder level." />
          ) : (
            <div className="divide-y divide-slate-50 dark:divide-slate-700/60">
              {matchingSkus.map((s) => (
                <div key={s.id} className="px-4 py-2 text-sm text-slate-700 dark:text-slate-300">
                  {s.sku} — {s.title}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete automation rule?"
          message={`Delete "${deleteTarget.name}"? This can't be undone.`}
          confirmLabel="Delete"
          danger
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
