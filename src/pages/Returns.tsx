import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import { formatINR } from '../lib/format'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables, Enums } from '../lib/database.types'

type Order = Tables<'orders'>
type LineItem = Tables<'order_line_items'> & { skus: Tables<'skus'> | null }
type ReturnRow = Tables<'order_returns'> & { orders: Tables<'orders'> | null; skus: Tables<'skus'> | null }

const MISMATCH_THRESHOLD = 2

const STATUS_COLOR: Record<ReturnRow['status'], string> = {
  initiated: 'bg-amber-100 text-amber-700',
  in_transit: 'bg-indigo-100 text-indigo-700',
  received: 'bg-blue-100 text-blue-700',
  qc_pending: 'bg-amber-100 text-amber-700',
  qc_complete: 'bg-slate-100 text-slate-600',
  refunded: 'bg-emerald-100 text-emerald-700',
}

const TYPE_LABEL: Record<Enums<'return_type'>, string> = {
  customer_return: 'Customer return',
  rto: 'RTO',
}

const QC_OUTCOME_LABEL: Record<Enums<'return_qc_outcome'>, string> = {
  resalable: 'Resalable — restock full qty',
  partial: 'Partial — restock some',
  damaged: 'Damaged — no sellable stock',
  missing_item: 'Missing item — exception',
  wrong_item: 'Wrong item — exception',
  rejected: 'Rejected — exception',
}

export default function Returns() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [returns, setReturns] = useState<ReturnRow[]>([])
  const [loading, setLoading] = useState(true)
  const [defaultWarehouseId, setDefaultWarehouseId] = useState<string | null>(null)

  const [orderIdInput, setOrderIdInput] = useState('')
  const [finding, setFinding] = useState(false)
  const [foundOrder, setFoundOrder] = useState<Order | null>(null)
  const [foundLineItems, setFoundLineItems] = useState<LineItem[]>([])
  const [returnForm, setReturnForm] = useState({ order_line_item_id: '', quantity: '1', return_type: 'customer_return' as Enums<'return_type'>, reason: '', expected_refund: '' })
  const [savingReturn, setSavingReturn] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [restockingId, setRestockingId] = useState<string | null>(null)

  const [qcId, setQcId] = useState<string | null>(null)
  const [qcOutcome, setQcOutcome] = useState<Enums<'return_qc_outcome'>>('resalable')
  const [qcQty, setQcQty] = useState('')
  const [qcNotes, setQcNotes] = useState('')
  const [qcSavingId, setQcSavingId] = useState<string | null>(null)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops' || profile?.role === 'finance'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const [{ data }, { data: w }] = await Promise.all([
      supabase.from('order_returns').select('*, orders(*), skus(*)').order('created_at', { ascending: false }),
      supabase.from('warehouses').select('id').eq('is_default', true).limit(1).maybeSingle(),
    ])
    setReturns((data as unknown as ReturnRow[]) ?? [])
    setDefaultWarehouseId(w?.id ?? null)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [orgId])

  async function findOrder() {
    if (!orderIdInput.trim()) return
    setFinding(true)
    setFoundOrder(null)
    setFoundLineItems([])
    const { data: order } = await supabase.from('orders').select('*').eq('amazon_order_id', orderIdInput.trim()).maybeSingle()
    if (!order) {
      showError(`No order found with ID ${orderIdInput.trim()}.`)
      setFinding(false)
      return
    }
    const { data: items } = await supabase.from('order_line_items').select('*, skus(*)').eq('order_id', order.id)
    setFoundOrder(order)
    setFoundLineItems((items as unknown as LineItem[]) ?? [])
    setReturnForm((f) => ({ ...f, order_line_item_id: '' }))
    setFinding(false)
  }

  function selectLineItem(id: string) {
    const li = foundLineItems.find((l) => l.id === id)
    setReturnForm((f) => ({
      ...f,
      order_line_item_id: id,
      quantity: '1',
      expected_refund: li ? String(Number(li.unit_price)) : '',
    }))
  }

  async function submitReturn() {
    if (!orgId || !foundOrder || !returnForm.order_line_item_id) {
      showError('Find an order and pick a line item first.')
      return
    }
    const li = foundLineItems.find((l) => l.id === returnForm.order_line_item_id)
    const qty = Number(returnForm.quantity)
    if (!li || qty <= 0 || qty > li.quantity) {
      showError(`Quantity must be between 1 and ${li?.quantity ?? 0} (the amount ordered).`)
      return
    }

    setSavingReturn(true)
    const { error } = await supabase.from('order_returns').insert({
      organization_id: orgId,
      order_id: foundOrder.id,
      order_line_item_id: li.id,
      sku_id: li.sku_id,
      return_type: returnForm.return_type,
      quantity: qty,
      reason: returnForm.reason || null,
      expected_refund: Number(returnForm.expected_refund) || 0,
    })
    setSavingReturn(false)
    if (error) {
      reportError(showError, 'Record return', error, orgId, profile?.id)
      return
    }
    showSuccess('Return recorded.')
    setOrderIdInput('')
    setFoundOrder(null)
    setFoundLineItems([])
    setReturnForm({ order_line_item_id: '', quantity: '1', return_type: 'customer_return', reason: '', expected_refund: '' })
    load()
  }

  // Receiving goods does NOT restock anything by itself - stock only moves
  // once QC assigns an outcome, so damaged/wrong/missing goods never
  // silently become sellable inventory.
  async function markReceived(r: ReturnRow) {
    setRestockingId(r.id)
    const { error } = await supabase.from('order_returns').update({ status: 'received', updated_at: new Date().toISOString() }).eq('id', r.id)
    setRestockingId(null)
    if (error) {
      reportError(showError, 'Mark received', error, orgId, profile?.id)
      return
    }
    showSuccess('Marked received — run QC to release stock.')
    load()
  }

  const receivableIds = returns.filter((r) => r.status === 'initiated').map((r) => r.id)

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.size === receivableIds.length ? new Set() : new Set(receivableIds)))
  }

  async function bulkMarkReceived() {
    const ids = Array.from(selectedIds).filter((id) => receivableIds.includes(id))
    if (ids.length === 0) return
    setBulkBusy(true)
    const { error } = await supabase.from('order_returns').update({ status: 'received', updated_at: new Date().toISOString() }).in('id', ids)
    setBulkBusy(false)
    if (error) {
      reportError(showError, 'Bulk mark received', error, orgId, profile?.id)
      return
    }
    showSuccess(`${ids.length} return(s) marked received — run QC to release stock.`)
    setSelectedIds(new Set())
    load()
  }

  function openQc(r: ReturnRow) {
    setQcId(r.id)
    setQcOutcome('resalable')
    setQcQty(String(r.quantity))
    setQcNotes('')
  }

  async function completeQc(r: ReturnRow) {
    if (!orgId) return
    const qty = Number(qcQty)
    if (qcOutcome === 'partial' && (!Number.isFinite(qty) || qty <= 0 || qty > r.quantity)) {
      showError(`Resalable quantity must be between 1 and ${r.quantity}.`)
      return
    }
    setQcSavingId(r.id)

    let restocked = false
    if (qcOutcome === 'resalable' || qcOutcome === 'partial') {
      if (!defaultWarehouseId) {
        setQcSavingId(null)
        showError('No default warehouse set — add one under Warehouses first.')
        return
      }
      const restockQty = qcOutcome === 'resalable' ? r.quantity : qty
      const { error: ledgerError } = await supabase.from('inventory_ledger').insert({
        organization_id: orgId,
        sku_id: r.sku_id,
        warehouse_id: defaultWarehouseId,
        movement_type: 'return',
        quantity_delta: restockQty,
        order_id: r.order_id,
        note: `QC ${qcOutcome} — ${TYPE_LABEL[r.return_type]} order ${r.orders?.amazon_order_id ?? r.order_id}`,
      })
      if (ledgerError) {
        setQcSavingId(null)
        reportError(showError, 'Restock from QC', ledgerError, orgId, profile?.id)
        return
      }
      restocked = true
    } else if (qcOutcome === 'damaged') {
      if (!defaultWarehouseId) {
        setQcSavingId(null)
        showError('No default warehouse set — add one under Warehouses first.')
        return
      }
      // Logged for audit even though it never increases sellable stock.
      const { error: ledgerError } = await supabase.from('inventory_ledger').insert({
        organization_id: orgId,
        sku_id: r.sku_id,
        warehouse_id: defaultWarehouseId,
        movement_type: 'damaged',
        quantity_delta: 0,
        order_id: r.order_id,
        note: `QC damaged (${r.quantity} unit(s)) — ${TYPE_LABEL[r.return_type]} order ${r.orders?.amazon_order_id ?? r.order_id}`,
      })
      if (ledgerError) {
        setQcSavingId(null)
        reportError(showError, 'Log damaged stock', ledgerError, orgId, profile?.id)
        return
      }
    }
    // missing_item / wrong_item / rejected: exception only, no ledger movement.

    const { error } = await supabase
      .from('order_returns')
      .update({
        status: 'qc_complete',
        qc_outcome: qcOutcome,
        qc_notes: qcNotes || null,
        qc_by: profile!.id,
        qc_at: new Date().toISOString(),
        restocked,
        updated_at: new Date().toISOString(),
      })
      .eq('id', r.id)
    setQcSavingId(null)
    if (error) {
      reportError(showError, 'Save QC outcome', error, orgId, profile?.id)
      return
    }
    showSuccess(`QC complete — ${QC_OUTCOME_LABEL[qcOutcome]}.`)
    setQcId(null)
    load()
  }

  function startEdit(r: ReturnRow) {
    setEditingId(r.id)
    setEditValue(r.actual_refund != null ? String(r.actual_refund) : '')
  }

  async function saveActualRefund(r: ReturnRow) {
    const actual = Number(editValue)
    if (!Number.isFinite(actual)) {
      showError('Enter a valid number.')
      return
    }
    setSavingId(r.id)
    const { error } = await supabase
      .from('order_returns')
      .update({ actual_refund: actual, status: 'refunded', reviewed_by: profile!.id, updated_at: new Date().toISOString() })
      .eq('id', r.id)
    setSavingId(null)
    if (error) {
      reportError(showError, 'Save refund', error, orgId, profile?.id)
      return
    }
    setEditingId(null)
    load()
  }

  const mismatches = returns.filter((r) => r.actual_refund != null && Math.abs(Number(r.actual_refund) - Number(r.expected_refund)) > MISMATCH_THRESHOLD)

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">Returns &amp; RTO</h2>
      <p className="text-xs text-slate-400 mb-6">
        Track customer returns and RTO per SKU. Receiving goods never restocks by itself — stock only moves after QC assigns an
        outcome (resalable/partial restock, damaged goes to the audit log with no sellable increase, missing/wrong/rejected stay
        exceptions with no stock movement). Refund mismatches are flagged, never silently accepted.
      </p>

      {canEdit && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6">
          <div className="text-xs font-semibold uppercase text-slate-500 mb-3">Record a return</div>
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
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <label className="block sm:col-span-2">
                <span className="text-xs text-slate-500">Line item</span>
                <select
                  value={returnForm.order_line_item_id}
                  onChange={(e) => selectLineItem(e.target.value)}
                  className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                >
                  <option value="">Select item…</option>
                  {foundLineItems.map((li) => (
                    <option key={li.id} value={li.id}>
                      {li.skus?.sku} — {li.skus?.title} (qty {li.quantity})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Quantity returned</span>
                <input
                  type="number"
                  min="1"
                  value={returnForm.quantity}
                  onChange={(e) => setReturnForm((f) => ({ ...f, quantity: e.target.value }))}
                  className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Type</span>
                <select
                  value={returnForm.return_type}
                  onChange={(e) => setReturnForm((f) => ({ ...f, return_type: e.target.value as Enums<'return_type'> }))}
                  className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                >
                  <option value="customer_return">Customer return</option>
                  <option value="rto">RTO</option>
                </select>
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs text-slate-500">Reason (optional)</span>
                <input
                  type="text"
                  value={returnForm.reason}
                  onChange={(e) => setReturnForm((f) => ({ ...f, reason: e.target.value }))}
                  className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Expected refund</span>
                <input
                  type="number"
                  value={returnForm.expected_refund}
                  onChange={(e) => setReturnForm((f) => ({ ...f, expected_refund: e.target.value }))}
                  className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                />
              </label>
              <div className="sm:col-span-4">
                <button
                  onClick={submitReturn}
                  disabled={savingReturn || !returnForm.order_line_item_id}
                  className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50"
                >
                  {savingReturn ? 'Saving…' : 'Record return'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {mismatches.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-800">
          {mismatches.length} return{mismatches.length > 1 ? 's' : ''} with a refund mismatch — needs manual review.
        </div>
      )}

      {canEdit && selectedIds.size > 0 && (
        <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 mb-3">
          <span className="text-xs font-medium text-indigo-700">{selectedIds.size} selected</span>
          <button
            onClick={bulkMarkReceived}
            disabled={bulkBusy}
            className="text-xs font-medium rounded-lg bg-indigo-600 text-white px-2.5 py-1 hover:bg-indigo-700 disabled:opacity-50"
          >
            {bulkBusy ? 'Saving…' : 'Mark received'}
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <Skeleton />
        ) : returns.length === 0 ? (
          <EmptyState icon="↩️" title="No returns recorded yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  {canEdit && (
                    <th className="px-4 py-2 font-medium">
                      <input type="checkbox" checked={receivableIds.length > 0 && selectedIds.size === receivableIds.length} onChange={toggleSelectAll} />
                    </th>
                  )}
                  <th className="px-4 py-2 font-medium">Order</th>
                  <th className="px-4 py-2 font-medium">SKU</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium text-right">Qty</th>
                  <th className="px-4 py-2 font-medium text-right">Expected refund</th>
                  <th className="px-4 py-2 font-medium text-right">Actual refund</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">QC outcome</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {returns.map((r) => {
                  const mismatch = r.actual_refund != null && Math.abs(Number(r.actual_refund) - Number(r.expected_refund)) > MISMATCH_THRESHOLD
                  return (
                    <>
                    <tr key={r.id}>
                      {canEdit && (
                        <td className="px-4 py-2.5">
                          {r.status === 'initiated' && (
                            <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelected(r.id)} />
                          )}
                        </td>
                      )}
                      <td className="px-4 py-2.5 font-medium text-slate-700">{r.orders?.amazon_order_id ?? '—'}</td>
                      <td className="px-4 py-2.5 text-slate-500">{r.skus?.sku ?? '—'}</td>
                      <td className="px-4 py-2.5 text-slate-500">{TYPE_LABEL[r.return_type]}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500">{r.quantity}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700">{formatINR(Number(r.expected_refund))}</td>
                      <td className="px-4 py-2.5 text-right">
                        {editingId === r.id ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <input
                              type="number"
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="w-24 text-right text-sm rounded-lg border border-slate-300 px-2 py-1"
                            />
                            <button onClick={() => saveActualRefund(r)} disabled={savingId === r.id} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50">
                              {savingId === r.id ? '…' : 'Save'}
                            </button>
                            <button onClick={() => setEditingId(null)} className="text-xs text-slate-400 hover:text-slate-600">
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => canEdit && startEdit(r)} disabled={!canEdit} className={`${canEdit ? 'hover:underline' : ''} ${mismatch ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                            {r.actual_refund != null ? formatINR(Number(r.actual_refund)) : canEdit ? 'Enter…' : '—'}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${STATUS_COLOR[r.status]}`}>{r.status.replace('_', ' ')}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">{r.qc_outcome ? QC_OUTCOME_LABEL[r.qc_outcome] : '—'}</td>
                      <td className="px-4 py-2.5 text-slate-500">{format(new Date(r.created_at), 'dd MMM yyyy')}</td>
                      <td className="px-4 py-2.5 text-right">
                        {r.status === 'initiated' && canEdit && (
                          <button
                            onClick={() => markReceived(r)}
                            disabled={restockingId === r.id}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
                          >
                            {restockingId === r.id ? 'Saving…' : 'Mark received'}
                          </button>
                        )}
                        {r.status === 'received' && canEdit && (
                          <button onClick={() => openQc(r)} className="text-xs font-medium text-amber-600 hover:text-amber-700">
                            Run QC
                          </button>
                        )}
                        {r.status === 'qc_complete' && (
                          <span className={`text-xs ${r.restocked ? 'text-emerald-600' : 'text-slate-400'}`}>{r.restocked ? 'Restocked' : 'No stock movement'}</span>
                        )}
                      </td>
                    </tr>
                    {qcId === r.id && (
                      <tr>
                        <td colSpan={canEdit ? 11 : 10} className="px-4 py-3 bg-amber-50">
                          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                            <label className="block sm:col-span-2">
                              <span className="text-xs text-slate-500">QC outcome</span>
                              <select
                                value={qcOutcome}
                                onChange={(e) => setQcOutcome(e.target.value as Enums<'return_qc_outcome'>)}
                                className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                              >
                                {(Object.keys(QC_OUTCOME_LABEL) as Enums<'return_qc_outcome'>[]).map((o) => (
                                  <option key={o} value={o}>
                                    {QC_OUTCOME_LABEL[o]}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {qcOutcome === 'partial' && (
                              <label className="block">
                                <span className="text-xs text-slate-500">Resalable qty (of {r.quantity})</span>
                                <input
                                  type="number"
                                  min="1"
                                  max={r.quantity}
                                  value={qcQty}
                                  onChange={(e) => setQcQty(e.target.value)}
                                  className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                                />
                              </label>
                            )}
                            <label className="block sm:col-span-2">
                              <span className="text-xs text-slate-500">QC notes (optional)</span>
                              <input
                                type="text"
                                value={qcNotes}
                                onChange={(e) => setQcNotes(e.target.value)}
                                className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                              />
                            </label>
                            <div className="flex gap-2">
                              <button
                                onClick={() => completeQc(r)}
                                disabled={qcSavingId === r.id}
                                className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50"
                              >
                                {qcSavingId === r.id ? 'Saving…' : 'Complete QC'}
                              </button>
                              <button onClick={() => setQcId(null)} className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
                                Cancel
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
