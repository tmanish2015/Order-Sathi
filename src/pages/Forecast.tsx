import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables } from '../lib/database.types'

type Sku = Tables<'skus'>
type Warehouse = Tables<'warehouses'>
type LedgerRow = { sku_id: string; warehouse_id: string; quantity_delta: number; created_at: string; movement_type: string }

const SELL_THROUGH_WINDOW_DAYS = 14

export default function Forecast() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [skus, setSkus] = useState<Sku[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)

  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const [{ data: s }, { data: w }, { data: l }] = await Promise.all([
      supabase.from('skus').select('*').eq('active', true).eq('is_bundle', false).order('sku'),
      supabase.from('warehouses').select('*').order('name'),
      supabase.from('inventory_ledger').select('sku_id, warehouse_id, quantity_delta, created_at, movement_type'),
    ])
    setSkus(s ?? [])
    setWarehouses(w ?? [])
    setLedger(l ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  // Moving-average heuristic, not a predictive model: sell-through rate is
  // units sold per day over the last 14 days, projected forward at that
  // same rate. Deliberately simple and explainable, not "AI".
  const forecast = useMemo(() => {
    const cutoff = Date.now() - SELL_THROUGH_WINDOW_DAYS * 24 * 60 * 60 * 1000
    const stockBySku: Record<string, number> = {}
    const soldRecentBySku: Record<string, number> = {}
    for (const row of ledger) {
      stockBySku[row.sku_id] = (stockBySku[row.sku_id] ?? 0) + row.quantity_delta
      if (row.movement_type === 'order_deduction' && new Date(row.created_at).getTime() >= cutoff) {
        soldRecentBySku[row.sku_id] = (soldRecentBySku[row.sku_id] ?? 0) + -row.quantity_delta
      }
    }

    return skus
      .map((s) => {
        const stock = stockBySku[s.id] ?? 0
        const rate = (soldRecentBySku[s.id] ?? 0) / SELL_THROUGH_WINDOW_DAYS
        const daysToStockout = rate > 0 ? stock / rate : null
        // Reorder now if what's left won't outlast the time it takes new
        // stock to arrive.
        const needsReorder = daysToStockout != null && daysToStockout <= s.lead_time_days
        const targetStock = s.max_stock ?? Math.ceil(rate * s.lead_time_days * 2) + s.safety_stock
        const suggestedQty = Math.max(s.reorder_qty, Math.ceil(targetStock - stock), 0)
        return { sku: s, stock, rate, daysToStockout, needsReorder, suggestedQty }
      })
      .filter((f) => f.needsReorder && f.suggestedQty > 0)
      .sort((a, b) => (a.daysToStockout ?? 0) - (b.daysToStockout ?? 0))
  }, [skus, ledger])

  function toggleSelected(id: string) {
    setSelectedIds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Creates a draft GRN with the suggested quantities as ordered_qty (0
  // received/accepted) - a purchase suggestion for a human to act on, not
  // an automatic stock change. Reuses the exact same GRN engine/table the
  // GRN page writes to; no second inventory pathway.
  async function createDraftGrn() {
    if (!orgId) return
    const targets = forecast.filter((f) => selectedIds.has(f.sku.id))
    if (targets.length === 0) return
    const warehouse = warehouses.find((w) => w.is_default) ?? warehouses[0]
    if (!warehouse) {
      showError('No warehouse set up yet.')
      return
    }
    setCreating(true)
    try {
      const { data: grnNumber, error: numError } = await supabase.rpc('next_grn_number')
      if (numError || !grnNumber) throw numError ?? new Error('Could not allocate GRN number')

      const { data: grn, error: grnError } = await supabase
        .from('grns')
        .insert({
          organization_id: orgId,
          grn_number: grnNumber,
          warehouse_id: warehouse.id,
          reference_po: 'Auto-suggested reorder (Forecast)',
          created_by: profile!.id,
        })
        .select()
        .single()
      if (grnError || !grn) throw grnError ?? new Error('Could not create GRN')

      const { error: linesError } = await supabase.from('grn_line_items').insert(
        targets.map((f) => ({
          organization_id: orgId,
          grn_id: grn.id,
          sku_id: f.sku.id,
          ordered_qty: f.suggestedQty,
        }))
      )
      if (linesError) throw linesError

      showSuccess(`Draft GRN ${grnNumber} created with ${targets.length} suggested line(s) — receive it from the GRN page when stock arrives.`)
      setSelectedIds(new Set())
    } catch (err) {
      reportError(showError, 'Create draft GRN from forecast', err as { message: string }, orgId, profile?.id)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">Demand Forecast &amp; Reorder Suggestions</h2>
      <p className="text-xs text-slate-400 mb-6">
        A moving-average heuristic — 14-day sell-through rate projected forward against lead time and current stock. Not a machine-learning
        model. Suggestions never move stock by themselves; "Create draft GRN" only pre-fills a purchase suggestion you still confirm on
        the GRN page once goods actually arrive.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {canEdit && selectedIds.size > 0 && (
          <div className="px-4 py-2.5 border-b border-slate-100 bg-indigo-50 flex items-center gap-3 flex-wrap">
            <span className="text-xs font-medium text-indigo-700">{selectedIds.size} selected</span>
            <button onClick={createDraftGrn} disabled={creating} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50">
              {creating ? 'Creating…' : '📦 Create draft GRN'}
            </button>
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-400 hover:text-slate-600">
              Clear
            </button>
          </div>
        )}
        {loading ? (
          <Skeleton rows={3} />
        ) : forecast.length === 0 ? (
          <EmptyState icon="📈" title="No SKUs need reordering right now." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  {canEdit && (
                    <th className="px-4 py-2 font-medium w-8">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === forecast.length && forecast.length > 0}
                        onChange={() => setSelectedIds((s) => (s.size === forecast.length ? new Set() : new Set(forecast.map((f) => f.sku.id))))}
                      />
                    </th>
                  )}
                  <th className="px-4 py-2 font-medium">SKU</th>
                  <th className="px-4 py-2 font-medium text-right">Current stock</th>
                  <th className="px-4 py-2 font-medium text-right">Daily rate (14d)</th>
                  <th className="px-4 py-2 font-medium text-right">Days to stockout</th>
                  <th className="px-4 py-2 font-medium text-right">Lead time</th>
                  <th className="px-4 py-2 font-medium text-right">Suggested reorder qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {forecast.map((f) => (
                  <tr key={f.sku.id}>
                    {canEdit && (
                      <td className="px-4 py-2.5">
                        <input type="checkbox" checked={selectedIds.has(f.sku.id)} onChange={() => toggleSelected(f.sku.id)} />
                      </td>
                    )}
                    <td className="px-4 py-2.5 font-medium text-slate-700">
                      {f.sku.sku} <span className="text-slate-400 font-normal">— {f.sku.title}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{f.stock}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{f.rate.toFixed(1)}/day</td>
                    <td className="px-4 py-2.5 text-right text-amber-600 font-medium">{f.daysToStockout != null ? `~${Math.round(f.daysToStockout)}d` : '—'}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{f.sku.lead_time_days}d</td>
                    <td className="px-4 py-2.5 text-right text-slate-700 font-medium">{f.suggestedQty}</td>
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
