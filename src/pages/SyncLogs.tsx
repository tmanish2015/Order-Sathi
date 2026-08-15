import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables } from '../lib/database.types'

type Log = Tables<'sync_logs'>
const PAGE_SIZE = 25

const STATUS_COLOR: Record<Log['status'], string> = {
  success: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  partial: 'bg-amber-100 text-amber-700',
}

const FAULT_LABEL: Record<NonNullable<Log['fault']>, string> = {
  amazon: "Amazon's side",
  order_sathi: "Order Sathi's side",
  seller_data: 'Data issue on your end',
  unknown: 'Unknown',
}

export default function SyncLogs() {
  const { profile } = useAuth()
  const [logs, setLogs] = useState<Log[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [statusFilter, setStatusFilter] = useState<Log['status'] | ''>('')
  const orgId = profile?.organization_id

  async function load(offset: number, replace: boolean) {
    if (!orgId) return
    replace ? setLoading(true) : setLoadingMore(true)
    let query = supabase.from('sync_logs').select('*').order('started_at', { ascending: false })
    if (statusFilter) query = query.eq('status', statusFilter)
    const { data } = await query.range(offset, offset + PAGE_SIZE - 1)
    setLogs((prev) => (replace ? data ?? [] : [...prev, ...(data ?? [])]))
    setHasMore((data ?? []).length === PAGE_SIZE)
    setLoading(false)
    setLoadingMore(false)
  }

  useEffect(() => {
    load(0, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, statusFilter])

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">Sync Logs</h2>
      <p className="text-xs text-slate-400 mb-6">Every SP-API and MTR operation, with what failed, why, and who's responsible.</p>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as Log['status'] | '')}
            className="text-sm rounded-lg border border-slate-300 px-2 py-1.5"
          >
            <option value="">All statuses</option>
            <option value="success">Success</option>
            <option value="partial">Partial</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        {loading ? (
          <Skeleton />
        ) : logs.length === 0 ? (
          <EmptyState icon="📡" title={statusFilter ? 'No logs match this filter.' : 'No sync activity yet.'} />
        ) : (
          <div className="divide-y divide-slate-100">
            {logs.map((log) => (
              <div key={log.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="font-medium text-sm text-slate-900">{log.operation}</div>
                  <div className="flex items-center gap-2">
                    {log.fault && (
                      <span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">
                        {FAULT_LABEL[log.fault]}
                      </span>
                    )}
                    <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${STATUS_COLOR[log.status]}`}>
                      {log.status}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-slate-600 mt-1">{log.message}</p>
                <p className="text-xs text-slate-400 mt-1">{format(new Date(log.started_at), 'dd MMM yyyy, HH:mm')}</p>
              </div>
            ))}
          </div>
        )}

        {!loading && hasMore && (
          <div className="px-4 py-3 border-t border-slate-100 text-center">
            <button
              onClick={() => load(logs.length, false)}
              disabled={loadingMore}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
