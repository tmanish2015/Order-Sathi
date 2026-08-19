import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables, Enums } from '../lib/database.types'

type BatchRow = Tables<'batches'> & { skus: Tables<'skus'> | null; warehouses: Tables<'warehouses'> | null }
type SerialRow = Tables<'serials'> & { skus: Tables<'skus'> | null; warehouses: Tables<'warehouses'> | null }

const EXPIRY_SOON_DAYS = 30

const SERIAL_STATUS_COLOR: Record<Enums<'serial_status'>, string> = {
  in_stock: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  allocated: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  shipped: 'bg-slate-100 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300',
  returned: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  damaged: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

export default function BatchSerial() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [tab, setTab] = useState<'batches' | 'serials'>('batches')
  const [batches, setBatches] = useState<BatchRow[]>([])
  const [serials, setSerials] = useState<SerialRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<Enums<'serial_status'> | ''>('')
  const [savingId, setSavingId] = useState<string | null>(null)

  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const [{ data: b }, { data: s }] = await Promise.all([
      supabase.from('batches').select('*, skus(*), warehouses(*)').order('expiry_date', { ascending: true, nullsFirst: false }),
      supabase.from('serials').select('*, skus(*), warehouses(*)').order('created_at', { ascending: false }),
    ])
    setBatches((b as unknown as BatchRow[]) ?? [])
    setSerials((s as unknown as SerialRow[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const batchRows = useMemo(() => {
    const now = Date.now()
    return batches
      .map((b) => {
        const daysToExpiry = b.expiry_date ? Math.floor((new Date(b.expiry_date).getTime() - now) / (24 * 60 * 60 * 1000)) : null
        const status = daysToExpiry == null ? 'no expiry set' : daysToExpiry < 0 ? 'expired' : daysToExpiry <= EXPIRY_SOON_DAYS ? 'expiring soon' : 'ok'
        return { ...b, daysToExpiry, status }
      })
      .filter((b) => !search.trim() || b.skus?.sku.toLowerCase().includes(search.trim().toLowerCase()) || b.batch_number.toLowerCase().includes(search.trim().toLowerCase()))
  }, [batches, search])

  const filteredSerials = useMemo(() => {
    let list = serials
    if (statusFilter) list = list.filter((s) => s.status === statusFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((s) => s.serial_number.toLowerCase().includes(q) || s.skus?.sku.toLowerCase().includes(q))
    }
    return list
  }, [serials, statusFilter, search])

  async function updateSerialStatus(s: SerialRow, status: Enums<'serial_status'>) {
    setSavingId(s.id)
    const { error } = await supabase.from('serials').update({ status, updated_at: new Date().toISOString() }).eq('id', s.id)
    setSavingId(null)
    if (error) {
      reportError(showError, 'Update serial status', error, orgId, profile?.id)
      return
    }
    showSuccess(`${s.serial_number} marked ${status.replace('_', ' ')}.`)
    load()
  }

  const expiredCount = batchRows.filter((b) => b.status === 'expired').length
  const expiringSoonCount = batchRows.filter((b) => b.status === 'expiring soon').length

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">Batch, Serial &amp; Expiry</h2>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">
        Batch and serial numbers are captured on the GRN page when a SKU's tracking mode is set (Inventory → edit SKU → Catalog details).
        Batch quantities are receipt records for expiry visibility, not a second stock ledger — <code>inventory_ledger</code> stays the
        only source of truth for how much stock exists.
      </p>

      <div className="flex gap-1 mb-4 border-b border-slate-200 dark:border-slate-700">
        {(['batches', 'serials'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
          >
            {t === 'batches' ? 'Batches / Expiry' : 'Serial numbers'}
          </button>
        ))}
      </div>

      {tab === 'batches' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-3.5">
              <div className="text-xs text-slate-400 dark:text-slate-500">Total batches</div>
              <div className="text-lg font-semibold mt-1 text-slate-900 dark:text-slate-100">{batches.length}</div>
            </div>
            <div className={`rounded-xl border shadow-sm p-3.5 ${expiringSoonCount > 0 ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
              <div className="text-xs text-slate-400 dark:text-slate-500">Expiring within {EXPIRY_SOON_DAYS}d</div>
              <div className="text-lg font-semibold mt-1 text-amber-600 dark:text-amber-400">{expiringSoonCount}</div>
            </div>
            <div className={`rounded-xl border shadow-sm p-3.5 ${expiredCount > 0 ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
              <div className="text-xs text-slate-400 dark:text-slate-500">Expired</div>
              <div className="text-lg font-semibold mt-1 text-red-600 dark:text-red-400">{expiredCount}</div>
            </div>
          </div>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SKU or batch number…" className="text-sm rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 w-64 mb-3 dark:bg-slate-800 dark:text-slate-100" />
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            {loading ? (
              <Skeleton rows={3} />
            ) : batchRows.length === 0 ? (
              <EmptyState icon="🏷" title="No batches recorded yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-700/60">
                      <th className="px-4 py-2 font-medium">SKU</th>
                      <th className="px-4 py-2 font-medium">Batch</th>
                      <th className="px-4 py-2 font-medium">Warehouse</th>
                      <th className="px-4 py-2 font-medium text-right">Qty received</th>
                      <th className="px-4 py-2 font-medium">Mfg date</th>
                      <th className="px-4 py-2 font-medium">Expiry date</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
                    {batchRows.map((b) => (
                      <tr key={b.id}>
                        <td className="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-300">{b.skus?.sku}</td>
                        <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{b.batch_number}</td>
                        <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{b.warehouses?.name ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{b.received_qty}</td>
                        <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{b.manufacturing_date ? format(new Date(b.manufacturing_date), 'dd MMM yyyy') : '—'}</td>
                        <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{b.expiry_date ? format(new Date(b.expiry_date), 'dd MMM yyyy') : '—'}</td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${
                              b.status === 'expired' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : b.status === 'expiring soon' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {b.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'serials' && (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search serial or SKU…" className="text-sm rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 w-56 dark:bg-slate-800 dark:text-slate-100" />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as Enums<'serial_status'> | '')} className="text-sm rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 dark:bg-slate-800 dark:text-slate-100">
              <option value="">All statuses</option>
              <option value="in_stock">In stock</option>
              <option value="allocated">Allocated</option>
              <option value="shipped">Shipped</option>
              <option value="returned">Returned</option>
              <option value="damaged">Damaged</option>
            </select>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            {loading ? (
              <Skeleton rows={3} />
            ) : filteredSerials.length === 0 ? (
              <EmptyState icon="🔢" title="No serial numbers recorded yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-700/60">
                      <th className="px-4 py-2 font-medium">Serial number</th>
                      <th className="px-4 py-2 font-medium">SKU</th>
                      <th className="px-4 py-2 font-medium">Warehouse</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
                    {filteredSerials.map((s) => (
                      <tr key={s.id}>
                        <td className="px-4 py-2.5 font-mono text-slate-700 dark:text-slate-300">{s.serial_number}</td>
                        <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{s.skus?.sku}</td>
                        <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{s.warehouses?.name ?? '—'}</td>
                        <td className="px-4 py-2.5">
                          {canEdit ? (
                            <select
                              value={s.status}
                              onChange={(e) => updateSerialStatus(s, e.target.value as Enums<'serial_status'>)}
                              disabled={savingId === s.id}
                              className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded border-0 ${SERIAL_STATUS_COLOR[s.status]}`}
                            >
                              <option value="in_stock">In stock</option>
                              <option value="allocated">Allocated</option>
                              <option value="shipped">Shipped</option>
                              <option value="returned">Returned</option>
                              <option value="damaged">Damaged</option>
                            </select>
                          ) : (
                            <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${SERIAL_STATUS_COLOR[s.status]}`}>{s.status.replace('_', ' ')}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
