import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables } from '../lib/database.types'

type Ledger = Tables<'inventory_ledger'> & { skus: Tables<'skus'> | null; warehouses: Tables<'warehouses'> | null }
type Bin = Tables<'bins'>

export default function Putaway() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [rows, setRows] = useState<Ledger[]>([])
  const [bins, setBins] = useState<Bin[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedBin, setSelectedBin] = useState<Record<string, string>>({})
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const [{ data: l }, { data: b }] = await Promise.all([
      supabase
        .from('inventory_ledger')
        .select('*, skus(*), warehouses(*)')
        .eq('movement_type', 'restock')
        .is('bin_id', null)
        .order('created_at', { ascending: false }),
      supabase.from('bins').select('*').order('code'),
    ])
    setRows((l as unknown as Ledger[]) ?? [])
    setBins(b ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [orgId])

  async function assign(row: Ledger) {
    const binId = selectedBin[row.id]
    if (!binId) {
      showError('Pick a bin first.')
      return
    }
    setAssigningId(row.id)
    const { error } = await supabase.from('inventory_ledger').update({ bin_id: binId }).eq('id', row.id)
    setAssigningId(null)
    if (error) {
      reportError(showError, 'Assign bin', error, orgId, profile?.id)
      return
    }
    showSuccess(`${row.skus?.sku} put away.`)
    load()
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">Put-away</h2>
      <p className="text-xs text-slate-400 mb-6">
        Stock that's been received (restocked) but not yet assigned a bin. Assign one to close it out.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <Skeleton rows={3} />
        ) : rows.length === 0 ? (
          <EmptyState icon="📥" title="Nothing waiting to be put away." />
        ) : (
          <div className="divide-y divide-slate-50">
            {rows.map((row) => {
              const warehouseBins = bins.filter((b) => b.warehouse_id === row.warehouse_id)
              return (
                <div key={row.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-medium text-sm text-slate-900">
                      {row.skus?.sku} — {row.skus?.title}
                    </div>
                    <div className="text-xs text-slate-400">
                      +{row.quantity_delta} in {row.warehouses?.name ?? 'unknown warehouse'} · {format(new Date(row.created_at), 'dd MMM yyyy, HH:mm')}
                      {row.note && ` · ${row.note}`}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedBin[row.id] ?? ''}
                        onChange={(e) => setSelectedBin((m) => ({ ...m, [row.id]: e.target.value }))}
                        className="text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                      >
                        <option value="">
                          {warehouseBins.length === 0 ? 'No bins in this warehouse' : 'Select bin…'}
                        </option>
                        {warehouseBins.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.code}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => assign(row)}
                        disabled={assigningId === row.id || warehouseBins.length === 0}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
                      >
                        {assigningId === row.id ? 'Assigning…' : 'Assign'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
