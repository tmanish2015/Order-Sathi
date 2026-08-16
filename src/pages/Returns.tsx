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
  received: 'bg-blue-100 text-blue-700',
  refunded: 'bg-emerald-100 text-emerald-700',
}

const TYPE_LABEL: Record<Enums<'return_type'>, string> = {
  customer_return: 'Customer return',
  rto: 'RTO',
}

export default function Returns() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [returns, setReturns] = useState<ReturnRow[]>([])
  const [loading, setLoading] = useState(true)

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

  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops' || profile?.role === 'finance'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const { data } = await supabase.from('order_returns').select('*, orders(*), skus(*)').order('created_at', { ascending: false })
    setReturns((data as unknown as ReturnRow[]) ?? [])
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

  async function markReceived(r: ReturnRow) {
    if (r.restocked) return
    setRestockingId(r.id)
    const { error: ledgerError } = await supabase.from('inventory_ledger').insert({
      organization_id: orgId!,
      sku_id: r.sku_id,
      movement_type: 'return',
      quantity_delta: r.quantity,
      order_id: r.order_id,
      note: `${TYPE_LABEL[r.return_type]} — order ${r.orders?.amazon_order_id ?? r.order_id}`,
    })
    if (ledgerError) {
      setRestockingId(null)
      reportError(showError, 'Restock return', ledgerError, orgId, profile?.id)
      return
    }
    const { error } = await supabase.from('order_returns').update({ status: 'received', restocked: true, updated_at: new Date().toISOString() }).eq('id', r.id)
    setRestockingId(null)
    if (error) {
      reportError(showError, 'Update return status', error, orgId, profile?.id)
      return
    }
    showSuccess(`${r.quantity} unit(s) restocked.`)
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
        Track customer returns and RTO per SKU — restock only happens when you explicitly mark goods received, and refund mismatches are
        flagged, never silently accepted.
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
                  <th className="px-4 py-2 font-medium">Order</th>
                  <th className="px-4 py-2 font-medium">SKU</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium text-right">Qty</th>
                  <th className="px-4 py-2 font-medium text-right">Expected refund</th>
                  <th className="px-4 py-2 font-medium text-right">Actual refund</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {returns.map((r) => {
                  const mismatch = r.actual_refund != null && Math.abs(Number(r.actual_refund) - Number(r.expected_refund)) > MISMATCH_THRESHOLD
                  return (
                    <tr key={r.id}>
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
                        <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${STATUS_COLOR[r.status]}`}>{r.status}</span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{format(new Date(r.created_at), 'dd MMM yyyy')}</td>
                      <td className="px-4 py-2.5 text-right">
                        {!r.restocked && canEdit && (
                          <button
                            onClick={() => markReceived(r)}
                            disabled={restockingId === r.id}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
                          >
                            {restockingId === r.id ? 'Restocking…' : 'Mark received & restock'}
                          </button>
                        )}
                        {r.restocked && <span className="text-xs text-emerald-600">Restocked</span>}
                      </td>
                    </tr>
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
