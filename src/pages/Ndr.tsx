import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables } from '../lib/database.types'

type NdrRecord = Tables<'ndr_records'> & { orders: Tables<'orders'> | null }

const CONTACT_STATUS = ['not_contacted', 'contacted', 'unreachable']

const OUTCOME_COLOR: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  rto: 'bg-red-100 text-red-700',
}

export default function Ndr() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [records, setRecords] = useState<NdrRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)

  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const { data } = await supabase.from('ndr_records').select('*, orders(*)').order('ndr_date', { ascending: false })
    setRecords((data as unknown as NdrRecord[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  async function save(r: NdrRecord, patch: Partial<Tables<'ndr_records'>>) {
    setSavingId(r.id)
    const { error } = await supabase.from('ndr_records').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', r.id)
    setSavingId(null)
    if (error) {
      reportError(showError, 'Update NDR record', error, orgId, profile?.id)
      return
    }
    load()
  }

  async function resolve(r: NdrRecord, outcome: 'delivered' | 'rto') {
    await save(r, { outcome, action_taken: r.action_taken ?? 'resolved' })
    if (r.shipment_id) {
      await supabase.from('shipments').update({ status: outcome }).eq('id', r.shipment_id)
      await supabase.from('shipment_tracking_events').insert({ organization_id: orgId!, shipment_id: r.shipment_id, status: outcome, remarks: `Resolved from NDR` })
    }
    await supabase.from('orders').update({ order_status: outcome }).eq('id', r.order_id)
    showSuccess(`NDR resolved as ${outcome}.`)
  }

  const visible = records.filter((r) => showResolved || !r.outcome || r.outcome === 'pending')

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold text-slate-900">NDR — Non-Delivery Reports</h2>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          Show resolved
        </label>
      </div>
      <p className="text-xs text-slate-400 mb-6">
        A shipment marked NDR here creates a record automatically. Track contact attempts, then resolve to either
        Delivered (redelivery succeeded) or RTO (returning to origin).
      </p>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <Skeleton />
        ) : visible.length === 0 ? (
          <EmptyState icon="✅" title="No open NDRs." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-2 font-medium">Order</th>
                  <th className="px-4 py-2 font-medium">AWB</th>
                  <th className="px-4 py-2 font-medium">NDR date</th>
                  <th className="px-4 py-2 font-medium">Attempt</th>
                  <th className="px-4 py-2 font-medium">Reason</th>
                  <th className="px-4 py-2 font-medium">Contact status</th>
                  <th className="px-4 py-2 font-medium">Next attempt</th>
                  <th className="px-4 py-2 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5 font-medium text-slate-700">{r.orders?.amazon_order_id ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500">{r.awb_number}</td>
                    <td className="px-4 py-2.5 text-slate-500">{format(new Date(r.ndr_date), 'dd MMM yyyy')}</td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {canEdit ? (
                        <input
                          type="number"
                          min={1}
                          value={r.attempt_number}
                          onChange={(e) => save(r, { attempt_number: Number(e.target.value) })}
                          disabled={savingId === r.id}
                          className="w-14 text-sm rounded border border-slate-300 px-1.5 py-1"
                        />
                      ) : (
                        r.attempt_number
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {canEdit ? (
                        <input
                          type="text"
                          defaultValue={r.reason ?? ''}
                          onBlur={(e) => e.target.value !== (r.reason ?? '') && save(r, { reason: e.target.value || null })}
                          disabled={savingId === r.id}
                          className="w-32 text-sm rounded border border-slate-300 px-1.5 py-1"
                        />
                      ) : (
                        r.reason ?? '—'
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {canEdit ? (
                        <select
                          value={r.contact_status ?? 'not_contacted'}
                          onChange={(e) => save(r, { contact_status: e.target.value })}
                          disabled={savingId === r.id}
                          className="text-xs rounded border border-slate-300 px-1.5 py-1"
                        >
                          {CONTACT_STATUS.map((s) => (
                            <option key={s} value={s}>
                              {s.replace('_', ' ')}
                            </option>
                          ))}
                        </select>
                      ) : (
                        r.contact_status ?? '—'
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {canEdit ? (
                        <input
                          type="date"
                          defaultValue={r.next_attempt_date ?? ''}
                          onBlur={(e) => e.target.value !== (r.next_attempt_date ?? '') && save(r, { next_attempt_date: e.target.value || null })}
                          disabled={savingId === r.id}
                          className="text-sm rounded border border-slate-300 px-1.5 py-1"
                        />
                      ) : (
                        r.next_attempt_date ?? '—'
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {(!r.outcome || r.outcome === 'pending') && canEdit ? (
                        <div className="flex gap-1.5">
                          <button onClick={() => resolve(r, 'delivered')} disabled={savingId === r.id} className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200">
                            Delivered
                          </button>
                          <button onClick={() => resolve(r, 'rto')} disabled={savingId === r.id} className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-red-100 text-red-700 hover:bg-red-200">
                            RTO
                          </button>
                        </div>
                      ) : (
                        <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${OUTCOME_COLOR[r.outcome ?? 'pending']}`}>{r.outcome ?? 'pending'}</span>
                      )}
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
