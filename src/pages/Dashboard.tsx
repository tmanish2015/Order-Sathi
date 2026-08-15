import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, isWithinInterval, startOfWeek, endOfWeek, isBefore, format } from 'date-fns'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { formatINR } from '../lib/format'
import { computeHealth } from '../lib/health'
import type { Tables } from '../lib/database.types'

type Subscription = Tables<'subscriptions'> & { plans: Tables<'plans'> | null; customers: Tables<'customers'> | null }
type CampaignPost = Tables<'campaign_posts'>
type Lead = Tables<'leads'>
type Invoice = Tables<'invoices'>

function monthlyAmount(plan: Tables<'plans'> | null) {
  if (!plan) return 0
  if (plan.billing_cycle === 'monthly') return plan.amount
  if (plan.billing_cycle === 'quarterly') return plan.amount / 3
  return plan.amount / 12
}

export default function Dashboard() {
  const { profile } = useAuth()
  const [subs, setSubs] = useState<Subscription[]>([])
  const [posts, setPosts] = useState<CampaignPost[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const orgId = profile?.organization_id

  useEffect(() => {
    if (!orgId) return
    ;(async () => {
      const [{ data: s }, { data: p }, { data: l }, { data: inv }] = await Promise.all([
        supabase.from('subscriptions').select('*, plans(*), customers(*)'),
        supabase.from('campaign_posts').select('*'),
        supabase.from('leads').select('*'),
        supabase.from('invoices').select('*').eq('status', 'paid'),
      ])
      setSubs((s as unknown as Subscription[]) ?? [])
      setPosts(p ?? [])
      setLeads(l ?? [])
      setInvoices(inv ?? [])
    })()
  }, [orgId])

  const active = subs.filter((s) => s.status === 'active')
  const erpActive = active.filter((s) => s.plans?.category === 'erp')
  const mktActive = active.filter((s) => s.plans?.category === 'marketing')
  const erpMrr = erpActive.reduce((sum, s) => sum + monthlyAmount(s.plans), 0)
  const mktMrr = mktActive.reduce((sum, s) => sum + monthlyAmount(s.plans), 0)
  const mrr = erpMrr + mktMrr
  const arr = mrr * 12

  const now = new Date()
  const overdue = subs.filter((s) => s.status === 'past_due')
  const dueSoon7 = active.filter((s) => s.next_due_date && isWithinInterval(new Date(s.next_due_date), { start: now, end: addDays(now, 7) }))
  const dueSoon30 = active.filter((s) => s.next_due_date && isWithinInterval(new Date(s.next_due_date), { start: now, end: addDays(now, 30) }))
  const churnedThisMonth = subs.filter((s) => s.status === 'cancelled')

  const weekStart = startOfWeek(now)
  const weekEnd = endOfWeek(now)
  const campaignsThisWeek = posts.filter((p) => isWithinInterval(new Date(p.scheduled_at), { start: weekStart, end: weekEnd }))
  const newLeadsThisWeek = leads.filter((l) => isWithinInterval(new Date(l.created_at), { start: weekStart, end: weekEnd }))
  const wonLeads = leads.filter((l) => l.status === 'won')
  const conversionRate = leads.length ? Math.round((wonLeads.length / leads.length) * 100) : 0
  const staleLeads = leads.filter(
    (l) => !['won', 'lost'].includes(l.status) && isBefore(new Date(l.created_at), addDays(now, -2))
  )

  const byCustomer = new Map<string, Subscription[]>()
  for (const s of subs) {
    if (!byCustomer.has(s.customer_id)) byCustomer.set(s.customer_id, [])
    byCustomer.get(s.customer_id)!.push(s)
  }
  const healthCounts = { healthy: 0, watch: 0, at_risk: 0, no_subscription: 0 }
  for (const custSubs of byCustomer.values()) {
    healthCounts[computeHealth(custSubs)]++
  }

  const revenueByMonth = new Map<string, number>()
  for (const inv of invoices) {
    const key = format(new Date(inv.issued_at), 'MMM yyyy')
    revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + inv.amount)
  }
  const revenueTrend = Array.from(revenueByMonth.entries())
    .map(([month, amount]) => ({ month, amount }))
    .sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime())

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Executive Command Dashboard</h2>
          <p className="text-xs text-slate-400 mt-0.5">{format(now, 'EEEE, dd MMMM yyyy')}</p>
        </div>
        <Link
          to="/attention"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          ⚡ What needs my attention
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
        <Stat label="MRR" value={formatINR(mrr)} sub={`ERP ${formatINR(erpMrr)} · Marketing ${formatINR(mktMrr)}`} accent="indigo" />
        <Stat label="ARR" value={formatINR(arr)} accent="purple" />
        <Stat label="Renewals (7d)" value={String(dueSoon7.length)} accent="amber" />
        <Stat label="Overdue accounts" value={String(overdue.length)} tone={overdue.length ? 'red' : undefined} accent="red" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <Stat label="Renewals (30d)" value={String(dueSoon30.length)} />
        <Stat label="Churn this month" value={String(churnedThisMonth.length)} />
        <Stat label="Campaigns this week" value={String(campaignsThisWeek.length)} />
        <Stat label="New leads this week" value={String(newLeadsThisWeek.length)} />
      </div>

      {revenueTrend.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6">
          <div className="text-xs font-semibold uppercase text-slate-500 mb-3">Collected revenue trend</div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueTrend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => formatINR(Number(v))} cursor={{ fill: '#f8fafc' }} />
                <Bar dataKey="amount" fill="#6366f1" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-8">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="text-xs text-slate-400 mb-2">Customer health</div>
          <div className="flex flex-wrap gap-3 sm:gap-4 text-sm">
            <span className="text-emerald-600 font-medium">🟢 {healthCounts.healthy} healthy</span>
            <span className="text-amber-600 font-medium">🟡 {healthCounts.watch} watch</span>
            <span className="text-red-600 font-medium">🔴 {healthCounts.at_risk} at risk</span>
          </div>
        </div>
        <Stat label="Lead → customer conversion" value={`${conversionRate}%`} />
      </div>

      <h3 className="text-sm font-semibold text-slate-700 mb-3">Needs attention</h3>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
        {overdue.map((s) => (
          <Action key={s.id} priority="P0" text={`Overdue payment — ${s.customers?.company_name ?? 'Unknown'}`} />
        ))}
        {dueSoon7.map((s) => (
          <Action key={s.id} priority="P1" text={`Renewal due within 7 days — ${s.customers?.company_name ?? 'Unknown'}`} />
        ))}
        {staleLeads.map((l) => (
          <Action key={l.id} priority="P2" text={`Lead uncontacted > 48h — ${l.name} (${l.company ?? 'no company'})`} />
        ))}
        {overdue.length + dueSoon7.length + staleLeads.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-slate-400">Nothing needs attention right now.</p>
        )}
      </div>
    </div>
  )
}

const ACCENTS = {
  indigo: 'from-indigo-500 to-indigo-600',
  purple: 'from-purple-500 to-purple-600',
  amber: 'from-amber-500 to-amber-600',
  red: 'from-red-500 to-red-600',
} as const

function Stat({
  label,
  value,
  sub,
  tone,
  accent,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'red'
  accent?: keyof typeof ACCENTS
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5 sm:p-4 relative overflow-hidden">
      {accent && <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${ACCENTS[accent]}`} />}
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-lg sm:text-xl font-semibold mt-1 ${tone === 'red' ? 'text-red-600' : 'text-slate-900'}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5 truncate">{sub}</div>}
    </div>
  )
}

function Action({ priority, text }: { priority: 'P0' | 'P1' | 'P2'; text: string }) {
  const color = priority === 'P0' ? 'bg-red-100 text-red-700' : priority === 'P1' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
  return (
    <div className="px-4 py-2.5 flex items-center gap-3 text-sm">
      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${color}`}>{priority}</span>
      <span className="text-slate-700">{text}</span>
    </div>
  )
}
