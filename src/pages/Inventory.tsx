import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import { formatINR } from '../lib/format'
import ConfirmDialog from '../components/ConfirmDialog'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import { buildLabelSheetPdf } from '../lib/labelPdf'
import type { Tables, Enums } from '../lib/database.types'

type Sku = Tables<'skus'>
type Ledger = Tables<'inventory_ledger'>
type Channel = Tables<'channels'>
type Warehouse = Tables<'warehouses'>
type Bin = Tables<'bins'>

const SELL_THROUGH_WINDOW_DAYS = 14
const REORDER_ALERT_DAYS = 7

type BundleComponent = Tables<'bundle_components'>

interface SkuFormValues {
  title: string
  gst_rate: string
  buffer_stock: string
  product_type: string
  cost_price: string
  is_bundle: boolean
  reorder_level: string
  min_stock: string
  max_stock: string
  safety_stock: string
  reorder_qty: string
  lead_time_days: string
  barcode: string
  brand: string
  category: string
  subcategory: string
  description: string
  image_url: string
  weight_kg: string
  length_cm: string
  width_cm: string
  height_cm: string
  tracking_mode: Enums<'sku_tracking_mode'>
}

function toFormValues(s: Sku): SkuFormValues {
  return {
    title: s.title,
    gst_rate: String(s.gst_rate),
    buffer_stock: String(s.buffer_stock),
    product_type: s.product_type ?? '',
    cost_price: String(s.cost_price),
    is_bundle: s.is_bundle,
    reorder_level: String(s.reorder_level),
    min_stock: String(s.min_stock),
    max_stock: s.max_stock != null ? String(s.max_stock) : '',
    safety_stock: String(s.safety_stock),
    reorder_qty: String(s.reorder_qty),
    lead_time_days: String(s.lead_time_days),
    barcode: s.barcode ?? '',
    brand: s.brand ?? '',
    category: s.category ?? '',
    subcategory: s.subcategory ?? '',
    description: s.description ?? '',
    image_url: s.image_url ?? '',
    weight_kg: s.weight_kg != null ? String(s.weight_kg) : '',
    length_cm: s.length_cm != null ? String(s.length_cm) : '',
    width_cm: s.width_cm != null ? String(s.width_cm) : '',
    height_cm: s.height_cm != null ? String(s.height_cm) : '',
    tracking_mode: s.tracking_mode,
  }
}

// Movement classification thresholds, based on the same 14-day sell-through
// rate already computed for the reorder alert.
const FAST_MOVING_RATE = 1
type MovementClass = 'fast' | 'slow' | 'non'
function movementClass(rate: number): MovementClass {
  if (rate >= FAST_MOVING_RATE) return 'fast'
  if (rate > 0) return 'slow'
  return 'non'
}

type AlertKind = 'out_of_stock' | 'low_stock' | 'overstock' | 'fast_moving' | 'slow_moving' | 'non_moving'

export default function Inventory() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [skus, setSkus] = useState<Sku[]>([])
  const [ledger, setLedger] = useState<Ledger[]>([])
  const [dailyRateBySku, setDailyRateBySku] = useState<Record<string, number>>({})
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannel, setSelectedChannel] = useState('')
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [bins, setBins] = useState<Bin[]>([])
  const [showAdjust, setShowAdjust] = useState(false)
  const [adjustForm, setAdjustForm] = useState({ sku_id: '', warehouse_id: '', bin_id: '', movement_type: 'restock' as 'restock' | 'manual_adjustment', quantity: '', note: '' })
  const [savingAdjust, setSavingAdjust] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<SkuFormValues>({
    title: '',
    gst_rate: '',
    buffer_stock: '',
    product_type: '',
    cost_price: '',
    is_bundle: false,
    reorder_level: '',
    min_stock: '',
    max_stock: '',
    safety_stock: '',
    reorder_qty: '',
    lead_time_days: '',
    barcode: '',
    brand: '',
    category: '',
    subcategory: '',
    description: '',
    image_url: '',
    weight_kg: '',
    length_cm: '',
    width_cm: '',
    height_cm: '',
    tracking_mode: 'none',
  })
  const [savingEdit, setSavingEdit] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Sku | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showAddSku, setShowAddSku] = useState(false)
  const [newSku, setNewSku] = useState({
    sku: '',
    title: '',
    gst_rate: '18',
    buffer_stock: '0',
    cost_price: '0',
    is_bundle: false,
    reorder_level: '0',
    min_stock: '0',
    max_stock: '',
    safety_stock: '0',
    reorder_qty: '0',
    lead_time_days: '0',
    barcode: '',
    brand: '',
    category: '',
  })
  const [alertFilter, setAlertFilter] = useState<AlertKind | ''>('')
  const [savingSku, setSavingSku] = useState(false)
  const [bundleComponents, setBundleComponents] = useState<BundleComponent[]>([])
  const [expandedBundleId, setExpandedBundleId] = useState<string | null>(null)
  const [newComponent, setNewComponent] = useState({ component_sku_id: '', quantity: '1' })
  const [savingComponent, setSavingComponent] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [labelCopies, setLabelCopies] = useState('1')
  const [showLabelPanel, setShowLabelPanel] = useState(false)
  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops'
  const canDelete = canEdit

  async function load() {
    if (!orgId) return
    setLoading(true)
    const [{ data: s }, { data: l }, { data: c }, { data: w }, { data: b }, { data: bc }] = await Promise.all([
      supabase.from('skus').select('*').order('sku'),
      supabase.from('inventory_ledger').select('*'),
      supabase.from('channels').select('*'),
      supabase.from('warehouses').select('*').order('name'),
      supabase.from('bins').select('*').order('code'),
      supabase.from('bundle_components').select('*'),
    ])
    setBins(b ?? [])
    setSkus(s ?? [])
    setLedger((l as Ledger[]) ?? [])
    setBundleComponents(bc ?? [])

    // Recent sell-through: units sold per day over the last 14 days, from
    // order_deduction movements only (restocks/returns/adjustments don't
    // represent demand). Always across all warehouses - reorder timing
    // depends on total demand, not where it's currently sitting.
    const cutoff = Date.now() - SELL_THROUGH_WINDOW_DAYS * 24 * 60 * 60 * 1000
    const soldRecent: Record<string, number> = {}
    for (const row of (l ?? []) as Ledger[]) {
      if (row.movement_type !== 'order_deduction') continue
      if (new Date(row.created_at).getTime() < cutoff) continue
      soldRecent[row.sku_id] = (soldRecent[row.sku_id] ?? 0) + -row.quantity_delta
    }
    const rates: Record<string, number> = {}
    for (const [skuId, units] of Object.entries(soldRecent)) {
      rates[skuId] = units / SELL_THROUGH_WINDOW_DAYS
    }
    setDailyRateBySku(rates)

    setChannels(c ?? [])
    if (c && c.length === 1) setSelectedChannel(c[0].id)
    setWarehouses(w ?? [])
    if (w && w.length > 0) {
      setAdjustForm((f) => (f.warehouse_id ? f : { ...f, warehouse_id: w.find((x) => x.is_default)?.id ?? w[0].id }))
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [orgId])

  const stockBySku = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const row of ledger) {
      if (warehouseFilter && row.warehouse_id !== warehouseFilter) continue
      totals[row.sku_id] = (totals[row.sku_id] ?? 0) + row.quantity_delta
    }
    return totals
  }, [ledger, warehouseFilter])

  // A bundle SKU doesn't hold its own stock — how many can be assembled is
  // capped by whichever component runs out first.
  function bundleAvailable(bundleSkuId: string): number {
    const components = bundleComponents.filter((c) => c.bundle_sku_id === bundleSkuId)
    if (components.length === 0) return 0
    return Math.min(...components.map((c) => Math.floor((stockBySku[c.component_sku_id] ?? 0) / c.quantity)))
  }

  // Classification used to sort every non-bundle SKU into exactly one
  // inventory-health bucket for the alert filter chips below.
  function alertKindFor(s: Sku): AlertKind {
    const stock = s.is_bundle ? bundleAvailable(s.id) : stockBySku[s.id] ?? 0
    const available = s.is_bundle ? stock : Math.max(stock - s.buffer_stock, 0)
    if (available <= 0) return 'out_of_stock'
    if (available <= s.reorder_level) return 'low_stock'
    if (s.max_stock != null && stock > s.max_stock) return 'overstock'
    return movementClass(dailyRateBySku[s.id] ?? 0) === 'fast' ? 'fast_moving' : movementClass(dailyRateBySku[s.id] ?? 0) === 'slow' ? 'slow_moving' : 'non_moving'
  }

  const alertCounts = useMemo(() => {
    const counts: Record<AlertKind, number> = { out_of_stock: 0, low_stock: 0, overstock: 0, fast_moving: 0, slow_moving: 0, non_moving: 0 }
    for (const s of skus) counts[alertKindFor(s)]++
    return counts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skus, stockBySku, dailyRateBySku, bundleComponents])

  const filteredSkus = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = skus
    if (q) list = list.filter((s) => s.sku.toLowerCase().includes(q) || s.title.toLowerCase().includes(q))
    if (alertFilter) list = list.filter((s) => alertKindFor(s) === alertFilter)
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skus, search, alertFilter, stockBySku, dailyRateBySku])

  function daysToBuffer(s: Sku): number | null {
    const stock = stockBySku[s.id] ?? 0
    const rate = dailyRateBySku[s.id] ?? 0
    if (rate <= 0) return null // no recent sales, can't estimate
    return Math.max((stock - s.buffer_stock) / rate, 0)
  }

  const reorderAlerts = useMemo(() => {
    return skus
      .map((s) => ({ sku: s, days: daysToBuffer(s), rate: dailyRateBySku[s.id] ?? 0 }))
      .filter((r) => r.days != null && r.days <= REORDER_ALERT_DAYS)
      .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skus, stockBySku, dailyRateBySku])

  function startEdit(s: Sku) {
    setEditingId(s.id)
    setEditForm(toFormValues(s))
  }

  async function saveEdit(s: Sku) {
    if (!editForm.title.trim()) {
      showError('Title is required.')
      return
    }
    setSavingEdit(true)
    const { error } = await supabase
      .from('skus')
      .update({
        title: editForm.title.trim(),
        gst_rate: Number(editForm.gst_rate) || 0,
        buffer_stock: Number(editForm.buffer_stock) || 0,
        product_type: editForm.product_type.trim() || null,
        cost_price: Number(editForm.cost_price) || 0,
        is_bundle: editForm.is_bundle,
        reorder_level: Number(editForm.reorder_level) || 0,
        min_stock: Number(editForm.min_stock) || 0,
        max_stock: editForm.max_stock.trim() ? Number(editForm.max_stock) : null,
        safety_stock: Number(editForm.safety_stock) || 0,
        reorder_qty: Number(editForm.reorder_qty) || 0,
        lead_time_days: Number(editForm.lead_time_days) || 0,
        barcode: editForm.barcode.trim() || null,
        brand: editForm.brand.trim() || null,
        category: editForm.category.trim() || null,
        subcategory: editForm.subcategory.trim() || null,
        description: editForm.description.trim() || null,
        image_url: editForm.image_url.trim() || null,
        weight_kg: editForm.weight_kg.trim() ? Number(editForm.weight_kg) : null,
        length_cm: editForm.length_cm.trim() ? Number(editForm.length_cm) : null,
        width_cm: editForm.width_cm.trim() ? Number(editForm.width_cm) : null,
        height_cm: editForm.height_cm.trim() ? Number(editForm.height_cm) : null,
        tracking_mode: editForm.tracking_mode,
      })
      .eq('id', s.id)
    setSavingEdit(false)
    if (error) {
      reportError(showError, 'Save SKU', error, orgId, profile?.id)
      return
    }
    setEditingId(null)
    load()
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const { error } = await supabase.from('skus').delete().eq('id', deleteTarget.id)
    setDeleting(false)
    setDeleteTarget(null)
    if (error) {
      reportError(showError, 'Delete SKU', error, orgId, profile?.id)
      return
    }
    showSuccess(`SKU ${deleteTarget.sku} deleted.`)
    load()
  }

  async function addSku() {
    if (!orgId || !newSku.sku.trim() || !newSku.title.trim()) {
      showError('SKU and title are required.')
      return
    }
    setSavingSku(true)
    const { error } = await supabase.from('skus').insert({
      organization_id: orgId,
      sku: newSku.sku.trim(),
      title: newSku.title.trim(),
      gst_rate: Number(newSku.gst_rate) || 0,
      buffer_stock: Number(newSku.buffer_stock) || 0,
      cost_price: Number(newSku.cost_price) || 0,
      is_bundle: newSku.is_bundle,
      reorder_level: Number(newSku.reorder_level) || 0,
      min_stock: Number(newSku.min_stock) || 0,
      max_stock: newSku.max_stock.trim() ? Number(newSku.max_stock) : null,
      safety_stock: Number(newSku.safety_stock) || 0,
      reorder_qty: Number(newSku.reorder_qty) || 0,
      lead_time_days: Number(newSku.lead_time_days) || 0,
      barcode: newSku.barcode.trim() || null,
      brand: newSku.brand.trim() || null,
      category: newSku.category.trim() || null,
    })
    setSavingSku(false)
    if (error) {
      reportError(showError, 'Add SKU', error, orgId, profile?.id)
      return
    }
    showSuccess(`SKU ${newSku.sku} added.`)
    setNewSku({
      sku: '',
      title: '',
      gst_rate: '18',
      buffer_stock: '0',
      cost_price: '0',
      is_bundle: false,
      reorder_level: '0',
      min_stock: '0',
      max_stock: '',
      safety_stock: '0',
      reorder_qty: '0',
      lead_time_days: '0',
      barcode: '',
      brand: '',
      category: '',
    })
    setShowAddSku(false)
    load()
  }

  async function submitAdjustment() {
    if (!orgId) return
    const qty = Number(adjustForm.quantity)
    if (!adjustForm.sku_id || !adjustForm.warehouse_id || !Number.isFinite(qty) || qty === 0) {
      showError('Pick a SKU, warehouse, and a non-zero quantity.')
      return
    }
    setSavingAdjust(true)
    const { error } = await supabase.from('inventory_ledger').insert({
      organization_id: orgId,
      sku_id: adjustForm.sku_id,
      warehouse_id: adjustForm.warehouse_id,
      bin_id: adjustForm.bin_id || null,
      movement_type: adjustForm.movement_type,
      quantity_delta: qty,
      note: adjustForm.note || null,
      created_by: profile!.id,
    })
    setSavingAdjust(false)
    if (error) {
      reportError(showError, 'Adjust stock', error, orgId, profile?.id)
      return
    }
    showSuccess('Stock adjusted.')
    setAdjustForm((f) => ({ ...f, quantity: '', note: '', bin_id: '' }))
    setShowAdjust(false)
    load()
  }

  async function addComponent(bundleSkuId: string) {
    if (!orgId || !newComponent.component_sku_id) {
      showError('Pick a component SKU.')
      return
    }
    const qty = Number(newComponent.quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      showError('Quantity must be a positive number.')
      return
    }
    setSavingComponent(true)
    const { error } = await supabase.from('bundle_components').insert({
      organization_id: orgId,
      bundle_sku_id: bundleSkuId,
      component_sku_id: newComponent.component_sku_id,
      quantity: qty,
    })
    setSavingComponent(false)
    if (error) {
      reportError(showError, 'Add bundle component', error, orgId, profile?.id)
      return
    }
    setNewComponent({ component_sku_id: '', quantity: '1' })
    load()
  }

  async function removeComponent(id: string) {
    const { error } = await supabase.from('bundle_components').delete().eq('id', id)
    if (error) {
      reportError(showError, 'Remove bundle component', error, orgId, profile?.id)
      return
    }
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

  function printLabels() {
    const copies = Math.max(1, Number(labelCopies) || 1)
    const specs = filteredSkus.filter((s) => selectedIds.has(s.id)).map((s) => ({ sku: s, copies }))
    if (specs.length === 0) {
      showError('Select at least one SKU.')
      return
    }
    const blob = buildLabelSheetPdf(specs)
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    setShowLabelPanel(false)
  }

  async function pushToAmazon() {
    if (!selectedChannel) return
    setPushing(true)
    const { data, error } = await supabase.functions.invoke('sp-api-inventory-push', { body: { channel_id: selectedChannel } })
    setPushing(false)
    if (error) {
      reportError(showError, 'Push inventory', error, orgId, profile?.id)
      return
    }
    showSuccess(`Inventory push ${data?.status ?? 'submitted'} — check Sync Logs for per-SKU detail.`)
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold text-slate-900">Inventory</h2>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAdjust((v) => !v)}
              className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
            >
              {showAdjust ? 'Cancel' : '⇅ Adjust stock'}
            </button>
            <button
              onClick={() => setShowAddSku((v) => !v)}
              className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
            >
              {showAddSku ? 'Cancel' : '+ Add SKU'}
            </button>
          </div>
        )}
      </div>

      {showAdjust && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6 grid grid-cols-1 sm:grid-cols-6 gap-3 items-end">
          <label className="block sm:col-span-2">
            <span className="text-xs text-slate-500">SKU</span>
            <select
              value={adjustForm.sku_id}
              onChange={(e) => setAdjustForm((f) => ({ ...f, sku_id: e.target.value }))}
              className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
            >
              <option value="">Select SKU…</option>
              {skus.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.sku} — {s.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Warehouse</span>
            <select
              value={adjustForm.warehouse_id}
              onChange={(e) => setAdjustForm((f) => ({ ...f, warehouse_id: e.target.value, bin_id: '' }))}
              className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
            >
              {warehouses.length === 0 && <option value="">No warehouses yet</option>}
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Bin (optional)</span>
            <select
              value={adjustForm.bin_id}
              onChange={(e) => setAdjustForm((f) => ({ ...f, bin_id: e.target.value }))}
              className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
            >
              <option value="">No bin</option>
              {bins.filter((b) => b.warehouse_id === adjustForm.warehouse_id).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Type</span>
            <select
              value={adjustForm.movement_type}
              onChange={(e) => setAdjustForm((f) => ({ ...f, movement_type: e.target.value as 'restock' | 'manual_adjustment' }))}
              className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
            >
              <option value="restock">Restock</option>
              <option value="manual_adjustment">Manual adjustment</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Quantity (+/-)</span>
            <input
              type="number"
              value={adjustForm.quantity}
              onChange={(e) => setAdjustForm((f) => ({ ...f, quantity: e.target.value }))}
              placeholder="e.g. 20 or -3"
              className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
            />
          </label>
          <label className="block sm:col-span-4">
            <span className="text-xs text-slate-500">Note</span>
            <input
              type="text"
              value={adjustForm.note}
              onChange={(e) => setAdjustForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="e.g. New stock from supplier, invoice #123"
              className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
            />
          </label>
          <div>
            <button
              onClick={submitAdjustment}
              disabled={savingAdjust || warehouses.length === 0}
              className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50"
            >
              {savingAdjust ? 'Saving…' : 'Apply'}
            </button>
          </div>
        </div>
      )}

      {showAddSku && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
          <label className="block">
            <span className="text-xs text-slate-500">SKU code</span>
            <input
              type="text"
              value={newSku.sku}
              onChange={(e) => setNewSku((f) => ({ ...f, sku: e.target.value }))}
              className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Title</span>
            <input
              type="text"
              value={newSku.title}
              onChange={(e) => setNewSku((f) => ({ ...f, title: e.target.value }))}
              className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">GST rate %</span>
            <input
              type="number"
              value={newSku.gst_rate}
              onChange={(e) => setNewSku((f) => ({ ...f, gst_rate: e.target.value }))}
              className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Buffer stock</span>
            <input
              type="number"
              value={newSku.buffer_stock}
              onChange={(e) => setNewSku((f) => ({ ...f, buffer_stock: e.target.value }))}
              className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Cost price (₹/unit)</span>
            <input
              type="number"
              value={newSku.cost_price}
              onChange={(e) => setNewSku((f) => ({ ...f, cost_price: e.target.value }))}
              className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Barcode (optional)</span>
            <input
              type="text"
              value={newSku.barcode}
              onChange={(e) => setNewSku((f) => ({ ...f, barcode: e.target.value }))}
              placeholder="Scan or type"
              className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Brand</span>
            <input
              type="text"
              value={newSku.brand}
              onChange={(e) => setNewSku((f) => ({ ...f, brand: e.target.value }))}
              className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Category</span>
            <input
              type="text"
              value={newSku.category}
              onChange={(e) => setNewSku((f) => ({ ...f, category: e.target.value }))}
              className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
            />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-600 pb-1.5">
            <input type="checkbox" checked={newSku.is_bundle} onChange={(e) => setNewSku((f) => ({ ...f, is_bundle: e.target.checked }))} />
            Bundle (add components after saving)
          </label>
          <div className="sm:col-span-5 text-xs font-semibold uppercase text-slate-500 -mb-1">Inventory planning</div>
          <label className="block">
            <span className="text-xs text-slate-500">Reorder level</span>
            <input type="number" value={newSku.reorder_level} onChange={(e) => setNewSku((f) => ({ ...f, reorder_level: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Min stock</span>
            <input type="number" value={newSku.min_stock} onChange={(e) => setNewSku((f) => ({ ...f, min_stock: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Max stock</span>
            <input type="number" value={newSku.max_stock} onChange={(e) => setNewSku((f) => ({ ...f, max_stock: e.target.value }))} placeholder="No cap" className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Safety stock</span>
            <input type="number" value={newSku.safety_stock} onChange={(e) => setNewSku((f) => ({ ...f, safety_stock: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Reorder qty</span>
            <input type="number" value={newSku.reorder_qty} onChange={(e) => setNewSku((f) => ({ ...f, reorder_qty: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Lead time (days)</span>
            <input type="number" value={newSku.lead_time_days} onChange={(e) => setNewSku((f) => ({ ...f, lead_time_days: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5" />
          </label>
          <div className="sm:col-span-5">
            <button
              onClick={addSku}
              disabled={savingSku}
              className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50"
            >
              {savingSku ? 'Saving…' : 'Add SKU'}
            </button>
          </div>
        </div>
      )}

      {canEdit && channels.length > 0 && (
        <div className="flex items-center gap-2 mb-1">
          {channels.length > 1 && (
            <select
              value={selectedChannel}
              onChange={(e) => setSelectedChannel(e.target.value)}
              className="text-sm rounded-lg border border-slate-300 px-2 py-1.5"
            >
              <option value="">Select channel…</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={pushToAmazon}
            disabled={!selectedChannel || pushing}
            className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50"
          >
            {pushing ? 'Pushing…' : 'Push to Amazon'}
          </button>
        </div>
      )}
      <p className="text-xs text-slate-400 mb-6">
        One central ledger per SKU. Stock = sum of every movement (order deduction, restock, return, manual adjustment) — never edited directly.
        Amazon needs each SKU's product type before quantity can push.
      </p>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-6">
        {(
          [
            ['out_of_stock', 'Out of stock', 'border-red-400 ring-1 ring-red-300'],
            ['low_stock', 'Low stock', 'border-amber-400 ring-1 ring-amber-300'],
            ['overstock', 'Overstock', 'border-purple-400 ring-1 ring-purple-300'],
            ['fast_moving', 'Fast moving', 'border-emerald-400 ring-1 ring-emerald-300'],
            ['slow_moving', 'Slow moving', 'border-amber-400 ring-1 ring-amber-300'],
            ['non_moving', 'Non moving', 'border-slate-400 ring-1 ring-slate-300'],
          ] as [AlertKind, string, string][]
        ).map(([kind, label, activeClass]) => (
          <button
            key={kind}
            onClick={() => setAlertFilter(alertFilter === kind ? '' : kind)}
            className={`text-left bg-white rounded-lg border px-3 py-2 transition-colors ${
              alertFilter === kind ? activeClass : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className="text-[11px] text-slate-500">{label}</div>
            <div className="text-lg font-semibold text-slate-900 mt-0.5">{alertCounts[kind]}</div>
          </button>
        ))}
      </div>

      {reorderAlerts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <div className="text-sm font-medium text-amber-800 mb-1.5">
            {reorderAlerts.length} SKU{reorderAlerts.length > 1 ? 's' : ''} hitting buffer stock soon
          </div>
          <ul className="text-sm text-amber-700 space-y-0.5">
            {reorderAlerts.map((r) => (
              <li key={r.sku.id}>
                <strong>{r.sku.sku}</strong> — hits buffer stock in ~{Math.round(r.days ?? 0)} day{Math.round(r.days ?? 0) === 1 ? '' : 's'} at current
                sell-through ({r.rate.toFixed(1)} units/day)
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SKU or title…"
            className="text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 w-56"
          />
          {warehouses.length > 1 && (
            <select
              value={warehouseFilter}
              onChange={(e) => setWarehouseFilter(e.target.value)}
              className="text-sm rounded-lg border border-slate-300 px-2 py-1.5"
            >
              <option value="">Stock: all warehouses</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  Stock: {w.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {selectedIds.size > 0 && (
          <div className="px-4 py-2.5 border-b border-slate-100 bg-indigo-50 flex items-center gap-3 flex-wrap">
            <span className="text-xs font-medium text-indigo-700">{selectedIds.size} selected</span>
            {showLabelPanel ? (
              <>
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  Copies per SKU
                  <input
                    type="number"
                    min="1"
                    value={labelCopies}
                    onChange={(e) => setLabelCopies(e.target.value)}
                    className="w-16 text-sm rounded-lg border border-slate-300 px-2 py-1"
                  />
                </label>
                <button onClick={printLabels} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                  Generate PDF
                </button>
                <button onClick={() => setShowLabelPanel(false)} className="text-xs text-slate-400 hover:text-slate-600">
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={() => setShowLabelPanel(true)} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                🏷 Print labels
              </button>
            )}
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-400 hover:text-slate-600">
              Clear
            </button>
          </div>
        )}
        {loading ? (
          <Skeleton />
        ) : filteredSkus.length === 0 ? (
          <EmptyState icon="📋" title={search ? 'No SKUs match this search.' : 'No SKUs yet.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-2 font-medium w-8">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === filteredSkus.length && filteredSkus.length > 0}
                      onChange={() => setSelectedIds((s) => (s.size === filteredSkus.length ? new Set() : new Set(filteredSkus.map((sk) => sk.id))))}
                    />
                  </th>
                  <th className="px-4 py-2 font-medium">SKU</th>
                  <th className="px-4 py-2 font-medium">Title</th>
                  <th className="px-4 py-2 font-medium">Product type</th>
                  <th className="px-4 py-2 font-medium text-right">Cost price</th>
                  <th className="px-4 py-2 font-medium text-right">Buffer</th>
                  <th className="px-4 py-2 font-medium text-right">In stock</th>
                  <th className="px-4 py-2 font-medium text-right">Available</th>
                  <th className="px-4 py-2 font-medium text-right">Days to buffer</th>
                  <th className="px-4 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredSkus.map((s) => {
                  const stock = s.is_bundle ? bundleAvailable(s.id) : stockBySku[s.id] ?? 0
                  const available = s.is_bundle ? stock : Math.max(stock - s.buffer_stock, 0)
                  const low = stock <= s.buffer_stock
                  const isEditing = editingId === s.id
                  return (
                    <Fragment key={s.id}>
                    <tr>
                      <td className="px-4 py-2.5">
                        <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => toggleSelected(s.id)} />
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-700">{s.sku}</td>
                      {isEditing ? (
                        <>
                          <td className="px-4 py-2.5">
                            <input
                              type="text"
                              value={editForm.title}
                              onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                              className="w-full text-sm rounded-lg border border-slate-300 px-2 py-1"
                            />
                          </td>
                          <td className="px-4 py-2.5">
                            <input
                              type="text"
                              value={editForm.product_type}
                              onChange={(e) => setEditForm((f) => ({ ...f, product_type: e.target.value }))}
                              placeholder="e.g. LUGGAGE"
                              className="w-28 text-sm rounded-lg border border-slate-300 px-2 py-1 mb-1"
                            />
                            <label className="flex items-center gap-1 text-xs text-slate-500">
                              <input type="checkbox" checked={editForm.is_bundle} onChange={(e) => setEditForm((f) => ({ ...f, is_bundle: e.target.checked }))} />
                              Bundle
                            </label>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <input
                              type="number"
                              value={editForm.cost_price}
                              onChange={(e) => setEditForm((f) => ({ ...f, cost_price: e.target.value }))}
                              className="w-20 text-sm text-right rounded-lg border border-slate-300 px-2 py-1"
                            />
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <input
                              type="number"
                              value={editForm.buffer_stock}
                              onChange={(e) => setEditForm((f) => ({ ...f, buffer_stock: e.target.value }))}
                              className="w-16 text-sm text-right rounded-lg border border-slate-300 px-2 py-1"
                            />
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-400">{stock}</td>
                          <td className="px-4 py-2.5 text-right text-slate-400">{available}</td>
                          <td className="px-4 py-2.5 text-right text-slate-400">—</td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            <button onClick={() => saveEdit(s)} disabled={savingEdit} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 mr-2 disabled:opacity-50">
                              {savingEdit ? '…' : 'Save'}
                            </button>
                            <button onClick={() => setEditingId(null)} className="text-xs text-slate-400 hover:text-slate-600">
                              Cancel
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-2.5 text-slate-500">
                            {s.title}
                            {(s.brand || s.category) && (
                              <div className="text-[10px] text-slate-400">{[s.brand, s.category].filter(Boolean).join(' · ')}</div>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-slate-500">
                            {s.is_bundle ? <span className="text-[10px] uppercase tracking-wide bg-purple-50 text-purple-600 rounded px-1.5 py-0.5">🎁 Bundle</span> : s.product_type ?? '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-500">{formatINR(s.cost_price)}</td>
                          <td className="px-4 py-2.5 text-right text-slate-500">{s.is_bundle ? '—' : s.buffer_stock}</td>
                          <td className={`px-4 py-2.5 text-right font-medium ${low ? 'text-red-600' : 'text-slate-700'}`}>{stock}</td>
                          <td className="px-4 py-2.5 text-right text-slate-500">{available}</td>
                          <td className={`px-4 py-2.5 text-right ${(daysToBuffer(s) ?? Infinity) <= REORDER_ALERT_DAYS ? 'text-amber-600 font-medium' : 'text-slate-500'}`}>
                            {s.is_bundle
                              ? '—'
                              : (() => {
                                  const days = daysToBuffer(s)
                                  return days != null ? `~${Math.round(days)}d` : '—'
                                })()}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            {s.is_bundle && (
                              <button onClick={() => setExpandedBundleId(expandedBundleId === s.id ? null : s.id)} className="text-xs font-medium text-purple-600 hover:text-purple-700 mr-3">
                                Components
                              </button>
                            )}
                            {canEdit && (
                              <button onClick={() => startEdit(s)} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 mr-3">
                                Edit
                              </button>
                            )}
                            {canDelete && (
                              <button onClick={() => setDeleteTarget(s)} className="text-xs text-slate-400 hover:text-red-600">
                                Delete
                              </button>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                    {isEditing && (
                      <tr>
                        <td colSpan={10} className="px-4 py-3 bg-slate-50">
                          <div className="text-xs font-semibold uppercase text-slate-500 mb-2">Inventory planning</div>
                          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                            <label className="block">
                              <span className="text-xs text-slate-500">Reorder level</span>
                              <input type="number" value={editForm.reorder_level} onChange={(e) => setEditForm((f) => ({ ...f, reorder_level: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1" />
                            </label>
                            <label className="block">
                              <span className="text-xs text-slate-500">Min stock</span>
                              <input type="number" value={editForm.min_stock} onChange={(e) => setEditForm((f) => ({ ...f, min_stock: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1" />
                            </label>
                            <label className="block">
                              <span className="text-xs text-slate-500">Max stock</span>
                              <input type="number" value={editForm.max_stock} onChange={(e) => setEditForm((f) => ({ ...f, max_stock: e.target.value }))} placeholder="No cap" className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1" />
                            </label>
                            <label className="block">
                              <span className="text-xs text-slate-500">Safety stock</span>
                              <input type="number" value={editForm.safety_stock} onChange={(e) => setEditForm((f) => ({ ...f, safety_stock: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1" />
                            </label>
                            <label className="block">
                              <span className="text-xs text-slate-500">Reorder qty</span>
                              <input type="number" value={editForm.reorder_qty} onChange={(e) => setEditForm((f) => ({ ...f, reorder_qty: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1" />
                            </label>
                            <label className="block">
                              <span className="text-xs text-slate-500">Lead time (days)</span>
                              <input type="number" value={editForm.lead_time_days} onChange={(e) => setEditForm((f) => ({ ...f, lead_time_days: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1" />
                            </label>
                            <label className="block">
                              <span className="text-xs text-slate-500">Barcode</span>
                              <input type="text" value={editForm.barcode} onChange={(e) => setEditForm((f) => ({ ...f, barcode: e.target.value }))} placeholder="Scan or type" className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1" />
                            </label>
                          </div>

                          <div className="text-xs font-semibold uppercase text-slate-500 mb-2 mt-4">Catalog details</div>
                          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 mb-2">
                            <label className="block">
                              <span className="text-xs text-slate-500">Brand</span>
                              <input type="text" value={editForm.brand} onChange={(e) => setEditForm((f) => ({ ...f, brand: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1" />
                            </label>
                            <label className="block">
                              <span className="text-xs text-slate-500">Category</span>
                              <input type="text" value={editForm.category} onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1" />
                            </label>
                            <label className="block">
                              <span className="text-xs text-slate-500">Subcategory</span>
                              <input type="text" value={editForm.subcategory} onChange={(e) => setEditForm((f) => ({ ...f, subcategory: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1" />
                            </label>
                            <label className="block">
                              <span className="text-xs text-slate-500">Weight (kg)</span>
                              <input type="number" value={editForm.weight_kg} onChange={(e) => setEditForm((f) => ({ ...f, weight_kg: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1" />
                            </label>
                            <label className="block">
                              <span className="text-xs text-slate-500">Dimensions L×W×H (cm)</span>
                              <div className="flex gap-1 mt-1">
                                <input type="number" value={editForm.length_cm} onChange={(e) => setEditForm((f) => ({ ...f, length_cm: e.target.value }))} placeholder="L" className="w-full text-sm rounded-lg border border-slate-300 px-2 py-1" />
                                <input type="number" value={editForm.width_cm} onChange={(e) => setEditForm((f) => ({ ...f, width_cm: e.target.value }))} placeholder="W" className="w-full text-sm rounded-lg border border-slate-300 px-2 py-1" />
                                <input type="number" value={editForm.height_cm} onChange={(e) => setEditForm((f) => ({ ...f, height_cm: e.target.value }))} placeholder="H" className="w-full text-sm rounded-lg border border-slate-300 px-2 py-1" />
                              </div>
                            </label>
                            <label className="block">
                              <span className="text-xs text-slate-500">Image URL</span>
                              <input type="text" value={editForm.image_url} onChange={(e) => setEditForm((f) => ({ ...f, image_url: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1" />
                            </label>
                          </div>
                          <label className="block mb-2">
                            <span className="text-xs text-slate-500">Description</span>
                            <textarea value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} rows={2} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1" />
                          </label>

                          <div className="text-xs font-semibold uppercase text-slate-500 mb-2 mt-4">Batch / serial tracking</div>
                          <label className="block max-w-xs">
                            <span className="text-xs text-slate-500">Tracking mode</span>
                            <select
                              value={editForm.tracking_mode}
                              onChange={(e) => setEditForm((f) => ({ ...f, tracking_mode: e.target.value as Enums<'sku_tracking_mode'> }))}
                              className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1"
                            >
                              <option value="none">None</option>
                              <option value="batch">Batch (batch number, mfg/expiry date)</option>
                              <option value="serial">Serial (one unique number per unit)</option>
                            </select>
                          </label>
                          {editForm.tracking_mode !== 'none' && (
                            <p className="text-[10px] text-slate-400 mt-1">
                              Save this first, then capture {editForm.tracking_mode === 'batch' ? 'batch/expiry' : 'serial numbers'} the
                              next time this SKU is received on a GRN.
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                    {s.is_bundle && expandedBundleId === s.id && (
                      <tr>
                        <td colSpan={10} className="px-4 py-3 bg-slate-50">
                          <div className="text-xs font-semibold uppercase text-slate-500 mb-2">Components</div>
                          {bundleComponents.filter((c) => c.bundle_sku_id === s.id).length === 0 ? (
                            <p className="text-xs text-slate-400 mb-2">No components yet — this bundle can't be sold until you add some.</p>
                          ) : (
                            <div className="space-y-1 mb-2">
                              {bundleComponents
                                .filter((c) => c.bundle_sku_id === s.id)
                                .map((c) => {
                                  const compSku = skus.find((sk) => sk.id === c.component_sku_id)
                                  return (
                                    <div key={c.id} className="flex items-center gap-2 text-sm">
                                      <span className="text-slate-700">
                                        {c.quantity} × {compSku?.sku ?? '—'} ({compSku?.title ?? 'unknown'})
                                      </span>
                                      {canEdit && (
                                        <button onClick={() => removeComponent(c.id)} className="text-xs text-slate-400 hover:text-red-600">
                                          Remove
                                        </button>
                                      )}
                                    </div>
                                  )
                                })}
                            </div>
                          )}
                          {canEdit && (
                            <div className="flex items-center gap-2">
                              <select
                                value={newComponent.component_sku_id}
                                onChange={(e) => setNewComponent((f) => ({ ...f, component_sku_id: e.target.value }))}
                                className="text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                              >
                                <option value="">Select component SKU…</option>
                                {skus.filter((sk) => sk.id !== s.id && !sk.is_bundle).map((sk) => (
                                  <option key={sk.id} value={sk.id}>
                                    {sk.sku} — {sk.title}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="number"
                                min="1"
                                value={newComponent.quantity}
                                onChange={(e) => setNewComponent((f) => ({ ...f, quantity: e.target.value }))}
                                className="w-16 text-sm rounded-lg border border-slate-300 px-2 py-1.5"
                              />
                              <button
                                onClick={() => addComponent(s.id)}
                                disabled={savingComponent}
                                className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
                              >
                                {savingComponent ? 'Adding…' : '+ Add'}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="Delete SKU?"
          message={`Delete ${deleteTarget.sku} (${deleteTarget.title})? Fails if it's used on any order — this doesn't touch order history.`}
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
