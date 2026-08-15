import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import { formatINR } from '../lib/format'
import type { Tables, TablesInsert, Enums } from '../lib/database.types'

type Customer = Tables<'customers'>
type Plan = Tables<'plans'>
type Subscription = Tables<'subscriptions'> & { plans: Plan | null }
type CustomerRow = Customer & { subscriptions: Subscription[] }
type Opportunity = Tables<'opportunities'> & { customers: Customer | null; plans: Plan | null }

const STATUSES: Enums<'opportunity_status'>[] = ['identified', 'contacted', 'proposed', 'won', 'dismissed']

export default function Opportunities() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const orgId = profile?.organization_id

  async function load() {
    if (!orgId) return
    const [{ data: o }, { data: c }, { data: p }] = await Promise.all([
      supabase.from('opportunities').select('*, customers(*), plans:suggested_plan_id(*)').order('created_at', { ascending: false }),
      supabase.from('customers').select('*, subscriptions(*, plans(*))'),
      supabase.from('plans').select('*').eq('active', true),
    ])
    setOpportunities((o as unknown as Opportunity[]) ?? [])
    setCustomers((c as unknown as CustomerRow[]) ?? [])
    setPlans(p ?? [])
  }

  useEffect(() => {
    load()
  }, [orgId])

  async function updateStatus(id: string, status: Enums<'opportunity_status'>) {
    const { error } = await supabase.from('opportunities').update({ status }).eq('id', id)
    if (error) {
      reportError(showError, 'Update opportunity status', error, orgId, profile?.id)
      return
    }
    load()
  }

  async function createOpportunity(customerId: string, type: Enums<'opportunity_type'>, planId: string) {
    if (!orgId) return
    const payload: TablesInsert<'opportunities'> = {
      organization_id: orgId,
      customer_id: customerId,
      type,
      suggested_plan_id: planId,
      status: 'identified',
      created_by: profile?.id,
    }
    const { error } = await supabase.from('opportunities').insert(payload)
    if (error) {
      reportError(showError, 'Create opportunity', error, orgId, profile?.id)
      return
    }
    showSuccess('Opportunity created.')
    load()
  }

  const canWrite = profile && ['admin', 'sales', 'marketing'].includes(profile.role)

  // Auto-detect: customers missing one category, without an open (non-dismissed/won) opportunity of that type already.
  const openCustomerIds = new Set(opportunities.filter((o) => !['won', 'dismissed'].includes(o.status)).map((o) => o.customer_id))
  const suggestions = customers
    .filter((c) => !openCustomerIds.has(c.id))
    .map((c) => {
      const hasErp = c.subscriptions?.some((s) => s.plans?.category === 'erp' && s.status !== 'cancelled')
      const hasMkt = c.subscriptions?.some((s) => s.plans?.category === 'marketing' && s.status !== 'cancelled')
      if (hasErp && !hasMkt) return { customer: c, type: 'cross_sell' as const, category: 'marketing' as const }
      if (hasMkt && !hasErp) return { customer: c, type: 'upsell' as const, category: 'erp' as const }
      return null
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)

  const erpPlan = plans.find((p) => p.category === 'erp')
  const mktPlan = plans.find((p) => p.category === 'marketing')

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Upsell & Cross-sell Opportunities</h2>

      {canWrite && suggestions.length > 0 && (
        <div className="bg-indigo-50 rounded-xl border border-indigo-200 p-4 mb-6">
          <h3 className="text-xs font-semibold uppercase text-indigo-700 mb-2">Auto-detected suggestions</h3>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => {
              const plan = s.category === 'erp' ? erpPlan : mktPlan
              return (
                <button
                  key={s.customer.id}
                  onClick={() => plan && createOpportunity(s.customer.id, s.type, plan.id)}
                  disabled={!plan}
                  className="text-xs rounded-lg bg-white border border-indigo-300 px-3 py-1.5 hover:bg-indigo-100 disabled:opacity-50"
                >
                  {s.customer.company_name} — suggest {s.category.toUpperCase()} ({s.type.replace('_', '-')})
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="overflow-x-auto pb-2">
      <div className="grid grid-cols-5 gap-3 min-w-[760px] sm:min-w-0">
        {STATUSES.map((status) => (
          <div key={status} className="bg-slate-100 rounded-xl p-2 min-h-[200px]">
            <h3 className="text-xs font-semibold uppercase text-slate-500 px-1 py-1">
              {status} ({opportunities.filter((o) => o.status === status).length})
            </h3>
            <div className="space-y-2 mt-1">
              {opportunities
                .filter((o) => o.status === status)
                .map((o) => (
                  <div key={o.id} className="bg-white rounded-lg border border-slate-200 p-2.5 text-xs">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        o.type === 'upsell' ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700'
                      }`}
                    >
                      {o.type.replace('_', '-')}
                    </span>
                    <Link to={`/customers/${o.customer_id}`} className="block font-medium text-slate-900 mt-1 hover:underline">
                      {o.customers?.company_name}
                    </Link>
                    {o.plans && (
                      <div className="text-slate-500 mt-0.5">
                        {o.plans.name} · {formatINR(o.plans.amount)}
                      </div>
                    )}
                    {o.notes && <p className="text-slate-400 mt-1">{o.notes}</p>}
                    {canWrite && status !== 'won' && status !== 'dismissed' && (
                      <select
                        value={o.status}
                        onChange={(e) => updateStatus(o.id, e.target.value as Enums<'opportunity_status'>)}
                        className="text-[10px] rounded border border-slate-200 px-1 py-0.5 mt-2"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
      </div>
    </div>
  )
}
