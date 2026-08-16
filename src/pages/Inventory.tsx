import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import { formatINR } from '../lib/format'
import ConfirmDialog from '../components/ConfirmDialog'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables } from '../lib/database.types'

type Sku = Tables<'skus'>
type Ledger = Tables<'inventory_ledger'>
type Channel = Tables<'channels'>

const SELL_THROUGH_WINDOW_DAYS = 14
const REORDER_ALERT_DAYS = 7

interface SkuFormValues {
  title: string
  gst_rate: string
  buffer_stock: string
  product_type: string
  cost_price: string
}

function toFormValues(s: Sku): SkuFormValues {
  return {
    title: s.title,
    gst_rate: String(s.gst_rate),
    buffer_stock: String(s.buffer_stock),
    product_type: s.product_type ?? '',
    cost_price: String(s.cost_price),
  }
}

export default function Inventory() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [skus, setSkus] = useState<Sku[]>([])
  const [stockBySku, setStockBySku] = useState<Record<string, number>>({})
  const [dailyRateBySku, setDailyRateBySku] = useState<Record<string, number>>({})
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannel, setSelectedChannel] = useState('')
  const [pushing, setPushing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<SkuFormValues>({ title: '', gst_rate: '', buffer_stock: '', product_type: '', cost_price: '' })
  const [savingEdit, setSavingEdit] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Sku | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showAddSku, setShowAddSku] = useState(false)
  const [newSku, setNewSku] = useState({ sku: '', title: '', gst_rate: '18', buffer_stock: '0', cost_price: '0' })
  const [savingSku, setSavingSku] = useState(false)
  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops'
  const canDelete = canEdit

  async function load() {
    if (!orgId) return
    setLoading(true)
    const [{ data: s }, { data: l }, { data: c }] = await Promise.all([
      supabase.from('skus').select('*').order('sku'),
      supabase.from('inventory_ledger').select('*'),
      supabase.from('channels').select('*'),
    ])
    setSkus(s ?? [])
    const totals: Record<string, number> = {}
    for (const row of (l ?? []) as Ledger[]) {
      totals[row.sku_id] = (totals[row.sku_id] ?? 0) + row.quantity_delta
    }
    setStockBySku(totals)

    // Recent sell-through: units sold per day over the last 14 days, from
    // order_deduction movements only (restocks/returns/adjustments don't
    // represent demand).
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
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [orgId])

  const filteredSkus = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return skus
    return skus.filter((s) => s.sku.toLowerCase().includes(q) || s.title.toLowerCase().includes(q))
  }, [skus, search])

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
    })
    setSavingSku(false)
    if (error) {
      reportError(showError, 'Add SKU', error, orgId, profile?.id)
      return
    }
    showSuccess(`SKU ${newSku.sku} added.`)
    setNewSku({ sku: '', title: '', gst_rate: '18', buffer_stock: '0', cost_price: '0' })
    setShowAddSku(false)
    load()
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
          <button
            onClick={() => setShowAddSku((v) => !v)}
            className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
          >
            {showAddSku ? 'Cancel' : '+ Add SKU'}
          </button>
        )}
      </div>

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
        <div className="px-4 py-3 border-b border-slate-100">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SKU or title…"
            className="text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 w-56"
          />
        </div>
        {loading ? (
          <Skeleton />
        ) : filteredSkus.length === 0 ? (
          <EmptyState icon="📋" title={search ? 'No SKUs match this search.' : 'No SKUs yet.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
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
                  const stock = stockBySku[s.id] ?? 0
                  const available = Math.max(stock - s.buffer_stock, 0)
                  const low = stock <= s.buffer_stock
                  const isEditing = editingId === s.id
                  return (
                    <tr key={s.id}>
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
                              className="w-28 text-sm rounded-lg border border-slate-300 px-2 py-1"
                            />
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
                          <td className="px-4 py-2.5 text-slate-500">{s.title}</td>
                          <td className="px-4 py-2.5 text-slate-500">{s.product_type ?? '—'}</td>
                          <td className="px-4 py-2.5 text-right text-slate-500">{formatINR(s.cost_price)}</td>
                          <td className="px-4 py-2.5 text-right text-slate-500">{s.buffer_stock}</td>
                          <td className={`px-4 py-2.5 text-right font-medium ${low ? 'text-red-600' : 'text-slate-700'}`}>{stock}</td>
                          <td className="px-4 py-2.5 text-right text-slate-500">{available}</td>
                          <td className={`px-4 py-2.5 text-right ${(daysToBuffer(s) ?? Infinity) <= REORDER_ALERT_DAYS ? 'text-amber-600 font-medium' : 'text-slate-500'}`}>
                            {(() => {
                              const days = daysToBuffer(s)
                              return days != null ? `~${Math.round(days)}d` : '—'
                            })()}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
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
