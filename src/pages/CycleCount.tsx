import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables, Enums } from '../lib/database.types'

type CountRow = Tables<'cycle_counts'> & { warehouses: Tables<'warehouses'> | null; bins: Tables<'bins'> | null }
type CountItem = Tables<'cycle_count_items'> & { skus: Tables<'skus'> | null }
type Sku = Tables<'skus'>
type Warehouse = Tables<'warehouses'>
type Bin = Tables<'bins'>

const STATUS_COLOR: Record<Enums<'cycle_count_status'>, string> = {
  scheduled: 'bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-400',
  counting: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  pending_approval: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

export default function CycleCount() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [counts, setCounts] = useState<CountRow[]>([])
  const [loading, setLoading] = useState(true)
  const [skus, setSkus] = useState<Sku[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [bins, setBins] = useState<Bin[]>([])
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ warehouse_id: '', bin_id: '', scheduled_date: '', notes: '' })
  const [selectedSkuIds, setSelectedSkuIds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [itemsByCount, setItemsByCount] = useState<Record<string, CountItem[]>>({})
  const [physicalDraft, setPhysicalDraft] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  const orgId = profile?.organization_id
  const canCount = profile?.role === 'admin' || profile?.role === 'ops'
  const canApprove = profile?.role === 'admin'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const [{ data: c }, { data: s }, { data: w }, { data: b }] = await Promise.all([
      supabase.from('cycle_counts').select('*, warehouses(*), bins(*)').order('created_at', { ascending: false }),
      supabase.from('skus').select('*').eq('active', true).order('sku'),
      supabase.from('warehouses').select('*').order('name'),
      supabase.from('bins').select('*').order('code'),
    ])
    setCounts((c as unknown as CountRow[]) ?? [])
    setSkus(s ?? [])
    setWarehouses(w ?? [])
    setBins(b ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  function toggleSku(id: string) {
    setSelectedSkuIds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submitCount() {
    if (!orgId || !form.warehouse_id) {
      showError('Select a warehouse.')
      return
    }
    if (selectedSkuIds.size === 0) {
      showError('Select at least one SKU to count.')
      return
    }
    setSaving(true)
    try {
      const { data: countNumber, error: numError } = await supabase.rpc('next_cycle_count_number')
      if (numError || !countNumber) throw numError ?? new Error('Could not allocate count number')

      const { data: count, error: countError } = await supabase
        .from('cycle_counts')
        .insert({
          organization_id: orgId,
          count_number: countNumber,
          warehouse_id: form.warehouse_id,
          bin_id: form.bin_id || null,
          scheduled_date: form.scheduled_date || null,
          notes: form.notes || null,
          created_by: profile!.id,
        })
        .select()
        .single()
      if (countError || !count) throw countError ?? new Error('Could not create cycle count')

      // Snapshot system stock per SKU in this warehouse right now, so the
      // count is compared against a fixed point, not a moving ledger.
      const { data: ledgerRows } = await supabase.from('inventory_ledger').select('sku_id, quantity_delta').eq('warehouse_id', form.warehouse_id)
      const stockBySku: Record<string, number> = {}
      for (const row of ledgerRows ?? []) stockBySku[row.sku_id] = (stockBySku[row.sku_id] ?? 0) + row.quantity_delta

      const { error: itemsError } = await supabase.from('cycle_count_items').insert(
        Array.from(selectedSkuIds).map((sku_id) => ({
          organization_id: orgId,
          cycle_count_id: count.id,
          sku_id,
          system_qty: stockBySku[sku_id] ?? 0,
        }))
      )
      if (itemsError) throw itemsError

      showSuccess(`Cycle count ${countNumber} scheduled with ${selectedSkuIds.size} SKU(s).`)
      setForm({ warehouse_id: '', bin_id: '', scheduled_date: '', notes: '' })
      setSelectedSkuIds(new Set())
      setShowNew(false)
      load()
    } catch (err) {
      reportError(showError, 'Create cycle count', err as { message: string }, orgId, profile?.id)
    } finally {
      setSaving(false)
    }
  }

  async function expand(c: CountRow) {
    setExpandedId(expandedId === c.id ? null : c.id)
    if (itemsByCount[c.id]) return
    const { data } = await supabase.from('cycle_count_items').select('*, skus(*)').eq('cycle_count_id', c.id)
    const items = (data as unknown as CountItem[]) ?? []
    setItemsByCount((m) => ({ ...m, [c.id]: items }))
    setPhysicalDraft((m) => ({ ...m, ...Object.fromEntries(items.map((i) => [i.id, m[i.id] ?? (i.physical_qty != null ? String(i.physical_qty) : '')])) }))
  }

  async function startCounting(c: CountRow) {
    setBusyId(c.id)
    const { error } = await supabase.from('cycle_counts').update({ status: 'counting' }).eq('id', c.id)
    setBusyId(null)
    if (error) {
      reportError(showError, 'Start counting', error, orgId, profile?.id)
      return
    }
    load()
  }

  async function submitForApproval(c: CountRow) {
    const items = itemsByCount[c.id] ?? []
    const missing = items.filter((i) => !physicalDraft[i.id] || physicalDraft[i.id].trim() === '')
    if (missing.length > 0) {
      showError('Enter a physical quantity for every line before submitting.')
      return
    }
    setBusyId(c.id)
    try {
      for (const i of items) {
        const { error } = await supabase.from('cycle_count_items').update({ physical_qty: Number(physicalDraft[i.id]) || 0 }).eq('id', i.id)
        if (error) throw error
      }
      const { error: statusError } = await supabase.from('cycle_counts').update({ status: 'pending_approval' }).eq('id', c.id)
      if (statusError) throw statusError
      showSuccess(`Cycle count ${c.count_number} submitted for approval.`)
      setItemsByCount((m) => {
        const rest = { ...m }
        delete rest[c.id]
        return rest
      })
      load()
    } catch (err) {
      reportError(showError, 'Submit cycle count', err as { message: string }, orgId, profile?.id)
    } finally {
      setBusyId(null)
    }
  }

  // Only an approval posts the variance to the ledger - a rejected count
  // leaves stock exactly as it was, and nobody can adjust without this gate.
  async function approve(c: CountRow) {
    setBusyId(c.id)
    try {
      const { data: items } = await supabase.from('cycle_count_items').select('*').eq('cycle_count_id', c.id)
      const withVariance = (items ?? []).filter((i) => i.physical_qty != null && i.physical_qty - i.system_qty !== 0)
      if (withVariance.length > 0) {
        const { error: ledgerError } = await supabase.from('inventory_ledger').insert(
          withVariance.map((i) => ({
            organization_id: orgId!,
            sku_id: i.sku_id,
            warehouse_id: c.warehouse_id,
            movement_type: 'manual_adjustment' as const,
            quantity_delta: (i.physical_qty ?? 0) - i.system_qty,
            reference_type: 'cycle_count',
            reference_id: c.id,
            note: `Cycle count ${c.count_number} variance adjustment`,
            created_by: profile!.id,
          }))
        )
        if (ledgerError) throw ledgerError
      }
      const { error: statusError } = await supabase.from('cycle_counts').update({ status: 'approved', approved_by: profile!.id, approved_at: new Date().toISOString() }).eq('id', c.id)
      if (statusError) throw statusError
      showSuccess(`Cycle count ${c.count_number} approved — ${withVariance.length} variance(s) posted to the ledger.`)
      load()
    } catch (err) {
      reportError(showError, 'Approve cycle count', err as { message: string }, orgId, profile?.id)
    } finally {
      setBusyId(null)
    }
  }

  async function reject(c: CountRow) {
    setBusyId(c.id)
    const { error } = await supabase.from('cycle_counts').update({ status: 'rejected' }).eq('id', c.id)
    setBusyId(null)
    if (error) {
      reportError(showError, 'Reject cycle count', error, orgId, profile?.id)
      return
    }
    load()
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Cycle Count / Stock Audit</h2>
        {canCount && (
          <button onClick={() => setShowNew((v) => !v)} className="text-sm rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700/40">
            {showNew ? 'Cancel' : '+ New count'}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">
        System quantity is snapshotted when the count is scheduled. Variance only posts to the stock ledger after admin approval —
        rejecting a count leaves stock untouched.
      </p>

      {showNew && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Warehouse</span>
              <select value={form.warehouse_id} onChange={(e) => setForm((f) => ({ ...f, warehouse_id: e.target.value, bin_id: '' }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Select…</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Bin (optional, for reference)</span>
              <select value={form.bin_id} onChange={(e) => setForm((f) => ({ ...f, bin_id: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 dark:bg-slate-800 dark:text-slate-100">
                <option value="">No specific bin</option>
                {bins.filter((b) => b.warehouse_id === form.warehouse_id).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Scheduled date</span>
              <input type="date" value={form.scheduled_date} onChange={(e) => setForm((f) => ({ ...f, scheduled_date: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 dark:bg-slate-800 dark:text-slate-100" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Notes</span>
              <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 dark:bg-slate-800 dark:text-slate-100" />
            </label>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">SKUs to count ({selectedSkuIds.size} selected)</div>
          <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg p-2 mb-3 space-y-1">
            {skus.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selectedSkuIds.has(s.id)} onChange={() => toggleSku(s.id)} />
                {s.sku} — {s.title}
              </label>
            ))}
          </div>
          <button onClick={submitCount} disabled={saving || warehouses.length === 0} className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Schedule count'}
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {loading ? (
          <Skeleton rows={3} />
        ) : counts.length === 0 ? (
          <EmptyState icon="🔍" title="No cycle counts yet." />
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-700/60">
            {counts.map((c) => (
              <div key={c.id}>
                <button onClick={() => expand(c)} className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  <div>
                    <div className="font-medium text-sm text-slate-900 dark:text-slate-100">
                      {c.count_number} — {c.warehouses?.name ?? '—'}
                      {c.bins?.code && <span className="text-slate-400 dark:text-slate-500 font-normal"> · {c.bins.code}</span>}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500">{format(new Date(c.created_at), 'dd MMM yyyy, HH:mm')}</div>
                  </div>
                  <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${STATUS_COLOR[c.status]}`}>{c.status.replace('_', ' ')}</span>
                </button>
                {expandedId === c.id && (
                  <div className="border-t border-slate-100 dark:border-slate-700/60 px-4 py-3 bg-slate-50 dark:bg-slate-700/40">
                    <table className="w-full text-sm mb-3">
                      <thead>
                        <tr className="text-left text-xs text-slate-400 dark:text-slate-500">
                          <th className="py-1 font-medium">SKU</th>
                          <th className="py-1 font-medium text-right">System qty</th>
                          <th className="py-1 font-medium text-right">Physical qty</th>
                          <th className="py-1 font-medium text-right">Variance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(itemsByCount[c.id] ?? []).map((i) => {
                          const physical = physicalDraft[i.id] !== undefined ? physicalDraft[i.id] : i.physical_qty != null ? String(i.physical_qty) : ''
                          const variance = physical !== '' ? Number(physical) - i.system_qty : null
                          return (
                            <tr key={i.id}>
                              <td className="py-1 text-slate-700 dark:text-slate-300">{i.skus?.sku}</td>
                              <td className="py-1 text-right text-slate-500 dark:text-slate-400">{i.system_qty}</td>
                              <td className="py-1 text-right">
                                {(c.status === 'counting') && canCount ? (
                                  <input
                                    type="number"
                                    value={physical}
                                    onChange={(e) => setPhysicalDraft((m) => ({ ...m, [i.id]: e.target.value }))}
                                    className="w-20 text-right text-sm rounded border border-slate-300 dark:border-slate-600 px-1.5 py-0.5 dark:bg-slate-800 dark:text-slate-100"
                                  />
                                ) : (
                                  i.physical_qty ?? '—'
                                )}
                              </td>
                              <td className={`py-1 text-right font-medium ${variance != null && variance !== 0 ? (variance > 0 ? 'text-emerald-600' : 'text-red-600') : 'text-slate-400 dark:text-slate-500'}`}>
                                {variance != null ? (variance > 0 ? `+${variance}` : variance) : '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <div className="flex gap-2">
                      {c.status === 'scheduled' && canCount && (
                        <button onClick={() => startCounting(c)} disabled={busyId === c.id} className="text-xs font-medium rounded-lg bg-blue-600 text-white px-3 py-1.5 hover:bg-blue-700 disabled:opacity-50">
                          Start counting
                        </button>
                      )}
                      {c.status === 'counting' && canCount && (
                        <button onClick={() => submitForApproval(c)} disabled={busyId === c.id} className="text-xs font-medium rounded-lg bg-amber-600 text-white px-3 py-1.5 hover:bg-amber-700 disabled:opacity-50">
                          {busyId === c.id ? 'Submitting…' : 'Submit for approval'}
                        </button>
                      )}
                      {c.status === 'pending_approval' && canApprove && (
                        <>
                          <button onClick={() => approve(c)} disabled={busyId === c.id} className="text-xs font-medium rounded-lg bg-emerald-600 text-white px-3 py-1.5 hover:bg-emerald-700 disabled:opacity-50">
                            {busyId === c.id ? 'Approving…' : 'Approve (posts variance)'}
                          </button>
                          <button onClick={() => reject(c)} disabled={busyId === c.id} className="text-xs font-medium rounded-lg border border-red-300 text-red-600 px-3 py-1.5 hover:bg-red-50 disabled:opacity-50">
                            Reject
                          </button>
                        </>
                      )}
                      {c.status === 'pending_approval' && !canApprove && (
                        <p className="text-xs text-amber-600">Waiting on admin approval before variance can post.</p>
                      )}
                    </div>
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
