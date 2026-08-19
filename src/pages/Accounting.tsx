import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables, Enums } from '../lib/database.types'

type Connection = Tables<'accounting_connections'>
type Mapping = Tables<'accounting_mappings'>

const MAPPING_TYPE_LABEL: Record<Enums<'accounting_mapping_type'>, string> = {
  sales: 'Sales',
  purchase: 'Purchase',
  customer: 'Customer',
  supplier: 'Supplier',
  tax: 'Tax',
  credit_note: 'Credit Note',
  debit_note: 'Debit Note',
  payment: 'Payment',
}

export default function Accounting() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [connections, setConnections] = useState<Connection[]>([])
  const [mappings, setMappings] = useState<Mapping[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ provider: 'tally' as Enums<'accounting_provider'>, display_name: '' })
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [mapForm, setMapForm] = useState({ mapping_type: 'sales' as Enums<'accounting_mapping_type'>, internal_field: '', external_ledger_name: '' })
  const [savingMap, setSavingMap] = useState(false)

  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'finance'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const [{ data: c }, { data: m }] = await Promise.all([
      supabase.from('accounting_connections').select('*').order('created_at'),
      supabase.from('accounting_mappings').select('*').order('mapping_type'),
    ])
    setConnections(c ?? [])
    setMappings(m ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  async function addConnection() {
    if (!orgId || !form.display_name.trim()) {
      showError('Display name is required.')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('accounting_connections').insert({
      organization_id: orgId,
      provider: form.provider,
      display_name: form.display_name.trim(),
      status: 'not_configured',
    })
    setSaving(false)
    if (error) {
      reportError(showError, 'Add accounting connection', error, orgId, profile?.id)
      return
    }
    showSuccess(`${form.provider === 'tally' ? 'Tally' : 'BUSY'} connection "${form.display_name}" added — configure credentials before syncing.`)
    setForm({ provider: 'tally', display_name: '' })
    setShowAdd(false)
    load()
  }

  async function toggleEnabled(c: Connection) {
    const { error } = await supabase.from('accounting_connections').update({ enabled: !c.enabled }).eq('id', c.id)
    if (error) {
      reportError(showError, 'Toggle connection', error, orgId, profile?.id)
      return
    }
    load()
  }

  async function addMapping(connectionId: string) {
    if (!orgId || !mapForm.internal_field.trim() || !mapForm.external_ledger_name.trim()) {
      showError('Both internal field and external ledger name are required.')
      return
    }
    setSavingMap(true)
    const { error } = await supabase.from('accounting_mappings').insert({
      organization_id: orgId,
      connection_id: connectionId,
      mapping_type: mapForm.mapping_type,
      internal_field: mapForm.internal_field.trim(),
      external_ledger_name: mapForm.external_ledger_name.trim(),
    })
    setSavingMap(false)
    if (error) {
      reportError(showError, 'Add mapping', error, orgId, profile?.id)
      return
    }
    setMapForm({ mapping_type: 'sales', internal_field: '', external_ledger_name: '' })
    load()
  }

  async function removeMapping(id: string) {
    const { error } = await supabase.from('accounting_mappings').delete().eq('id', id)
    if (error) {
      reportError(showError, 'Remove mapping', error, orgId, profile?.id)
      return
    }
    load()
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Accounting Integration</h2>
        {canEdit && (
          <button onClick={() => setShowAdd((v) => !v)} className="text-sm rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700/40">
            {showAdd ? 'Cancel' : '+ Add connection'}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">
        Architecture only, same honest pattern as non-Amazon sales channels: a connection record and field-mapping layer exist, but
        there's no live Tally/BUSY sync connector built or credentialed here. Never claim a live sync until it's actually tested against
        a real account.
      </p>

      {showAdd && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <label className="block">
            <span className="text-xs text-slate-500 dark:text-slate-400">Provider</span>
            <select value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as Enums<'accounting_provider'> }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100">
              <option value="tally">Tally</option>
              <option value="busy">BUSY</option>
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">Display name</span>
            <input type="text" value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
          </label>
          <div className="sm:col-span-3">
            <button onClick={addConnection} disabled={saving} className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Add connection'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {loading ? (
          <Skeleton rows={2} />
        ) : connections.length === 0 ? (
          <EmptyState icon="📒" title="No accounting connections yet." />
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-700/60">
            {connections.map((c) => {
              const connMappings = mappings.filter((m) => m.connection_id === c.id)
              return (
                <div key={c.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-medium text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        {c.display_name}
                        <span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-500 dark:bg-slate-900/40 dark:text-slate-300 rounded px-1.5 py-0.5">{c.provider}</span>
                        {!c.enabled && <span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-400 dark:bg-slate-900/40 dark:text-slate-300 rounded px-1.5 py-0.5">Disabled</span>}
                      </div>
                      <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Status: {c.status.replace('_', ' ')}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setExpandedId(expandedId === c.id ? null : c.id)} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                        {connMappings.length} mapping(s)
                      </button>
                      {canEdit && (
                        <button onClick={() => toggleEnabled(c)} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                          {c.enabled ? 'Disable' : 'Enable'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-slate-400 dark:text-slate-500 mt-2 flex gap-4">
                    <span>Last success: {c.last_success_at ? format(new Date(c.last_success_at), 'dd MMM yyyy, HH:mm') : '—'}</span>
                    <span>Last failure: {c.last_failure_at ? format(new Date(c.last_failure_at), 'dd MMM yyyy, HH:mm') : '—'}</span>
                  </div>
                  <p className="text-xs text-amber-600 mt-2">Connector architecture only — no live sync built for this provider yet.</p>

                  {expandedId === c.id && (
                    <div className="mt-3 border-t border-slate-100 dark:border-slate-700/60 pt-3">
                      <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-2">Field mappings</div>
                      {connMappings.length === 0 ? (
                        <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">No mappings yet.</p>
                      ) : (
                        <div className="space-y-1 mb-3">
                          {connMappings.map((m) => (
                            <div key={m.id} className="flex items-center gap-2 text-sm">
                              <span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-500 dark:bg-slate-900/40 dark:text-slate-300 rounded px-1.5 py-0.5">{MAPPING_TYPE_LABEL[m.mapping_type]}</span>
                              <span className="text-slate-700 dark:text-slate-300">{m.internal_field}</span>
                              <span className="text-slate-400 dark:text-slate-500">→</span>
                              <span className="text-slate-700 dark:text-slate-300">{m.external_ledger_name}</span>
                              {canEdit && (
                                <button onClick={() => removeMapping(m.id)} className="text-xs text-slate-400 dark:text-slate-500 hover:text-red-600 ml-2">
                                  Remove
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {canEdit && (
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
                          <select value={mapForm.mapping_type} onChange={(e) => setMapForm((f) => ({ ...f, mapping_type: e.target.value as Enums<'accounting_mapping_type'> }))} className="text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100">
                            {(Object.keys(MAPPING_TYPE_LABEL) as Enums<'accounting_mapping_type'>[]).map((t) => (
                              <option key={t} value={t}>
                                {MAPPING_TYPE_LABEL[t]}
                              </option>
                            ))}
                          </select>
                          <input type="text" placeholder="Internal field (e.g. gst_invoices)" value={mapForm.internal_field} onChange={(e) => setMapForm((f) => ({ ...f, internal_field: e.target.value }))} className="text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
                          <input type="text" placeholder="External ledger/voucher name" value={mapForm.external_ledger_name} onChange={(e) => setMapForm((f) => ({ ...f, external_ledger_name: e.target.value }))} className="text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
                          <button onClick={() => addMapping(c.id)} disabled={savingMap} className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50">
                            {savingMap ? 'Saving…' : '+ Add mapping'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
