import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import type { Tables } from '../lib/database.types'

type Sku = Tables<'skus'>
type Ledger = Tables<'inventory_ledger'>
type Channel = Tables<'channels'>

export default function Inventory() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [skus, setSkus] = useState<Sku[]>([])
  const [stockBySku, setStockBySku] = useState<Record<string, number>>({})
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannel, setSelectedChannel] = useState('')
  const [pushing, setPushing] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [showAddSku, setShowAddSku] = useState(false)
  const [newSku, setNewSku] = useState({ sku: '', title: '', gst_rate: '18', buffer_stock: '0' })
  const [savingSku, setSavingSku] = useState(false)
  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops'

  async function load() {
    if (!orgId) return
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
    setChannels(c ?? [])
    if (c && c.length === 1) setSelectedChannel(c[0].id)
  }

  useEffect(() => {
    load()
  }, [orgId])

  function startEdit(s: Sku) {
    setEditingId(s.id)
    setEditValue(s.product_type ?? '')
  }

  async function saveProductType(s: Sku) {
    const { error } = await supabase.from('skus').update({ product_type: editValue || null }).eq('id', s.id)
    if (error) {
      reportError(showError, 'Save product type', error, orgId, profile?.id)
      return
    }
    setEditingId(null)
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
    })
    setSavingSku(false)
    if (error) {
      reportError(showError, 'Add SKU', error, orgId, profile?.id)
      return
    }
    showSuccess(`SKU ${newSku.sku} added.`)
    setNewSku({ sku: '', title: '', gst_rate: '18', buffer_stock: '0' })
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
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
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
          <div className="sm:col-span-4">
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
        Amazon needs each SKU's product type before quantity can push — set it below.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {skus.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">No SKUs yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="px-4 py-2 font-medium">SKU</th>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">Product type</th>
                <th className="px-4 py-2 font-medium text-right">Buffer</th>
                <th className="px-4 py-2 font-medium text-right">In stock</th>
                <th className="px-4 py-2 font-medium text-right">Available to sell</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {skus.map((s) => {
                const stock = stockBySku[s.id] ?? 0
                const available = Math.max(stock - s.buffer_stock, 0)
                const low = stock <= s.buffer_stock
                return (
                  <tr key={s.id}>
                    <td className="px-4 py-2.5 font-medium text-slate-700">{s.sku}</td>
                    <td className="px-4 py-2.5 text-slate-500">{s.title}</td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {editingId === s.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            placeholder="e.g. LUGGAGE"
                            className="w-32 text-sm rounded-lg border border-slate-300 px-2 py-1"
                          />
                          <button onClick={() => saveProductType(s)} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                            Save
                          </button>
                          <button onClick={() => setEditingId(null)} className="text-xs text-slate-400 hover:text-slate-600">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => canEdit && startEdit(s)} disabled={!canEdit} className={canEdit ? 'hover:underline' : ''}>
                          {s.product_type ?? (canEdit ? 'Set…' : '—')}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{s.buffer_stock}</td>
                    <td className={`px-4 py-2.5 text-right font-medium ${low ? 'text-red-600' : 'text-slate-700'}`}>{stock}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{available}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
