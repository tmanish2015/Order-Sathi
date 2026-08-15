import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { formatINR } from '../lib/format'
import type { Tables, Enums } from '../lib/database.types'

type Customer = Tables<'customers'>
type Invoice = Tables<'invoices'> & { customers: Customer | null }

type Filter = 'all' | Enums<'invoice_status'>

export default function Billing() {
  const { profile } = useAuth()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const orgId = profile?.organization_id

  useEffect(() => {
    if (!orgId) return
    supabase
      .from('invoices')
      .select('*, customers(*)')
      .order('issued_at', { ascending: false })
      .then(({ data }) => setInvoices((data as unknown as Invoice[]) ?? []))
  }, [orgId])

  const rows = filter === 'all' ? invoices : invoices.filter((i) => i.status === filter)
  const totalPaid = invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount, 0)
  const totalFailed = invoices.filter((i) => i.status === 'failed').reduce((s, i) => s + i.amount, 0)
  const totalPending = invoices.filter((i) => i.status === 'pending').reduce((s, i) => s + i.amount, 0)

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'paid', label: 'Paid' },
    { key: 'pending', label: 'Pending' },
    { key: 'failed', label: 'Failed' },
  ]

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Payment Status</h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="text-xs text-slate-400">Collected</div>
          <div className="text-xl font-semibold text-emerald-600 mt-1">{formatINR(totalPaid)}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="text-xs text-slate-400">Pending</div>
          <div className="text-xl font-semibold text-slate-900 mt-1">{formatINR(totalPending)}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="text-xs text-slate-400">Failed</div>
          <div className="text-xl font-semibold text-red-600 mt-1">{formatINR(totalFailed)}</div>
        </div>
      </div>

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
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2">Customer</th>
              <th className="text-left px-4 py-2">Date</th>
              <th className="text-left px-4 py-2">Amount</th>
              <th className="text-left px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((inv) => (
              <tr key={inv.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5">
                  <Link to={`/customers/${inv.customer_id}`} className="text-indigo-700 hover:underline font-medium">
                    {inv.customers?.company_name}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-slate-600">{format(new Date(inv.issued_at), 'dd MMM yyyy')}</td>
                <td className="px-4 py-2.5 font-medium text-slate-900">{formatINR(inv.amount)}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                      inv.status === 'paid'
                        ? 'bg-emerald-100 text-emerald-700'
                        : inv.status === 'failed'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {inv.status}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                  No invoices in this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
