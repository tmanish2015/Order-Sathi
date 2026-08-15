import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import { formatINR } from '../lib/format'
import { computeHealth, HEALTH_LABEL, HEALTH_COLOR } from '../lib/health'
import type { Tables, TablesInsert, Enums } from '../lib/database.types'

type Customer = Tables<'customers'>
type Plan = Tables<'plans'>
type Subscription = Tables<'subscriptions'> & { plans: Plan | null }
type CustomerRow = Customer & { subscriptions: Subscription[] }

const CUSTOMER_TYPES: Enums<'customer_type'>[] = ['education', 'healthcare', 'government', 'corporate', 'other']
const CYCLES: Enums<'billing_cycle'>[] = ['monthly', 'quarterly', 'annual']
const CATEGORIES: Enums<'plan_category'>[] = ['erp', 'marketing']

export default function Customers() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [showAddPlan, setShowAddPlan] = useState(false)

  const orgId = profile?.organization_id

  async function load() {
    if (!orgId) return
    setLoading(true)
    const { data } = await supabase
      .from('customers')
      .select('*, subscriptions(*, plans(*))')
      .order('created_at', { ascending: false })
    setCustomers((data as unknown as CustomerRow[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [orgId])

  async function addCustomer(form: FormData) {
    if (!orgId) return
    const payload: TablesInsert<'customers'> = {
      organization_id: orgId,
      company_name: String(form.get('company_name')),
      contact_person: String(form.get('contact_person') || '') || null,
      email: String(form.get('email') || '') || null,
      phone: String(form.get('phone') || '') || null,
      address: String(form.get('address') || '') || null,
      gst_number: String(form.get('gst_number') || '') || null,
      has_lut: form.get('has_lut') === 'on',
      customer_type: form.get('customer_type') as Enums<'customer_type'>,
      created_by: profile?.id,
    }
    const { error } = await supabase.from('customers').insert(payload)
    if (error) {
      reportError(showError, 'Add customer', error, orgId, profile?.id)
      return
    }
    showSuccess('Customer added.')
    setShowAddCustomer(false)
    load()
  }

  async function addPlan(form: FormData) {
    if (!orgId) return
    const payload: TablesInsert<'plans'> = {
      organization_id: orgId,
      name: String(form.get('name')),
      amount: Number(form.get('amount')),
      billing_cycle: form.get('billing_cycle') as Enums<'billing_cycle'>,
      category: form.get('category') as Enums<'plan_category'>,
    }
    const { error } = await supabase.from('plans').insert(payload)
    if (error) {
      reportError(showError, 'Add plan', error, orgId, profile?.id)
      return
    }
    showSuccess('Plan added.')
    setShowAddPlan(false)
  }

  function exportCsv() {
    const rows = [
      ['Company', 'Type', 'Health', 'ERP Plan', 'Marketing Plan', 'Next Due', 'Status'],
      ...customers.map((c) => {
        const erp = c.subscriptions?.find((s) => s.plans?.category === 'erp')
        const mkt = c.subscriptions?.find((s) => s.plans?.category === 'marketing')
        const health = computeHealth(c.subscriptions ?? [])
        return [
          c.company_name,
          c.customer_type,
          HEALTH_LABEL[health],
          erp?.plans ? `${erp.plans.name} (${formatINR(erp.plans.amount)}/${erp.plans.billing_cycle})` : '',
          mkt?.plans ? `${mkt.plans.name} (${formatINR(mkt.plans.amount)}/${mkt.plans.billing_cycle})` : '',
          erp?.next_due_date ?? mkt?.next_due_date ?? '',
          erp?.status ?? mkt?.status ?? '',
        ]
      }),
    ]
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'customers_billing.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const canWrite = profile && ['admin', 'sales', 'finance'].includes(profile.role)

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-slate-900">Customers & Subscriptions</h2>
        <div className="flex gap-2">
          <button onClick={exportCsv} className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
            Export CSV
          </button>
          {canWrite && (
            <>
              <button
                onClick={() => setShowAddPlan(true)}
                className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
              >
                + Plan
              </button>
              <button
                onClick={() => setShowAddCustomer(true)}
                className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700"
              >
                + Customer
              </button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-slate-400 text-sm">Loading…</p>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2">Company</th>
                <th className="text-left px-4 py-2">Type</th>
                <th className="text-left px-4 py-2">ERP</th>
                <th className="text-left px-4 py-2">Marketing</th>
                <th className="text-left px-4 py-2">Health</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const erp = c.subscriptions?.find((s) => s.plans?.category === 'erp')
                const mkt = c.subscriptions?.find((s) => s.plans?.category === 'marketing')
                const health = computeHealth(c.subscriptions ?? [])
                return (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <Link to={`/customers/${c.id}`} className="font-medium text-indigo-700 hover:underline">
                        {c.company_name}
                      </Link>
                      <div className="text-xs text-slate-400">{c.contact_person}</div>
                    </td>
                    <td className="px-4 py-2.5 capitalize text-slate-600">{c.customer_type}</td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {erp?.plans ? `${erp.plans.name} — ${formatINR(erp.plans.amount)}/${erp.plans.billing_cycle}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {mkt?.plans ? `${mkt.plans.name} — ${formatINR(mkt.plans.amount)}/${mkt.plans.billing_cycle}` : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${HEALTH_COLOR[health]}`}>
                        {HEALTH_LABEL[health]}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {customers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    No customers yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showAddCustomer && (
        <Modal onClose={() => setShowAddCustomer(false)} title="Add customer">
          <form action={(fd) => addCustomer(fd)} className="space-y-3">
            <Input name="company_name" label="Company name" required />
            <Input name="contact_person" label="Contact person" />
            <div className="grid grid-cols-2 gap-3">
              <Input name="email" label="Email" type="email" />
              <Input name="phone" label="Phone" />
            </div>
            <Input name="address" label="Address" />
            <div className="grid grid-cols-2 gap-3">
              <Input name="gst_number" label="GST number" />
              <label className="flex items-center gap-2 text-sm text-slate-600 mt-6">
                <input type="checkbox" name="has_lut" className="rounded" /> Has LUT
              </label>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Customer type</label>
              <select name="customer_type" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {CUSTOMER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="w-full rounded-lg bg-indigo-600 text-white py-2 text-sm font-medium hover:bg-indigo-700">
              Save
            </button>
          </form>
        </Modal>
      )}

      {showAddPlan && (
        <Modal onClose={() => setShowAddPlan(false)} title="Add plan">
          <form action={(fd) => addPlan(fd)} className="space-y-3">
            <Input name="name" label="Plan name" required />
            <Input name="amount" label="Amount (INR)" type="number" required />
            <div>
              <label className="text-xs font-medium text-slate-500">Category</label>
              <select name="category" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c === 'erp' ? 'ERP subscription' : 'Marketing subscription'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Billing cycle</label>
              <select name="billing_cycle" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {CYCLES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="w-full rounded-lg bg-indigo-600 text-white py-2 text-sm font-medium hover:bg-indigo-700">
              Save
            </button>
          </form>
        </Modal>
      )}
    </div>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Input({
  name,
  label,
  type = 'text',
  required,
  defaultValue,
}: {
  name: string
  label: string
  type?: string
  required?: boolean
  defaultValue?: string
}) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-500">{label}</label>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>
  )
}
