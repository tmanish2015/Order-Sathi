import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { differenceInDays, format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { formatINR } from '../lib/format'
import type { Tables } from '../lib/database.types'

type Plan = Tables<'plans'>
type Customer = Tables<'customers'>
type Subscription = Tables<'subscriptions'> & { plans: Plan | null; customers: Customer | null }

type Filter = 'all' | 'overdue' | 'due_7' | 'due_30'

export default function Renewals() {
  const { profile } = useAuth()
  const [subs, setSubs] = useState<Subscription[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const orgId = profile?.organization_id

  useEffect(() => {
    if (!orgId) return
    supabase
      .from('subscriptions')
      .select('*, plans(*), customers(*)')
      .in('status', ['active', 'past_due'])
      .order('next_due_date', { ascending: true })
      .then(({ data }) => setSubs((data as unknown as Subscription[]) ?? []))
  }, [orgId])

  const rows = subs.filter((s) => {
    if (filter === 'all') return true
    if (filter === 'overdue') return s.status === 'past_due'
    if (!s.next_due_date) return false
    const days = differenceInDays(new Date(s.next_due_date), new Date())
    if (filter === 'due_7') return days >= 0 && days <= 7
    if (filter === 'due_30') return days >= 0 && days <= 30
    return true
  })

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All active' },
    { key: 'overdue', label: 'Overdue' },
    { key: 'due_7', label: 'Due in 7 days' },
    { key: 'due_30', label: 'Due in 30 days' },
  ]

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Renewal Tracking</h2>

      <div className="flex gap-2 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs rounded-full px-3 py-1.5 border ${
              filter === f.key ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2">Customer</th>
              <th className="text-left px-4 py-2">Category</th>
              <th className="text-left px-4 py-2">Plan</th>
              <th className="text-left px-4 py-2">Amount</th>
              <th className="text-left px-4 py-2">Next due</th>
              <th className="text-left px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const days = s.next_due_date ? differenceInDays(new Date(s.next_due_date), new Date()) : null
              return (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-4 py-2.5">
                    <Link to={`/customers/${s.customer_id}`} className="text-indigo-700 hover:underline font-medium">
                      {s.customers?.company_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 uppercase text-xs text-slate-500">{s.plans?.category}</td>
                  <td className="px-4 py-2.5 text-slate-600">{s.plans?.name}</td>
                  <td className="px-4 py-2.5 text-slate-600">{s.plans && formatINR(s.plans.amount)}</td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {s.next_due_date ? format(new Date(s.next_due_date), 'dd MMM yyyy') : '—'}
                    {days !== null && days <= 7 && days >= 0 && <span className="text-amber-600 text-xs ml-1">({days}d)</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {s.status === 'past_due' ? (
                      <span className="text-xs font-medium text-red-600">🔴 Overdue</span>
                    ) : (
                      <span className="text-xs font-medium text-emerald-600">✅ Active</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No renewals in this window.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
