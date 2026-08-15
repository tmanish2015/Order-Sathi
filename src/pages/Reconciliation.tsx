import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { formatINR } from '../lib/format'
import type { Tables } from '../lib/database.types'

type Entry = Tables<'reconciliation_entries'> & { orders: Tables<'orders'> | null }

const STATUS_COLOR: Record<Entry['status'], string> = {
  matched: 'bg-emerald-100 text-emerald-700',
  mismatch: 'bg-red-100 text-red-700',
  pending_review: 'bg-amber-100 text-amber-700',
}

export default function Reconciliation() {
  const { profile } = useAuth()
  const [entries, setEntries] = useState<Entry[]>([])
  const orgId = profile?.organization_id

  useEffect(() => {
    if (!orgId) return
    ;(async () => {
      const { data } = await supabase.from('reconciliation_entries').select('*, orders(*)').order('created_at', { ascending: false })
      setEntries((data as unknown as Entry[]) ?? [])
    })()
  }, [orgId])

  const mismatches = entries.filter((e) => e.status === 'mismatch')

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">MTR Reconciliation</h2>
      <p className="text-xs text-slate-400 mb-6">
        Gross sales feed the revenue ledger. Actual settlement is tracked separately — the two never get merged directly. Any mismatch is flagged for manual review, never silently accepted.
      </p>

      {mismatches.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-800">
          {mismatches.length} order{mismatches.length > 1 ? 's' : ''} with a settlement mismatch — needs manual review.
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {entries.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">No MTR file imported yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-2 font-medium">Order</th>
                  <th className="px-4 py-2 font-medium text-right">Gross sales</th>
                  <th className="px-4 py-2 font-medium text-right">Commission</th>
                  <th className="px-4 py-2 font-medium text-right">TCS</th>
                  <th className="px-4 py-2 font-medium text-right">TDS 194O</th>
                  <th className="px-4 py-2 font-medium text-right">Expected settle</th>
                  <th className="px-4 py-2 font-medium text-right">Actual settle</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-2.5 font-medium text-slate-700">{e.orders?.amazon_order_id ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700">{formatINR(Number(e.gross_sales))}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{formatINR(Number(e.commission))}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">
                      {formatINR(Number(e.tcs_cgst) + Number(e.tcs_sgst) + Number(e.tcs_igst))}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{formatINR(Number(e.tds_194o))}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{formatINR(Number(e.expected_settlement))}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">
                      {e.actual_settlement != null ? formatINR(Number(e.actual_settlement)) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${STATUS_COLOR[e.status]}`}>
                        {e.status.replace('_', ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
