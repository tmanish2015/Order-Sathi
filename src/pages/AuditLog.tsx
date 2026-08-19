import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables } from '../lib/database.types'

type Log = Tables<'audit_log'> & { profiles: Tables<'profiles'> | null }
const PAGE_SIZE = 25

const TABLES = ['orders', 'gst_invoices', 'reconciliation_entries', 'profiles', 'packages', 'skus', 'order_returns']

const ACTION_COLOR: Record<string, string> = {
  insert: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  update: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  delete: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

function diffFields(oldVal: Record<string, unknown> | null, newVal: Record<string, unknown> | null): [string, unknown, unknown][] {
  if (!oldVal || !newVal) return []
  const keys = new Set([...Object.keys(oldVal), ...Object.keys(newVal)])
  const out: [string, unknown, unknown][] = []
  for (const k of keys) {
    if (k === 'updated_at' || k === 'created_at') continue
    if (JSON.stringify(oldVal[k]) !== JSON.stringify(newVal[k])) out.push([k, oldVal[k], newVal[k]])
  }
  return out
}

export default function AuditLog() {
  const { profile } = useAuth()
  const [logs, setLogs] = useState<Log[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [tableFilter, setTableFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const orgId = profile?.organization_id

  async function load(offset: number, replace: boolean) {
    if (!orgId) return
    replace ? setLoading(true) : setLoadingMore(true)
    let query = supabase.from('audit_log').select('*, profiles(*)').order('changed_at', { ascending: false })
    if (tableFilter) query = query.eq('table_name', tableFilter)
    if (actionFilter) query = query.eq('action', actionFilter)
    const { data } = await query.range(offset, offset + PAGE_SIZE - 1)
    setLogs((prev) => (replace ? (data as unknown as Log[]) ?? [] : [...prev, ...((data as unknown as Log[]) ?? [])]))
    setHasMore((data ?? []).length === PAGE_SIZE)
    setLoading(false)
    setLoadingMore(false)
  }

  useEffect(() => {
    load(0, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, tableFilter, actionFilter])

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">Audit Log</h2>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">
        Every insert/update/delete on orders, invoices, reconciliation, team profiles, packages, SKUs, and returns — who changed what, and
        what it was before. Admin and finance only.
      </p>

      <div className="flex flex-wrap gap-3 mb-4">
        <select value={tableFilter} onChange={(e) => setTableFilter(e.target.value)} className="text-sm rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-2.5 py-1.5">
          <option value="">All tables</option>
          {TABLES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="text-sm rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-2.5 py-1.5">
          <option value="">All actions</option>
          <option value="insert">Insert</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
        </select>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {loading ? (
          <Skeleton rows={6} />
        ) : logs.length === 0 ? (
          <EmptyState icon="📜" title="No audit events match." />
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-700/60">
            {logs.map((l) => {
              const changes = l.action === 'update' ? diffFields(l.old_value as Record<string, unknown> | null, l.new_value as Record<string, unknown> | null) : []
              const expanded = expandedId === l.id
              return (
                <div key={l.id}>
                  <button
                    onClick={() => setExpandedId(expanded ? null : l.id)}
                    className="w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/40"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded shrink-0 ${ACTION_COLOR[l.action] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300'}`}>
                        {l.action}
                      </span>
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300 shrink-0">{l.table_name}</span>
                      <span className="text-xs text-slate-400 dark:text-slate-500 truncate">
                        {l.action === 'update' ? `${changes.length} field(s) changed` : l.record_id}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 text-right shrink-0">
                      <div>{l.profiles?.full_name || l.profiles?.email || 'system'}</div>
                      <div>{format(new Date(l.changed_at), 'dd MMM yyyy, HH:mm')}</div>
                    </div>
                  </button>
                  {expanded && (
                    <div className="px-4 pb-3 bg-slate-50 dark:bg-slate-700/40 text-xs">
                      {l.action === 'update' ? (
                        changes.length === 0 ? (
                          <div className="text-slate-400 dark:text-slate-500 py-2">No field-level changes (only timestamps updated).</div>
                        ) : (
                          <table className="w-full mt-1">
                            <thead>
                              <tr className="text-left text-slate-400 dark:text-slate-500">
                                <th className="py-1 pr-2 font-medium">Field</th>
                                <th className="py-1 pr-2 font-medium">Before</th>
                                <th className="py-1 font-medium">After</th>
                              </tr>
                            </thead>
                            <tbody>
                              {changes.map(([field, before, after]) => (
                                <tr key={field} className="border-t border-slate-200 dark:border-slate-700">
                                  <td className="py-1 pr-2 font-mono text-slate-600 dark:text-slate-400">{field}</td>
                                  <td className="py-1 pr-2 text-red-600">{JSON.stringify(before)}</td>
                                  <td className="py-1 text-emerald-700">{JSON.stringify(after)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )
                      ) : (
                        <pre className="whitespace-pre-wrap text-slate-600 dark:text-slate-400 py-2">
                          {JSON.stringify(l.action === 'delete' ? l.old_value : l.new_value, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {hasMore && !loading && (
          <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-700/60 text-center">
            <button onClick={() => load(logs.length, false)} disabled={loadingMore} className="text-sm text-indigo-600 hover:underline disabled:opacity-50">
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
