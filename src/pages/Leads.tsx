import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import type { Tables, TablesInsert, Enums } from '../lib/database.types'

type Lead = Tables<'leads'>

const STAGES: Enums<'lead_status'>[] = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost']
const SOURCES: Enums<'lead_source'>[] = ['website', 'meta', 'linkedin', 'referral', 'other']

function scoreFor(source: Enums<'lead_source'>) {
  if (source === 'referral') return 30
  if (source === 'website') return 20
  if (source === 'meta' || source === 'linkedin') return 15
  return 5
}

export default function Leads() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [leads, setLeads] = useState<Lead[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const orgId = profile?.organization_id

  async function load() {
    const { data } = await supabase.from('leads').select('*').order('created_at', { ascending: false })
    setLeads(data ?? [])
  }

  useEffect(() => {
    load()
  }, [orgId])

  async function addLead(form: FormData) {
    if (!orgId) return
    const source = form.get('source') as Enums<'lead_source'>
    const payload: TablesInsert<'leads'> = {
      organization_id: orgId,
      name: String(form.get('name')),
      company: String(form.get('company') || '') || null,
      email: String(form.get('email') || '') || null,
      phone: String(form.get('phone') || '') || null,
      source,
      score: scoreFor(source),
      assigned_to: profile?.id,
    }
    const { error } = await supabase.from('leads').insert(payload)
    if (error) {
      reportError(showError, 'Add lead', error, orgId, profile?.id)
      return
    }
    showSuccess('Lead added.')
    setShowAdd(false)
    load()
  }

  async function moveStage(lead: Lead, status: Enums<'lead_status'>) {
    const { error } = await supabase.from('leads').update({ status }).eq('id', lead.id)
    if (error) {
      reportError(showError, 'Update lead stage', error, orgId, profile?.id)
      return
    }
    load()
  }

  async function convertToCustomer(lead: Lead) {
    if (!orgId) return
    const { data: customer, error } = await supabase
      .from('customers')
      .insert({
        organization_id: orgId,
        company_name: lead.company || lead.name,
        contact_person: lead.name,
        email: lead.email,
        phone: lead.phone,
        created_by: profile?.id,
      })
      .select()
      .single()
    if (error || !customer) {
      reportError(showError, 'Convert lead to customer', error ?? { message: 'insert returned no row' }, orgId, profile?.id)
      return
    }
    const { error: updateError } = await supabase
      .from('leads')
      .update({ status: 'won', converted_customer_id: customer.id })
      .eq('id', lead.id)
    if (updateError) {
      reportError(showError, 'Convert lead to customer', updateError, orgId, profile?.id)
      return
    }
    showSuccess('Lead converted to customer.')
    load()
  }

  const canWrite = profile && ['admin', 'sales', 'marketing'].includes(profile.role)

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-slate-900">Lead Pipeline</h2>
        {canWrite && (
          <button
            onClick={() => setShowAdd(true)}
            className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700"
          >
            + Lead
          </button>
        )}
      </div>

      <div className="overflow-x-auto pb-2">
      <div className="grid grid-cols-6 gap-3 min-w-[900px] sm:min-w-0">
        {STAGES.map((stage) => (
          <div key={stage} className="bg-slate-100 rounded-xl p-2 min-h-[200px]">
            <h3 className="text-xs font-semibold uppercase text-slate-500 px-1 py-1">
              {stage} ({leads.filter((l) => l.status === stage).length})
            </h3>
            <div className="space-y-2 mt-1">
              {leads
                .filter((l) => l.status === stage)
                .map((lead) => (
                  <div key={lead.id} className="bg-white rounded-lg border border-slate-200 p-2.5 text-xs">
                    <div className="font-medium text-slate-900">{lead.name}</div>
                    <div className="text-slate-400">{lead.company}</div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[10px] uppercase text-slate-400">{lead.source}</span>
                      <span className="text-[10px] font-semibold text-indigo-600">score {lead.score}</span>
                    </div>
                    {canWrite && stage !== 'won' && stage !== 'lost' && (
                      <div className="mt-2 flex gap-1 flex-wrap">
                        {stage === 'proposal' && (
                          <button
                            onClick={() => convertToCustomer(lead)}
                            className="text-[10px] rounded bg-emerald-600 text-white px-1.5 py-0.5"
                          >
                            Convert
                          </button>
                        )}
                        <select
                          value={lead.status}
                          onChange={(e) => moveStage(lead, e.target.value as Enums<'lead_status'>)}
                          className="text-[10px] rounded border border-slate-200 px-1 py-0.5"
                        >
                          {STAGES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-900">Add lead</h3>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <form action={(fd) => addLead(fd)} className="space-y-3">
              <input name="name" required placeholder="Name" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <input name="company" placeholder="Company" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <input name="email" type="email" placeholder="Email" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <input name="phone" placeholder="Phone" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <select name="source" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
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
