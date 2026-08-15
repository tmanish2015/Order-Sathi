import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, isBefore, isWithinInterval, differenceInHours, startOfDay } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import type { Tables } from '../lib/database.types'

type Plan = Tables<'plans'>
type Customer = Tables<'customers'>
type Subscription = Tables<'subscriptions'> & { plans: Plan | null; customers: Customer | null }
type Lead = Tables<'leads'>
type Opportunity = Tables<'opportunities'> & { customers: Customer | null }
type Task = Tables<'tasks'> & { customers: Customer | null; assignee: Tables<'profiles'> | null }

type Priority = 'P0' | 'P1' | 'P2'
interface Item {
  id: string
  priority: Priority
  category: string
  text: string
  link?: string
}

export default function Attention() {
  const { profile } = useAuth()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const orgId = profile?.organization_id

  useEffect(() => {
    if (!orgId) return
    ;(async () => {
      setLoading(true)
      const [{ data: subs }, { data: leads }, { data: opps }, { data: tasks }] = await Promise.all([
        supabase.from('subscriptions').select('*, plans(*), customers(*)'),
        supabase.from('leads').select('*'),
        supabase.from('opportunities').select('*, customers(*)'),
        supabase.from('tasks').select('*, customers(*), assignee:assigned_to(*)').neq('status', 'done'),
      ])
      setItems(buildFeed((subs as unknown as Subscription[]) ?? [], leads ?? [], (opps as unknown as Opportunity[]) ?? [], (tasks as unknown as Task[]) ?? []))
      setLoading(false)
    })()
  }, [orgId])

  const groups: Record<Priority, Item[]> = { P0: [], P1: [], P2: [] }
  for (const item of items) groups[item.priority].push(item)

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">What needs my attention</h2>
      <p className="text-xs text-slate-400 mb-6">
        Rule-based prioritization across billing, renewals, delivery, leads and tasks — no external AI service required.
      </p>

      {loading ? (
        <p className="text-slate-400 text-sm">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing needs attention right now.</p>
      ) : (
        (['P0', 'P1', 'P2'] as Priority[]).map(
          (p) =>
            groups[p].length > 0 && (
              <div key={p} className="mb-6">
                <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">
                  {p} — {p === 'P0' ? 'Act today' : p === 'P1' ? 'This week' : 'When you get to it'}
                </h3>
                <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
                  {groups[p].map((item) => (
                    <div key={item.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          p === 'P0' ? 'bg-red-100 text-red-700' : p === 'P1' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {item.category}
                      </span>
                      {item.link ? (
                        <Link to={item.link} className="text-slate-700 hover:underline">
                          {item.text}
                        </Link>
                      ) : (
                        <span className="text-slate-700">{item.text}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
        )
      )}
    </div>
  )
}

function buildFeed(subs: Subscription[], leads: Lead[], opportunities: Opportunity[], tasks: Task[]): Item[] {
  const now = new Date()
  const items: Item[] = []

  for (const s of subs) {
    if (s.status === 'past_due') {
      items.push({
        id: `sub-overdue-${s.id}`,
        priority: 'P0',
        category: 'Billing',
        text: `Overdue payment — ${s.customers?.company_name ?? 'Unknown'} (${s.failed_charge_count} failed charge${s.failed_charge_count === 1 ? '' : 's'})`,
        link: `/customers/${s.customer_id}`,
      })
    }
    if (s.status === 'active' && s.next_due_date && isWithinInterval(new Date(s.next_due_date), { start: now, end: addDays(now, 7) })) {
      items.push({
        id: `sub-due-${s.id}`,
        priority: 'P1',
        category: 'Renewal',
        text: `Renewal due within 7 days — ${s.customers?.company_name ?? 'Unknown'} (${s.plans?.name})`,
        link: `/customers/${s.customer_id}`,
      })
    }
  }

  for (const t of tasks) {
    if (t.due_date && isBefore(new Date(t.due_date), startOfDay(now))) {
      items.push({
        id: `task-overdue-${t.id}`,
        priority: t.priority === 'P0' ? 'P0' : 'P1',
        category: 'Task',
        text: `Overdue task — "${t.title}"${t.customers ? ` (${t.customers.company_name})` : ''} assigned to ${t.assignee?.full_name ?? 'unassigned'}`,
        link: t.customer_id ? `/customers/${t.customer_id}` : '/tasks',
      })
    }
  }

  for (const l of leads) {
    if (!['won', 'lost'].includes(l.status) && differenceInHours(now, new Date(l.created_at)) > 48) {
      items.push({
        id: `lead-stale-${l.id}`,
        priority: 'P2',
        category: 'Lead',
        text: `Lead uncontacted > 48h — ${l.name} (${l.company ?? 'no company'})`,
        link: '/leads',
      })
    }
  }

  for (const o of opportunities) {
    if (o.status === 'identified') {
      items.push({
        id: `opp-${o.id}`,
        priority: 'P2',
        category: 'Opportunity',
        text: `${o.type.replace('_', '-')} opportunity not yet contacted — ${o.customers?.company_name ?? 'Unknown'}`,
        link: '/opportunities',
      })
    }
  }

  const order: Record<Priority, number> = { P0: 0, P1: 1, P2: 2 }
  return items.sort((a, b) => order[a.priority] - order[b.priority])
}
