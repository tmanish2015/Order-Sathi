import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { format, subMonths, subQuarters, subYears, isBefore, addMonths, addQuarters, addYears } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import { formatINR } from '../lib/format'
import { computeHealth, HEALTH_LABEL, HEALTH_COLOR } from '../lib/health'
import { Modal } from './Customers'
import type { Tables } from '../lib/database.types'

type Customer = Tables<'customers'>
type Plan = Tables<'plans'>
type Subscription = Tables<'subscriptions'> & { plans: Plan | null }
type Invoice = Tables<'invoices'>
type Lead = Tables<'leads'>
type Opportunity = Tables<'opportunities'> & { plans: Plan | null }
type Task = Tables<'tasks'> & { assignee: Tables<'profiles'> | null }
type Campaign = Tables<'campaigns'>
type CampaignPost = Tables<'campaign_posts'>

function subStatusBadge(status: Subscription['status']) {
  if (status === 'past_due') return <span className="text-xs font-medium text-red-600">🔴 Overdue</span>
  if (status === 'cancelled') return <span className="text-xs font-medium text-slate-400">Cancelled</span>
  if (status === 'paused') return <span className="text-xs font-medium text-amber-600">Paused</span>
  return <span className="text-xs font-medium text-emerald-600">✅ Active</span>
}

function cyclePeriodStart(cycleEnd: Date, cycle: Plan['billing_cycle']) {
  if (cycle === 'monthly') return subMonths(cycleEnd, 1)
  if (cycle === 'quarterly') return subQuarters(cycleEnd, 1)
  return subYears(cycleEnd, 1)
}

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [subs, setSubs] = useState<Subscription[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [posts, setPosts] = useState<CampaignPost[]>([])
  const [assigning, setAssigning] = useState(false)
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!id) return
    setLoading(true)
    const [{ data: c }, { data: s }, { data: inv }, { data: l }, { data: p }, { data: opp }, { data: tk }, { data: camp }] = await Promise.all([
      supabase.from('customers').select('*').eq('id', id).single(),
      supabase.from('subscriptions').select('*, plans(*)').eq('customer_id', id),
      supabase.from('invoices').select('*').eq('customer_id', id).order('issued_at', { ascending: false }),
      supabase.from('leads').select('*').eq('converted_customer_id', id),
      supabase.from('plans').select('*').eq('active', true),
      supabase.from('opportunities').select('*, plans:suggested_plan_id(*)').eq('customer_id', id),
      supabase.from('tasks').select('*, assignee:assigned_to(*)').eq('customer_id', id),
      supabase.from('campaigns').select('*').eq('customer_id', id),
    ])
    setCustomer(c)
    setSubs((s as unknown as Subscription[]) ?? [])
    setInvoices(inv ?? [])
    setLeads(l ?? [])
    setPlans(p ?? [])
    setOpportunities((opp as unknown as Opportunity[]) ?? [])
    setTasks((tk as unknown as Task[]) ?? [])
    setCampaigns(camp ?? [])
    if (camp && camp.length > 0) {
      const { data: cp } = await supabase.from('campaign_posts').select('*').in('campaign_id', camp.map((x) => x.id))
      setPosts(cp ?? [])
    } else {
      setPosts([])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [id])

  async function assignPlan(planId: string) {
    if (!customer) return
    const plan = plans.find((p) => p.id === planId)
    if (!plan) return
    const start = new Date()
    const due = plan.billing_cycle === 'monthly' ? addMonths(start, 1) : plan.billing_cycle === 'quarterly' ? addQuarters(start, 1) : addYears(start, 1)
    const { error } = await supabase.from('subscriptions').insert({
      organization_id: customer.organization_id,
      customer_id: customer.id,
      plan_id: plan.id,
      start_date: format(start, 'yyyy-MM-dd'),
      next_due_date: format(due, 'yyyy-MM-dd'),
      status: 'active',
    })
    if (error) {
      reportError(showError, 'Assign plan', error, customer.organization_id, profile?.id)
      return
    }
    showSuccess('Plan assigned.')
    setAssigning(false)
    load()
  }

  const canWrite = profile && ['admin', 'sales', 'finance'].includes(profile.role)

  if (loading) return <div className="p-6 text-slate-400 text-sm">Loading…</div>
  if (!customer) return <div className="p-6 text-slate-400 text-sm">Customer not found.</div>

  const health = computeHealth(subs)
  const erpSub = subs.find((s) => s.plans?.category === 'erp')
  const mktSub = subs.find((s) => s.plans?.category === 'marketing')
  const availablePlans = plans.filter((p) => !subs.some((s) => s.plan_id === p.id))

  let delivered = 0
  let periodStart: Date | null = null
  let periodEnd: Date | null = null
  if (mktSub?.plans?.deliverable_qty) {
    periodEnd = mktSub.next_due_date ? new Date(mktSub.next_due_date) : new Date()
    periodStart = cyclePeriodStart(periodEnd, mktSub.plans.billing_cycle)
    delivered = posts.filter(
      (p) => p.status === 'posted' && p.posted_at && !isBefore(new Date(p.posted_at), periodStart!) && isBefore(new Date(p.posted_at), periodEnd!)
    ).length
  }
  const promised = mktSub?.plans?.deliverable_qty ?? 0
  const deliveryPct = promised ? Math.min(100, Math.round((delivered / promised) * 100)) : 0

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <Link to="/customers" className="text-xs text-indigo-600 hover:underline">
        ← All customers
      </Link>

      <div className="flex items-start justify-between mt-2 mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">{customer.company_name}</h2>
          <p className="text-sm text-slate-500">
            {customer.contact_person} · {customer.email} · {customer.phone}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {customer.customer_type} {customer.gst_number ? `· GST ${customer.gst_number}` : ''}{' '}
            {customer.has_lut ? '· LUT' : ''}
          </p>
        </div>
        <span className={`text-sm font-medium px-2 py-1 rounded ${HEALTH_COLOR[health]}`}>{HEALTH_LABEL[health]}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase text-slate-500">ERP subscription</h3>
          </div>
          {erpSub ? (
            <div>
              <div className="font-medium text-slate-900">{erpSub.plans?.name}</div>
              <div className="text-sm text-slate-500">
                {erpSub.plans && formatINR(erpSub.plans.amount)} / {erpSub.plans?.billing_cycle}
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-slate-400">Next due {erpSub.next_due_date}</span>
                {subStatusBadge(erpSub.status)}
              </div>
              {erpSub.failed_charge_count > 0 && (
                <p className="text-xs text-red-500 mt-1">{erpSub.failed_charge_count} failed charge(s)</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Not subscribed.</p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">Marketing subscription</h3>
          {mktSub ? (
            <div>
              <div className="font-medium text-slate-900">{mktSub.plans?.name}</div>
              <div className="text-sm text-slate-500">
                {mktSub.plans && formatINR(mktSub.plans.amount)} / {mktSub.plans?.billing_cycle}
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-slate-400">Next due {mktSub.next_due_date}</span>
                {subStatusBadge(mktSub.status)}
              </div>
              {mktSub.failed_charge_count > 0 && (
                <p className="text-xs text-red-500 mt-1">{mktSub.failed_charge_count} failed charge(s)</p>
              )}
              {promised > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                    <span>
                      Delivery this cycle: {delivered}/{promised} {mktSub.plans?.deliverable_unit}
                    </span>
                    <span>{deliveryPct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${deliveryPct >= 80 ? 'bg-emerald-500' : deliveryPct >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${deliveryPct}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Not subscribed.</p>
          )}
        </div>
      </div>

      {canWrite && availablePlans.length > 0 && (
        <button
          onClick={() => setAssigning(true)}
          className="mb-6 text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700"
        >
          + Assign plan
        </button>
      )}

      <h3 className="text-sm font-semibold text-slate-700 mb-2">Invoice history</h3>
      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 mb-6">
        {invoices.map((inv) => (
          <div key={inv.id} className="px-4 py-2.5 flex items-center justify-between text-sm">
            <span className="text-slate-600">{format(new Date(inv.issued_at), 'dd MMM yyyy')}</span>
            <span className="font-medium">{formatINR(inv.amount)}</span>
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                inv.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : inv.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {inv.status}
            </span>
          </div>
        ))}
        {invoices.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">No invoices yet.</p>}
      </div>

      {leads.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Originating lead</h3>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 mb-6">
            {leads.map((l) => (
              <div key={l.id} className="px-4 py-2.5 text-sm flex items-center justify-between">
                <span className="text-slate-600">{l.name}</span>
                <span className="text-xs text-slate-400">
                  source: {l.source} · converted {format(new Date(l.created_at), 'dd MMM yyyy')}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {campaigns.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Marketing campaigns</h3>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 mb-6">
            {campaigns.map((c) => (
              <div key={c.id} className="px-4 py-2.5 text-sm flex items-center justify-between">
                <span className="text-slate-700">{c.name}</span>
                <span className="text-xs text-slate-400">{c.objective}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{c.status}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {opportunities.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Upsell / cross-sell opportunities</h3>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 mb-6">
            {opportunities.map((o) => (
              <div key={o.id} className="px-4 py-2.5 text-sm flex items-center justify-between">
                <span className="text-slate-700">
                  {o.type.replace('_', '-')}: {o.plans?.name}
                </span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">{o.status}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {tasks.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Tasks</h3>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 mb-6">
            {tasks.map((t) => (
              <div key={t.id} className="px-4 py-2.5 text-sm flex items-center justify-between">
                <span className="text-slate-700">{t.title}</span>
                <span className="text-xs text-slate-400">{t.assignee?.full_name ?? 'Unassigned'}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{t.status.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {assigning && (
        <Modal onClose={() => setAssigning(false)} title="Assign subscription plan">
          <div className="space-y-2">
            {availablePlans.map((p) => (
              <button
                key={p.id}
                onClick={() => assignPlan(p.id)}
                className="w-full text-left rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
              >
                <span className="text-[10px] uppercase text-slate-400 mr-2">{p.category}</span>
                <span className="font-medium">{p.name}</span> — {formatINR(p.amount)} / {p.billing_cycle}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}
