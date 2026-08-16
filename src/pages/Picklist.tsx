import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables } from '../lib/database.types'

type Picklist = Tables<'picklists'>
type PicklistItem = Tables<'picklist_items'> & { skus: Tables<'skus'> | null }
type LineItem = Tables<'order_line_items'> & { skus: Tables<'skus'> | null }

export default function Picklist() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [picklists, setPicklists] = useState<Picklist[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [itemsByPicklist, setItemsByPicklist] = useState<Record<string, PicklistItem[]>>({})
  const [loadingItems, setLoadingItems] = useState(false)
  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const { data } = await supabase.from('picklists').select('*').order('created_at', { ascending: false })
    setPicklists(data ?? [])
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
      const { data: pendingOrders } = await supabase.from('orders').select('id').eq('order_status', 'pending')
      const orderIds = (pendingOrders ?? []).map((o) => o.id)
      if (orderIds.length === 0) {
        showError('No pending orders to pick.')
        return
      }

      const { data: lineItems } = await supabase.from('order_line_items').select('*, skus(*)').in('order_id', orderIds)
      const bySku = new Map<string, number>()
      for (const li of (lineItems as unknown as LineItem[]) ?? []) {
        bySku.set(li.sku_id, (bySku.get(li.sku_id) ?? 0) + li.quantity)
      }
      if (bySku.size === 0) {
        showError('Pending orders have no line items to pick.')
        return
      }

      const { data: picklist, error: plError } = await supabase
        .from('picklists')
        .insert({ organization_id: orgId, order_count: orderIds.length, created_by: profile!.id })
        .select()
        .single()
      if (plError || !picklist) throw plError ?? new Error('Could not create picklist')

      const { error: itemsError } = await supabase.from('picklist_items').insert(
        Array.from(bySku.entries()).map(([sku_id, total_quantity]) => ({
          organization_id: orgId,
          picklist_id: picklist.id,
          sku_id,
          total_quantity,
        }))
      )
      if (itemsError) throw itemsError

      showSuccess(`Picklist generated: ${bySku.size} SKUs across ${orderIds.length} pending orders.`)
      setExpandedId(null)
      load()
    } catch (err) {
      reportError(showError, 'Generate picklist', err as { message: string }, orgId, profile?.id)
    } finally {
      setGenerating(false)
    }
  }

  async function togglePicked(item: PicklistItem) {
    const { error } = await supabase.from('picklist_items').update({ picked: !item.picked }).eq('id', item.id)
    if (error) {
      reportError(showError, 'Update picklist item', error, orgId, profile?.id)
      return
    }
    setItemsByPicklist((m) => ({
      ...m,
      [item.picklist_id]: m[item.picklist_id].map((i) => (i.id === item.id ? { ...i, picked: !i.picked } : i)),
    }))
  }

  async function completePicklist(pl: Picklist) {
    const { error } = await supabase.from('picklists').update({ status: 'completed' }).eq('id', pl.id)
    if (error) {
      reportError(showError, 'Complete picklist', error, orgId, profile?.id)
      return
    }
    load()
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-1">
        <h2 className="text-lg font-semibold text-slate-900">Picklists</h2>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
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
      <p className="text-xs text-slate-400 mb-6">
        Snapshots what's needed for every currently pending order, aggregated by SKU — a fixed list to work from, not a live view that shifts
        while you're picking.
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
            return (
              <div key={pl.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <button onClick={() => expand(pl.id)} className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50">
                  <div>
                    <div className="font-medium text-sm text-slate-900">
                      {format(new Date(pl.created_at), 'dd MMM yyyy, HH:mm')} — {pl.order_count} order{pl.order_count === 1 ? '' : 's'}
                    </div>
                    {items && <div className="text-xs text-slate-400">{pickedCount} of {items.length} SKUs picked</div>}
                  </div>
                  <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${pl.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {pl.status}
                  </span>
                </button>
                {expandedId === pl.id && (
                  <div className="border-t border-slate-100">
                    {loadingItems && !items ? (
                      <Skeleton rows={2} />
                    ) : (
                      <>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                              <th className="px-4 py-2 font-medium w-8"></th>
                              <th className="px-4 py-2 font-medium">SKU</th>
                              <th className="px-4 py-2 font-medium">Title</th>
                              <th className="px-4 py-2 font-medium text-right">Qty to pick</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {(items ?? []).map((i) => (
                              <tr key={i.id} className={i.picked ? 'bg-slate-50' : ''}>
                                <td className="px-4 py-2.5">
                                  <input type="checkbox" checked={i.picked} onChange={() => canEdit && togglePicked(i)} disabled={!canEdit} />
                                </td>
                                <td className={`px-4 py-2.5 font-medium ${i.picked ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{i.skus?.sku}</td>
                                <td className={`px-4 py-2.5 ${i.picked ? 'text-slate-400 line-through' : 'text-slate-500'}`}>{i.skus?.title}</td>
                                <td className={`px-4 py-2.5 text-right ${i.picked ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{i.total_quantity}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {canEdit && pl.status === 'open' && (
                          <div className="px-4 py-3 border-t border-slate-100">
                            <button onClick={() => completePicklist(pl)} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                              Mark picklist complete
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
