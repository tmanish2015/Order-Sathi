import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import type { Tables } from '../lib/database.types'

type Organization = Tables<'organizations'>

const LINKS: { to: string; icon: string; label: string; desc: string }[] = [
  { to: '/team', icon: '👥', label: 'Team & Roles', desc: 'Approve signups, assign admin/ops/finance roles, deactivate members.' },
  { to: '/warehouses', icon: '🏭', label: 'Warehouses', desc: 'Locations, default warehouse for new stock.' },
  { to: '/integrations', icon: '🔌', label: 'Channels & Integrations', desc: 'Amazon connection, non-Amazon channel mappings.' },
  { to: '/accounting', icon: '📒', label: 'Accounting', desc: 'Tally/BUSY connections and field mappings.' },
  { to: '/automation', icon: '⚡', label: 'Automation Rules', desc: 'Inventory and return-QC trigger rules.' },
  { to: '/promotions', icon: '🏷', label: 'Promotions', desc: 'Discount/offer reference catalog.' },
  { to: '/notifications', icon: '🔔', label: 'Notifications', desc: 'Exception alert categories.' },
  { to: '/audit-log', icon: '📜', label: 'Audit Log', desc: 'Who changed what, across the app.' },
]

export default function Settings() {
  const { profile: me } = useAuth()
  const { showError, showSuccess } = useToast()
  const [org, setOrg] = useState<Organization | null>(null)
  const [orgForm, setOrgForm] = useState({ name: '', gst_number: '', state: '', address: '' })
  const [savingOrg, setSavingOrg] = useState(false)

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

  useEffect(() => {
    loadOrg()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.organization_id])

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

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">Settings</h2>
      <p className="text-xs text-slate-400 mb-6">Organization profile and links to every other configurable area of Order Sathi.</p>

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

      <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">Configuration areas</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {LINKS.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 hover:border-indigo-300 hover:shadow transition-all flex gap-3"
          >
            <span className="text-xl leading-none">{l.icon}</span>
            <div>
              <div className="text-sm font-medium text-slate-900">{l.label}</div>
              <div className="text-xs text-slate-400 mt-0.5">{l.desc}</div>
            </div>
          </Link>
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
