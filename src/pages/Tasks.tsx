import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { isBefore, startOfDay } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import type { Tables, TablesInsert, Enums } from '../lib/database.types'

type Profile = Tables<'profiles'>
type Customer = Tables<'customers'>
type Task = Tables<'tasks'> & { customers: Customer | null; assignee: Profile | null }

const STATUSES: Enums<'task_status'>[] = ['todo', 'in_progress', 'done']
const PRIORITIES: Enums<'task_priority'>[] = ['P0', 'P1', 'P2']

const PRIORITY_COLOR: Record<Enums<'task_priority'>, string> = {
  P0: 'bg-red-100 text-red-700',
  P1: 'bg-amber-100 text-amber-700',
  P2: 'bg-slate-100 text-slate-600',
}

export default function Tasks() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [tasks, setTasks] = useState<Task[]>([])
  const [team, setTeam] = useState<Profile[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [myOnly, setMyOnly] = useState(false)
  const orgId = profile?.organization_id

  async function load() {
    if (!orgId) return
    const [{ data: t }, { data: p }, { data: c }] = await Promise.all([
      supabase.from('tasks').select('*, customers(*), assignee:assigned_to(*)').order('due_date', { ascending: true }),
      supabase.from('profiles').select('*'),
      supabase.from('customers').select('*'),
    ])
    setTasks((t as unknown as Task[]) ?? [])
    setTeam(p ?? [])
    setCustomers(c ?? [])
  }

  useEffect(() => {
    load()
  }, [orgId])

  async function addTask(form: FormData) {
    if (!orgId) return
    const customerId = String(form.get('customer_id') || '')
    const payload: TablesInsert<'tasks'> = {
      organization_id: orgId,
      title: String(form.get('title')),
      description: String(form.get('description') || '') || null,
      customer_id: customerId || null,
      assigned_to: String(form.get('assigned_to') || '') || null,
      priority: form.get('priority') as Enums<'task_priority'>,
      due_date: String(form.get('due_date') || '') || null,
      created_by: profile?.id,
    }
    const { error } = await supabase.from('tasks').insert(payload)
    if (error) {
      reportError(showError, 'Add task', error, orgId, profile?.id)
      return
    }
    showSuccess('Task added.')
    setShowAdd(false)
    load()
  }

  async function updateStatus(task: Task, status: Enums<'task_status'>) {
    const { error } = await supabase
      .from('tasks')
      .update({ status, completed_at: status === 'done' ? new Date().toISOString() : null })
      .eq('id', task.id)
    if (error) {
      reportError(showError, 'Update task status', error, orgId, profile?.id)
      return
    }
    load()
  }

  const visible = myOnly ? tasks.filter((t) => t.assigned_to === profile?.id) : tasks
  const canCreate = profile && ['admin', 'sales', 'marketing', 'finance'].includes(profile.role)

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-900">Tasks</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={myOnly} onChange={(e) => setMyOnly(e.target.checked)} /> My tasks only
          </label>
          {canCreate && (
            <button
              onClick={() => setShowAdd(true)}
              className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700"
            >
              + Task
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto pb-2">
      <div className="grid grid-cols-3 gap-3 min-w-[560px] sm:min-w-0">
        {STATUSES.map((status) => (
          <div key={status} className="bg-slate-100 rounded-xl p-2 min-h-[200px]">
            <h3 className="text-xs font-semibold uppercase text-slate-500 px-1 py-1">
              {status.replace('_', ' ')} ({visible.filter((t) => t.status === status).length})
            </h3>
            <div className="space-y-2 mt-1">
              {visible
                .filter((t) => t.status === status)
                .map((t) => {
                  const overdue = t.due_date && t.status !== 'done' && isBefore(new Date(t.due_date), startOfDay(new Date()))
                  return (
                    <div key={t.id} className="bg-white rounded-lg border border-slate-200 p-2.5 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${PRIORITY_COLOR[t.priority]}`}>{t.priority}</span>
                        {overdue && <span className="text-[10px] text-red-600 font-medium">overdue</span>}
                      </div>
                      <div className="font-medium text-slate-900 mt-1">{t.title}</div>
                      {t.description && <p className="text-slate-400 mt-0.5">{t.description}</p>}
                      {t.customers && (
                        <Link to={`/customers/${t.customer_id}`} className="text-indigo-600 hover:underline block mt-1">
                          {t.customers.company_name}
                        </Link>
                      )}
                      <div className="flex items-center justify-between mt-1.5 text-slate-400">
                        <span>{t.assignee?.full_name ?? 'Unassigned'}</span>
                        <span>{t.due_date ?? ''}</span>
                      </div>
                      {t.status !== 'done' && (
                        <select
                          value={t.status}
                          onChange={(e) => updateStatus(t, e.target.value as Enums<'task_status'>)}
                          className="text-[10px] rounded border border-slate-200 px-1 py-0.5 mt-2"
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s.replace('_', ' ')}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )
                })}
            </div>
          </div>
        ))}
      </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-900">New task</h3>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <form action={(fd) => addTask(fd)} className="space-y-3">
              <input name="title" required placeholder="Title" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <textarea name="description" placeholder="Description" rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <select name="customer_id" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">No customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name}
                  </option>
                ))}
              </select>
              <select name="assigned_to" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">Unassigned</option>
                {team.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name ?? p.email} ({p.role})
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <select name="priority" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <input name="due_date" type="date" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <button type="submit" className="w-full rounded-lg bg-indigo-600 text-white py-2 text-sm font-medium hover:bg-indigo-700">
                Save
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
