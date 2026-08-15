import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import type { Tables, Enums } from '../lib/database.types'

type Profile = Tables<'profiles'>

const ROLES: Enums<'user_role'>[] = ['admin', 'ops', 'finance']

export default function Team() {
  const { profile: me } = useAuth()
  const { showError, showSuccess } = useToast()
  const [members, setMembers] = useState<Profile[]>([])
  const [roleChoice, setRoleChoice] = useState<Record<string, Enums<'user_role'>>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
    setMembers(data ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  async function approve(userId: string) {
    setBusyId(userId)
    const role = roleChoice[userId] ?? 'sales'
    const { error } = await supabase.rpc('approve_team_member', { p_user_id: userId, p_role: role })
    setBusyId(null)
    if (error) {
      reportError(showError, 'Approve team member', error, me?.organization_id, me?.id)
      return
    }
    showSuccess('Team member approved.')
    load()
  }

  const pending = members.filter((m) => m.status === 'pending')
  const active = members.filter((m) => m.status === 'active')

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">Team</h2>
      <p className="text-xs text-slate-400 mb-6">
        New signups land here as pending with no data access until an admin approves them and assigns a role.
      </p>

      {pending.length > 0 && (
        <>
          <h3 className="text-xs font-semibold uppercase text-amber-600 mb-2">Pending approval ({pending.length})</h3>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100 mb-6">
            {pending.map((p) => (
              <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-medium text-sm text-slate-900">{p.full_name || p.email}</div>
                  <div className="text-xs text-slate-400">
                    {p.email} · signed up {format(new Date(p.created_at), 'dd MMM yyyy')}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={roleChoice[p.id] ?? 'ops'}
                    onChange={(e) => setRoleChoice((r) => ({ ...r, [p.id]: e.target.value as Enums<'user_role'> }))}
                    className="text-sm rounded-lg border border-slate-300 px-2 py-1.5"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => approve(p.id)}
                    disabled={busyId === p.id}
                    className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">Active team ({active.length})</h3>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
        {active.map((p) => (
          <div key={p.id} className="px-4 py-3 flex items-center justify-between">
            <div>
              <div className="font-medium text-sm text-slate-900">
                {p.full_name || p.email} {p.id === me?.id && <span className="text-xs text-slate-400">(you)</span>}
              </div>
              <div className="text-xs text-slate-400">{p.email}</div>
            </div>
            <span className="text-[10px] uppercase tracking-wide bg-indigo-50 text-indigo-600 rounded px-1.5 py-0.5">
              {p.role}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
