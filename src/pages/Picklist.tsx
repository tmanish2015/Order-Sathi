import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import BarcodeScanInput from '../components/BarcodeScanInput'
import type { Tables, Enums } from '../lib/database.types'

type Picklist = Tables<'picklists'>
type PicklistItem = Tables<'picklist_items'> & { skus: Tables<'skus'> | null }
type LineItem = Tables<'order_line_items'>
type Profile = Tables<'profiles'>

const STATUS_COLOR: Record<Enums<'picklist_status'>, string> = {
  created: 'bg-slate-100 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300',
  assigned: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  picking: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  picked: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
}

export default function Picklist() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [picklists, setPicklists] = useState<Picklist[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [itemsByPicklist, setItemsByPicklist] = useState<Record<string, PicklistItem[]>>({})
  const [loadingItems, setLoadingItems] = useState(false)
  const [team, setTeam] = useState<Profile[]>([])
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [savingItemId, setSavingItemId] = useState<string | null>(null)
  const [transitioningId, setTransitioningId] = useState<string | null>(null)
  const [scanFeedback, setScanFeedback] = useState<Record<string, { ok: boolean; message: string }>>({})
  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const [{ data }, { data: profiles }] = await Promise.all([
      supabase.from('picklists').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('*').eq('status', 'active'),
    ])
    setPicklists(data ?? [])
    setTeam(profiles ?? [])
    setLoading(false)
    if (data && data.length > 0 && !expandedId) {
      expand(data[0].id)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  async function expand(id: string) {
    setExpandedId(expandedId === id ? null : id)
    if (itemsByPicklist[id]) return
    setLoadingItems(true)
    const { data } = await supabase.from('picklist_items').select('*, skus(*)').eq('picklist_id', id).order('created_at')
    setItemsByPicklist((m) => ({ ...m, [id]: (data as unknown as PicklistItem[]) ?? [] }))
    setLoadingItems(false)
  }

  async function generate() {
    if (!orgId) return
    setGenerating(true)
    try {
      const { data: readyOrders } = await supabase.from('orders').select('id').eq('order_status', 'ready_to_pick')
      const orderIds = (readyOrders ?? []).map((o) => o.id)
      if (orderIds.length === 0) {
        showError('No orders are Ready to Pick.')
        return
      }

      const { data: lineItems } = await supabase.from('order_line_items').select('*').in('order_id', orderIds)
      const bySku = new Map<string, { qty: number; orderIds: Set<string> }>()
      for (const li of (lineItems as unknown as LineItem[]) ?? []) {
        const existing = bySku.get(li.sku_id) ?? { qty: 0, orderIds: new Set<string>() }
        existing.qty += li.allocated_qty
        existing.orderIds.add(li.order_id)
        bySku.set(li.sku_id, existing)
      }
      if (bySku.size === 0) {
        showError('Ready-to-pick orders have no allocated quantity yet — allocate inventory first.')
        return
      }

      const { data: picklist, error: plError } = await supabase
        .from('picklists')
        .insert({ organization_id: orgId, order_count: orderIds.length, created_by: profile!.id })
        .select()
        .single()
      if (plError || !picklist) throw plError ?? new Error('Could not create picklist')

      const { error: itemsError } = await supabase.from('picklist_items').insert(
        Array.from(bySku.entries()).map(([sku_id, v]) => ({
          organization_id: orgId,
          picklist_id: picklist.id,
          sku_id,
          total_quantity: v.qty,
          order_ids: Array.from(v.orderIds),
        }))
      )
      if (itemsError) throw itemsError

      showSuccess(`Picklist generated: ${bySku.size} SKUs across ${orderIds.length} orders.`)
      setExpandedId(null)
      load()
    } catch (err) {
      reportError(showError, 'Generate picklist', err as { message: string }, orgId, profile?.id)
    } finally {
      setGenerating(false)
    }
  }

  async function assignPicker(pl: Picklist, pickerId: string) {
    setTransitioningId(pl.id)
    const { error } = await supabase.from('picklists').update({ assigned_to: pickerId, status: 'assigned' }).eq('id', pl.id)
    setTransitioningId(null)
    if (error) {
      reportError(showError, 'Assign picker', error, orgId, profile?.id)
      return
    }
    load()
  }

  async function startPicking(pl: Picklist) {
    setTransitioningId(pl.id)
    const { error } = await supabase.from('picklists').update({ status: 'picking' }).eq('id', pl.id)
    setTransitioningId(null)
    if (error) {
      reportError(showError, 'Start picking', error, orgId, profile?.id)
      return
    }
    load()
  }

  // Distributes an aggregated SKU's picked quantity back to the specific
  // order lines that contributed to it, FIFO by order date, capped at each
  // line's allocated_qty. Recomputed from scratch each save (idempotent),
  // not incremented, so re-entering a value never double-counts.
  async function savePickedQty(pl: Picklist, item: PicklistItem, newQty: number) {
    setSavingItemId(item.id)
    try {
      const cappedQty = Math.min(Math.max(newQty, 0), item.total_quantity)

      const { data: orders } = await supabase.from('orders').select('id, order_date').in('id', item.order_ids)
      const orderDateById = new Map((orders ?? []).map((o) => [o.id, o.order_date]))
      const { data: lines } = await supabase.from('order_line_items').select('*').eq('sku_id', item.sku_id).in('order_id', item.order_ids)
      const sortedLines = (lines ?? []).sort((a, b) => (orderDateById.get(a.order_id) ?? '').localeCompare(orderDateById.get(b.order_id) ?? ''))

      let remaining = cappedQty
      for (const line of sortedLines) {
        const give = Math.min(remaining, line.allocated_qty)
        await supabase.from('order_line_items').update({ picked_qty: give }).eq('id', line.id)
        remaining -= give
      }

      // Any order whose lines are now fully picked moves to 'picked'.
      for (const orderId of item.order_ids) {
        const { data: orderLines } = await supabase.from('order_line_items').select('allocated_qty, picked_qty').eq('order_id', orderId)
        const fullyPicked = (orderLines ?? []).every((l) => l.picked_qty >= l.allocated_qty)
        if (fullyPicked) await supabase.from('orders').update({ order_status: 'picked' }).eq('id', orderId)
      }

      const { error } = await supabase.from('picklist_items').update({ picked_qty: cappedQty, picked: cappedQty >= item.total_quantity }).eq('id', item.id)
      if (error) throw error

      showSuccess(`${item.skus?.sku}: ${cappedQty} of ${item.total_quantity} picked.`)
      setItemsByPicklist((m) => ({
        ...m,
        [pl.id]: m[pl.id].map((i) => (i.id === item.id ? { ...i, picked_qty: cappedQty, picked: cappedQty >= item.total_quantity } : i)),
      }))
    } catch (err) {
      reportError(showError, 'Save picked quantity', err as { message: string }, orgId, profile?.id)
    } finally {
      setSavingItemId(null)
    }
  }

  // Scan-to-pick: match the scanned barcode against this picklist's items
  // only (that IS "the expected SKU" for an aggregated picklist), then
  // reuse the exact same savePickedQty() the manual quantity box uses -
  // no second engine, no bypass of the allocated-qty cap.
  async function handleScan(pl: Picklist, code: string) {
    const items = itemsByPicklist[pl.id] ?? []
    const match = items.find((i) => i.skus?.barcode === code)
    if (!match) {
      setScanFeedback((m) => ({ ...m, [pl.id]: { ok: false, message: `Scanned barcode "${code}" does not match any item on this picklist — wrong item.` } }))
      return
    }
    const currentQty = Number(editValues[match.id] ?? match.picked_qty)
    if (currentQty >= match.total_quantity) {
      setScanFeedback((m) => ({
        ...m,
        [pl.id]: { ok: false, message: `${match.skus?.sku}: already at required quantity (${match.total_quantity}).` },
      }))
      return
    }
    const newQty = currentQty + 1
    setEditValues((m) => ({ ...m, [match.id]: String(newQty) }))
    await savePickedQty(pl, match, newQty)
    const remaining = match.total_quantity - newQty
    setScanFeedback((m) => ({
      ...m,
      [pl.id]: { ok: true, message: `${match.skus?.sku} — picked ${newQty} of ${match.total_quantity} (${remaining} remaining).` },
    }))
  }

  async function markPicklistPicked(pl: Picklist) {
    setTransitioningId(pl.id)
    const { error } = await supabase.from('picklists').update({ status: 'picked' }).eq('id', pl.id)
    setTransitioningId(null)
    if (error) {
      reportError(showError, 'Mark picklist picked', error, orgId, profile?.id)
      return
    }
    load()
  }

  async function completePicklist(pl: Picklist) {
    setTransitioningId(pl.id)
    const { error } = await supabase.from('picklists').update({ status: 'completed' }).eq('id', pl.id)
    setTransitioningId(null)
    if (error) {
      reportError(showError, 'Complete picklist', error, orgId, profile?.id)
      return
    }
    load()
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-1">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Picklists</h2>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="text-sm rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700/40">
              🖨 Print
            </button>
            <button
              onClick={generate}
              disabled={generating}
              className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50"
            >
              {generating ? 'Generating…' : '+ Generate picklist'}
            </button>
          </div>
        )}
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">
        Snapshots what's needed for every order Ready to Pick, aggregated by SKU. Created → Assigned → Picking → Picked → Completed. The
        picker can't enter more than the required quantity.
      </p>

      {loading ? (
        <Skeleton rows={3} />
      ) : picklists.length === 0 ? (
        <EmptyState icon="🧾" title="No picklists generated yet." />
      ) : (
        <div className="space-y-4">
          {picklists.map((pl) => {
            const items = itemsByPicklist[pl.id]
            const pickedCount = items?.filter((i) => i.picked).length ?? 0
            const picker = team.find((t) => t.id === pl.assigned_to)
            return (
              <div key={pl.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                <button onClick={() => expand(pl.id)} className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  <div>
                    <div className="font-medium text-sm text-slate-900 dark:text-slate-100">
                      {format(new Date(pl.created_at), 'dd MMM yyyy, HH:mm')} — {pl.order_count} order{pl.order_count === 1 ? '' : 's'}
                      {picker && <span className="text-slate-400 dark:text-slate-500 font-normal"> · {picker.full_name ?? picker.email}</span>}
                    </div>
                    {items && <div className="text-xs text-slate-400 dark:text-slate-500">{pickedCount} of {items.length} SKUs picked</div>}
                  </div>
                  <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${STATUS_COLOR[pl.status]}`}>{pl.status}</span>
                </button>
                {expandedId === pl.id && (
                  <div className="border-t border-slate-100 dark:border-slate-700/60">
                    {canEdit && pl.status === 'created' && (
                      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/60 flex items-center gap-2">
                        <span className="text-xs text-slate-500 dark:text-slate-400">Assign to:</span>
                        <select
                          onChange={(e) => e.target.value && assignPicker(pl, e.target.value)}
                          disabled={transitioningId === pl.id}
                          defaultValue=""
                          className="text-sm rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 dark:bg-slate-800 dark:text-slate-100"
                        >
                          <option value="" disabled>
                            Select picker…
                          </option>
                          {team.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.full_name ?? t.email}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {canEdit && pl.status === 'assigned' && (
                      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/60">
                        <button onClick={() => startPicking(pl)} disabled={transitioningId === pl.id} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                          Start picking
                        </button>
                      </div>
                    )}
                    {canEdit && pl.status === 'picking' && (
                      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/60 bg-blue-50">
                        <span className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">📷 Scan barcode to pick (auto-increments)</span>
                        <BarcodeScanInput onScan={(code) => handleScan(pl, code)} placeholder="Scan or type barcode, then Enter" />
                        {scanFeedback[pl.id] && (
                          <p className={`text-xs mt-1 ${scanFeedback[pl.id].ok ? 'text-emerald-600' : 'text-red-600 font-medium'}`}>
                            {scanFeedback[pl.id].ok ? '✓' : '⚠ Mismatch —'} {scanFeedback[pl.id].message}
                          </p>
                        )}
                      </div>
                    )}
                    {loadingItems && !items ? (
                      <Skeleton rows={2} />
                    ) : (
                      <>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-700/60">
                              <th className="px-4 py-2 font-medium">SKU</th>
                              <th className="px-4 py-2 font-medium">Title</th>
                              <th className="px-4 py-2 font-medium text-right">Required</th>
                              <th className="px-4 py-2 font-medium text-right">Picked</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
                            {(items ?? []).map((i) => (
                              <tr key={i.id} className={i.picked ? 'bg-slate-50 dark:bg-slate-700/40' : ''}>
                                <td className={`px-4 py-2.5 font-medium ${i.picked ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-slate-700 dark:text-slate-300'}`}>{i.skus?.sku}</td>
                                <td className={`px-4 py-2.5 ${i.picked ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-slate-500 dark:text-slate-400'}`}>{i.skus?.title}</td>
                                <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{i.total_quantity}</td>
                                <td className="px-4 py-2.5 text-right">
                                  {canEdit && pl.status === 'picking' ? (
                                    <div className="flex items-center justify-end gap-1.5">
                                      <input
                                        type="number"
                                        min="0"
                                        max={i.total_quantity}
                                        value={editValues[i.id] ?? String(i.picked_qty)}
                                        onChange={(e) => setEditValues((m) => ({ ...m, [i.id]: e.target.value }))}
                                        className="w-16 text-sm text-right rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1 dark:bg-slate-800 dark:text-slate-100"
                                      />
                                      <button
                                        onClick={() => savePickedQty(pl, i, Number(editValues[i.id] ?? i.picked_qty))}
                                        disabled={savingItemId === i.id}
                                        className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
                                      >
                                        {savingItemId === i.id ? '…' : 'Save'}
                                      </button>
                                    </div>
                                  ) : (
                                    <span className={i.picked ? 'text-emerald-600 font-medium' : 'text-slate-700 dark:text-slate-300'}>{i.picked_qty}</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {canEdit && pl.status === 'picking' && (
                          <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-700/60">
                            <button
                              onClick={() => markPicklistPicked(pl)}
                              disabled={transitioningId === pl.id || pickedCount < (items?.length ?? 0)}
                              className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
                              title={pickedCount < (items?.length ?? 0) ? 'All SKUs must be fully picked first' : undefined}
                            >
                              Mark picklist picked
                            </button>
                          </div>
                        )}
                        {canEdit && pl.status === 'picked' && (
                          <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-700/60">
                            <button onClick={() => completePicklist(pl)} disabled={transitioningId === pl.id} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                              Complete
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
