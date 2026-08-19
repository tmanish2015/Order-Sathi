import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables, Enums } from '../lib/database.types'

type TransferRow = Tables<'stock_transfers'> & { source: Tables<'warehouses'> | null; destination: Tables<'warehouses'> | null }
type TransferItem = Tables<'stock_transfer_items'> & { skus: Tables<'skus'> | null }
type Sku = Tables<'skus'>
type Warehouse = Tables<'warehouses'>

interface DraftLine {
  sku_id: string
  requested_qty: string
}

const BLANK_LINE: DraftLine = { sku_id: '', requested_qty: '' }

const STATUS_COLOR: Record<Enums<'transfer_status'>, string> = {
  requested: 'bg-slate-100 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300',
  approved: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  dispatched: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  in_transit: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  received: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

export default function StockTransfer() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [transfers, setTransfers] = useState<TransferRow[]>([])
  const [loading, setLoading] = useState(true)
  const [skus, setSkus] = useState<Sku[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ source_warehouse_id: '', destination_warehouse_id: '', notes: '' })
  const [lines, setLines] = useState<DraftLine[]>([{ ...BLANK_LINE }])
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [itemsByTransfer, setItemsByTransfer] = useState<Record<string, TransferItem[]>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [dispatchDraft, setDispatchDraft] = useState<Record<string, string>>({})
  const [receiveDraft, setReceiveDraft] = useState<Record<string, { received: string; damaged: string }>>({})

  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const [{ data: t }, { data: s }, { data: w }] = await Promise.all([
      supabase.from('stock_transfers').select('*, source:source_warehouse_id(*), destination:destination_warehouse_id(*)').order('created_at', { ascending: false }),
      supabase.from('skus').select('*').eq('active', true).order('sku'),
      supabase.from('warehouses').select('*').order('name'),
    ])
    setTransfers((t as unknown as TransferRow[]) ?? [])
    setSkus(s ?? [])
    setWarehouses(w ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  async function submitTransfer() {
    if (!orgId || !form.source_warehouse_id || !form.destination_warehouse_id) {
      showError('Select a source and destination warehouse.')
      return
    }
    if (form.source_warehouse_id === form.destination_warehouse_id) {
      showError('Source and destination must be different warehouses.')
      return
    }
    const validLines = lines.filter((l) => l.sku_id && Number(l.requested_qty) > 0)
    if (validLines.length === 0) {
      showError('Add at least one line item with a quantity.')
      return
    }
    setSaving(true)
    try {
      const { data: transferNumber, error: numError } = await supabase.rpc('next_transfer_number')
      if (numError || !transferNumber) throw numError ?? new Error('Could not allocate transfer number')

      const { data: transfer, error: transferError } = await supabase
        .from('stock_transfers')
        .insert({
          organization_id: orgId,
          transfer_number: transferNumber,
          source_warehouse_id: form.source_warehouse_id,
          destination_warehouse_id: form.destination_warehouse_id,
          notes: form.notes || null,
          requested_by: profile!.id,
        })
        .select()
        .single()
      if (transferError || !transfer) throw transferError ?? new Error('Could not create transfer')

      const { error: itemsError } = await supabase.from('stock_transfer_items').insert(
        validLines.map((l) => ({
          organization_id: orgId,
          transfer_id: transfer.id,
          sku_id: l.sku_id,
          requested_qty: Number(l.requested_qty) || 0,
        }))
      )
      if (itemsError) throw itemsError

      showSuccess(`Transfer ${transferNumber} requested — needs approval before dispatch.`)
      setForm((f) => ({ ...f, notes: '' }))
      setLines([{ ...BLANK_LINE }])
      setShowNew(false)
      load()
    } catch (err) {
      reportError(showError, 'Create transfer', err as { message: string }, orgId, profile?.id)
    } finally {
      setSaving(false)
    }
  }

  async function expand(t: TransferRow) {
    setExpandedId(expandedId === t.id ? null : t.id)
    if (itemsByTransfer[t.id]) return
    const { data } = await supabase.from('stock_transfer_items').select('*, skus(*)').eq('transfer_id', t.id)
    const items = (data as unknown as TransferItem[]) ?? []
    setItemsByTransfer((m) => ({ ...m, [t.id]: items }))
    setDispatchDraft((m) => ({ ...m, ...Object.fromEntries(items.map((i) => [i.id, m[i.id] ?? String(i.requested_qty)])) }))
    setReceiveDraft((m) => ({
      ...m,
      ...Object.fromEntries(items.map((i) => [i.id, m[i.id] ?? { received: String(i.dispatched_qty), damaged: '0' }])),
    }))
  }

  async function approve(t: TransferRow) {
    setBusyId(t.id)
    const { error } = await supabase.from('stock_transfers').update({ status: 'approved', approved_by: profile!.id, approved_at: new Date().toISOString() }).eq('id', t.id)
    setBusyId(null)
    if (error) {
      reportError(showError, 'Approve transfer', error, orgId, profile?.id)
      return
    }
    load()
  }

  async function reject(t: TransferRow) {
    setBusyId(t.id)
    const { error } = await supabase.from('stock_transfers').update({ status: 'rejected' }).eq('id', t.id)
    setBusyId(null)
    if (error) {
      reportError(showError, 'Reject transfer', error, orgId, profile?.id)
      return
    }
    load()
  }

  // Dispatch deducts source-warehouse stock immediately (transfer_out) -
  // goods are physically gone from there whether or not they've arrived yet.
  async function dispatch(t: TransferRow) {
    const items = itemsByTransfer[t.id] ?? []
    setBusyId(t.id)
    try {
      const updates = items.map((i) => ({ id: i.id, dispatched_qty: Number(dispatchDraft[i.id] ?? i.requested_qty) || 0 }))

      // Cannot dispatch more than what's actually available at the source
      // warehouse right now - checked fresh at dispatch time, not just
      // against the requested_qty entered when the transfer was created.
      const { data: sourceLedger } = await supabase
        .from('inventory_ledger')
        .select('sku_id, quantity_delta')
        .eq('warehouse_id', t.source_warehouse_id)
      const availableBySku: Record<string, number> = {}
      for (const row of sourceLedger ?? []) availableBySku[row.sku_id] = (availableBySku[row.sku_id] ?? 0) + row.quantity_delta
      const shortages = updates.filter((u) => u.dispatched_qty > 0 && u.dispatched_qty > (availableBySku[items.find((i) => i.id === u.id)!.sku_id] ?? 0))
      if (shortages.length > 0) {
        const detail = shortages
          .map((u) => {
            const item = items.find((i) => i.id === u.id)!
            return `${item.skus?.sku} (want ${u.dispatched_qty}, have ${availableBySku[item.sku_id] ?? 0})`
          })
          .join(', ')
        setBusyId(null)
        showError(`Insufficient stock at ${t.source?.name} to dispatch: ${detail}.`)
        return
      }

      for (const u of updates) {
        const { error } = await supabase.from('stock_transfer_items').update({ dispatched_qty: u.dispatched_qty }).eq('id', u.id)
        if (error) throw error
      }
      const withQty = updates.filter((u) => u.dispatched_qty > 0)
      if (withQty.length > 0) {
        const { error: ledgerError } = await supabase.from('inventory_ledger').insert(
          withQty.map((u) => {
            const item = items.find((i) => i.id === u.id)!
            return {
              organization_id: orgId!,
              sku_id: item.sku_id,
              warehouse_id: t.source_warehouse_id,
              movement_type: 'transfer_out' as const,
              quantity_delta: -u.dispatched_qty,
              reference_type: 'stock_transfer',
              reference_id: t.id,
              note: `Transfer ${t.transfer_number} to ${t.destination?.name ?? 'destination'}`,
              created_by: profile!.id,
            }
          })
        )
        if (ledgerError) throw ledgerError
      }
      const { error: statusError } = await supabase
        .from('stock_transfers')
        .update({ status: 'dispatched', dispatched_by: profile!.id, dispatched_at: new Date().toISOString() })
        .eq('id', t.id)
      if (statusError) throw statusError
      showSuccess(`Transfer ${t.transfer_number} dispatched — stock deducted from ${t.source?.name}.`)
      setItemsByTransfer((m) => {
        const rest = { ...m }
        delete rest[t.id]
        return rest
      })
      load()
    } catch (err) {
      reportError(showError, 'Dispatch transfer', err as { message: string }, orgId, profile?.id)
    } finally {
      setBusyId(null)
    }
  }

  // Receive adds destination-warehouse stock (transfer_in) for whatever
  // actually arrived - shortage is whatever's left unaccounted for between
  // dispatched, received, and damaged, and is never silently absorbed.
  async function receive(t: TransferRow) {
    const items = itemsByTransfer[t.id] ?? []
    setBusyId(t.id)
    try {
      const updates = items.map((i) => {
        const draft = receiveDraft[i.id] ?? { received: String(i.dispatched_qty), damaged: '0' }
        return { id: i.id, sku_id: i.sku_id, received_qty: Number(draft.received) || 0, damaged_qty: Number(draft.damaged) || 0 }
      })
      for (const u of updates) {
        const { error } = await supabase.from('stock_transfer_items').update({ received_qty: u.received_qty, damaged_qty: u.damaged_qty }).eq('id', u.id)
        if (error) throw error
      }
      const withQty = updates.filter((u) => u.received_qty > 0)
      if (withQty.length > 0) {
        const { error: ledgerError } = await supabase.from('inventory_ledger').insert(
          withQty.map((u) => ({
            organization_id: orgId!,
            sku_id: u.sku_id,
            warehouse_id: t.destination_warehouse_id,
            movement_type: 'transfer_in' as const,
            quantity_delta: u.received_qty,
            reference_type: 'stock_transfer',
            reference_id: t.id,
            note: `Transfer ${t.transfer_number} from ${t.source?.name ?? 'source'}`,
            created_by: profile!.id,
          }))
        )
        if (ledgerError) throw ledgerError
      }
      const { error: statusError } = await supabase
        .from('stock_transfers')
        .update({ status: 'received', received_by: profile!.id, received_at: new Date().toISOString() })
        .eq('id', t.id)
      if (statusError) throw statusError
      const shortages = updates.filter((u) => {
        const item = items.find((i) => i.id === u.id)!
        return item.dispatched_qty - u.received_qty - u.damaged_qty > 0
      })
      showSuccess(
        `Transfer ${t.transfer_number} received — stock added to ${t.destination?.name}.${
          shortages.length > 0 ? ` ${shortages.length} line(s) short of dispatched qty.` : ''
        }`
      )
      setItemsByTransfer((m) => {
        const rest = { ...m }
        delete rest[t.id]
        return rest
      })
      load()
    } catch (err) {
      reportError(showError, 'Receive transfer', err as { message: string }, orgId, profile?.id)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Stock Transfers</h2>
        {canEdit && (
          <button onClick={() => setShowNew((v) => !v)} className="text-sm rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700/40">
            {showNew ? 'Cancel' : '+ New transfer'}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">
        Requested → Approved → Dispatched (source stock deducted) → Received (destination stock added). Shortage/damage on receipt is
        tracked, never silently absorbed into either warehouse's count.
      </p>

      {showNew && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Source warehouse</span>
              <select value={form.source_warehouse_id} onChange={(e) => setForm((f) => ({ ...f, source_warehouse_id: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100">
                <option value="">Select…</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Destination warehouse</span>
              <select value={form.destination_warehouse_id} onChange={(e) => setForm((f) => ({ ...f, destination_warehouse_id: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100">
                <option value="">Select…</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Notes (optional)</span>
              <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
            </label>
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">Line items</div>
          <div className="space-y-2 mb-3">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-4 gap-2 items-center">
                <select value={l.sku_id} onChange={(e) => updateLine(i, { sku_id: e.target.value })} className="col-span-2 text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100">
                  <option value="">Select SKU…</option>
                  {skus.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.sku} — {s.title}
                    </option>
                  ))}
                </select>
                <input type="number" placeholder="Qty" value={l.requested_qty} onChange={(e) => updateLine(i, { requested_qty: e.target.value })} className="text-sm rounded-lg border border-slate-300 px-2 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
                <button onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} disabled={lines.length === 1} className="text-xs text-slate-400 dark:text-slate-500 hover:text-red-600 disabled:opacity-30">
                  ✕ Remove
                </button>
              </div>
            ))}
            <button onClick={() => setLines((ls) => [...ls, { ...BLANK_LINE }])} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
              + Add line item
            </button>
          </div>

          <button onClick={submitTransfer} disabled={saving || warehouses.length < 2} className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Request transfer'}
          </button>
          {warehouses.length < 2 && <p className="text-xs text-amber-600 mt-2">Need at least 2 warehouses to transfer between them.</p>}
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {loading ? (
          <Skeleton rows={3} />
        ) : transfers.length === 0 ? (
          <EmptyState icon="🔀" title="No stock transfers yet." />
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-700/60">
            {transfers.map((t) => (
              <div key={t.id}>
                <button onClick={() => expand(t)} className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  <div>
                    <div className="font-medium text-sm text-slate-900 dark:text-slate-100">
                      {t.transfer_number} — {t.source?.name ?? '—'} → {t.destination?.name ?? '—'}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500">{format(new Date(t.created_at), 'dd MMM yyyy, HH:mm')}</div>
                  </div>
                  <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${STATUS_COLOR[t.status]}`}>{t.status.replace('_', ' ')}</span>
                </button>
                {expandedId === t.id && (
                  <div className="border-t border-slate-100 dark:border-slate-700/60 px-4 py-3 bg-slate-50 dark:bg-slate-700/40">
                    <table className="w-full text-sm mb-3">
                      <thead>
                        <tr className="text-left text-xs text-slate-400 dark:text-slate-500">
                          <th className="py-1 font-medium">SKU</th>
                          <th className="py-1 font-medium text-right">Requested</th>
                          <th className="py-1 font-medium text-right">Dispatched</th>
                          <th className="py-1 font-medium text-right">Received</th>
                          <th className="py-1 font-medium text-right">Damaged</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(itemsByTransfer[t.id] ?? []).map((i) => (
                          <tr key={i.id}>
                            <td className="py-1 text-slate-700 dark:text-slate-300">{i.skus?.sku}</td>
                            <td className="py-1 text-right text-slate-500 dark:text-slate-400">
                              {t.status === 'approved' && canEdit ? (
                                <input
                                  type="number"
                                  value={dispatchDraft[i.id] ?? String(i.requested_qty)}
                                  onChange={(e) => setDispatchDraft((m) => ({ ...m, [i.id]: e.target.value }))}
                                  className="w-16 text-right text-sm rounded border border-slate-300 px-1.5 py-0.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                                />
                              ) : (
                                i.requested_qty
                              )}
                            </td>
                            <td className="py-1 text-right text-slate-500 dark:text-slate-400">{i.dispatched_qty}</td>
                            <td className="py-1 text-right text-slate-500 dark:text-slate-400">
                              {t.status === 'dispatched' || t.status === 'in_transit' ? (
                                canEdit && (
                                  <input
                                    type="number"
                                    value={receiveDraft[i.id]?.received ?? String(i.dispatched_qty)}
                                    onChange={(e) => setReceiveDraft((m) => ({ ...m, [i.id]: { received: e.target.value, damaged: m[i.id]?.damaged ?? '0' } }))}
                                    className="w-16 text-right text-sm rounded border border-slate-300 px-1.5 py-0.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                                  />
                                )
                              ) : (
                                i.received_qty
                              )}
                            </td>
                            <td className="py-1 text-right text-slate-500 dark:text-slate-400">
                              {t.status === 'dispatched' || t.status === 'in_transit' ? (
                                canEdit && (
                                  <input
                                    type="number"
                                    value={receiveDraft[i.id]?.damaged ?? '0'}
                                    onChange={(e) => setReceiveDraft((m) => ({ ...m, [i.id]: { received: m[i.id]?.received ?? String(i.dispatched_qty), damaged: e.target.value } }))}
                                    className="w-16 text-right text-sm rounded border border-slate-300 px-1.5 py-0.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                                  />
                                )
                              ) : (
                                i.damaged_qty
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {canEdit && (
                      <div className="flex gap-2">
                        {t.status === 'requested' && (
                          <>
                            <button onClick={() => approve(t)} disabled={busyId === t.id} className="text-xs font-medium rounded-lg bg-blue-600 text-white px-3 py-1.5 hover:bg-blue-700 disabled:opacity-50">
                              Approve
                            </button>
                            <button onClick={() => reject(t)} disabled={busyId === t.id} className="text-xs font-medium rounded-lg border border-red-300 text-red-600 px-3 py-1.5 hover:bg-red-50 disabled:opacity-50">
                              Reject
                            </button>
                          </>
                        )}
                        {t.status === 'approved' && (
                          <button onClick={() => dispatch(t)} disabled={busyId === t.id} className="text-xs font-medium rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50">
                            {busyId === t.id ? 'Dispatching…' : 'Dispatch (deducts source stock)'}
                          </button>
                        )}
                        {(t.status === 'dispatched' || t.status === 'in_transit') && (
                          <button onClick={() => receive(t)} disabled={busyId === t.id} className="text-xs font-medium rounded-lg bg-emerald-600 text-white px-3 py-1.5 hover:bg-emerald-700 disabled:opacity-50">
                            {busyId === t.id ? 'Receiving…' : 'Receive (adds destination stock)'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
