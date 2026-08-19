import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import type { Tables, Enums } from '../lib/database.types'

type Profile = Tables<'profiles'>
type Organization = Tables<'organizations'>

const ROLES: Enums<'user_role'>[] = ['admin', 'ops', 'finance']

export default function Team() {
  const { profile: me } = useAuth()
  const { showError, showSuccess } = useToast()
  const [members, setMembers] = useState<Profile[]>([])
  const [roleChoice, setRoleChoice] = useState<Record<string, Enums<'user_role'>>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [org, setOrg] = useState<Organization | null>(null)
  const [orgForm, setOrgForm] = useState({ name: '', gst_number: '', state: '', address: '' })
  const [savingOrg, setSavingOrg] = useState(false)

  async function load() {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
    setMembers(data ?? [])
  }

  async function loadOrg() {
    if (!me?.organization_id) return
    const { data } = await supabase.from('organizations').select('*').eq('id', me.organization_id).single()
    if (data) {
      setOrg(data)
      setOrgForm({
        name: data.name,
        gst_number: data.gst_number ?? '',
        state: data.state ?? '',
        address: data.address ?? '',
      })
    }
  }

  async function saveOrg() {
    if (!org) return
    setSavingOrg(true)
    const { error } = await supabase
      .from('organizations')
      .update({ name: orgForm.name, gst_number: orgForm.gst_number || null, state: orgForm.state || null, address: orgForm.address || null })
      .eq('id', org.id)
    setSavingOrg(false)
    if (error) {
      reportError(showError, 'Update organization', error, me?.organization_id, me?.id)
      return
    }
    showSuccess('Organization details saved.')
    loadOrg()
  }

  useEffect(() => {
    load()
    loadOrg()
  }, [me?.organization_id])

  async function approve(userId: string) {
    setBusyId(userId)
    const role = roleChoice[userId] ?? 'ops'
    const { error } = await supabase.rpc('approve_team_member', { p_user_id: userId, p_role: role })
    setBusyId(null)
    if (error) {
      reportError(showError, 'Approve team member', error, me?.organization_id, me?.id)
      return
    }
    showSuccess('Team member approved.')
    load()
  }

  async function changeRole(userId: string, role: Enums<'user_role'>) {
    setBusyId(userId)
    const { error } = await supabase.rpc('update_team_member', { p_user_id: userId, p_role: role, p_status: 'active' })
    setBusyId(null)
    if (error) {
      reportError(showError, 'Change role', error, me?.organization_id, me?.id)
      return
    }
    showSuccess('Role updated.')
    load()
  }

  async function deactivate(userId: string, currentRole: Enums<'user_role'>) {
    setBusyId(userId)
    const { error } = await supabase.rpc('update_team_member', { p_user_id: userId, p_role: currentRole, p_status: 'pending' })
    setBusyId(null)
    if (error) {
      reportError(showError, 'Deactivate team member', error, me?.organization_id, me?.id)
      return
    }
    showSuccess('Team member deactivated.')
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

      {me?.role === 'admin' && (
        <>
          <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">Organization</h3>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6 space-y-3">
            <p className="text-xs text-slate-400">
              Used on generated GST invoices, and to tell CGST/SGST (same state as buyer) from IGST (different state).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Business name" value={orgForm.name} onChange={(v) => setOrgForm((f) => ({ ...f, name: v }))} />
              <Field label="GSTIN" value={orgForm.gst_number} onChange={(v) => setOrgForm((f) => ({ ...f, gst_number: v }))} />
              <Field label="State" value={orgForm.state} onChange={(v) => setOrgForm((f) => ({ ...f, state: v }))} placeholder="e.g. Rajasthan" />
              <Field label="Address" value={orgForm.address} onChange={(v) => setOrgForm((f) => ({ ...f, address: v }))} />
            </div>
            <button
              onClick={saveOrg}
              disabled={savingOrg}
              className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50"
            >
              {savingOrg ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      )}

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
          <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-medium text-sm text-slate-900">
                {p.full_name || p.email} {p.id === me?.id && <span className="text-xs text-slate-400">(you)</span>}
              </div>
              <div className="text-xs text-slate-400">{p.email}</div>
            </div>
            {me?.role === 'admin' && p.id !== me?.id ? (
              <div className="flex items-center gap-2">
                <select
                  value={p.role}
                  disabled={busyId === p.id}
                  onChange={(e) => changeRole(p.id, e.target.value as Enums<'user_role'>)}
                  className="text-sm rounded-lg border border-slate-300 px-2 py-1.5 disabled:opacity-50"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => deactivate(p.id, p.role)}
                  disabled={busyId === p.id}
                  className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                >
                  Deactivate
                </button>
              </div>
            ) : (
              <span className="text-[10px] uppercase tracking-wide bg-indigo-50 text-indigo-600 rounded px-1.5 py-0.5">
                {p.role}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </label>
  )
}
