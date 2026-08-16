import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables } from '../lib/database.types'

type Channel = Tables<'channels'>

const PROVIDERS = ['amazon', 'flipkart', 'myntra', 'meesho', 'shopify', 'woocommerce', 'other']

const SYNC_STATUS_COLOR: Record<string, string> = {
  idle: 'bg-slate-100 text-slate-600',
  running: 'bg-blue-100 text-blue-700',
  success: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
}

function providerOf(c: Channel): string {
  return (c.config as { provider?: string } | null)?.provider ?? 'amazon'
}

export default function Integrations() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ display_name: '', provider: 'amazon', marketplace_id: 'A21TJRUUN4KGV', seller_id: '' })
  const [saving, setSaving] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const orgId = profile?.organization_id
  const isAdmin = profile?.role === 'admin'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const { data } = await supabase.from('channels').select('*').order('created_at')
    setChannels(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  async function addChannel() {
    if (!orgId || !form.display_name.trim()) {
      showError('Display name is required.')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('channels').insert({
      organization_id: orgId,
      display_name: form.display_name.trim(),
      marketplace_id: form.provider === 'amazon' ? form.marketplace_id : form.provider,
      seller_id: form.seller_id || 'NOT-CONFIGURED',
      status: 'disconnected',
      enabled: true,
      config: { provider: form.provider },
    })
    setSaving(false)
    if (error) {
      reportError(showError, 'Add channel', error, orgId, profile?.id)
      return
    }
    showSuccess(`Channel "${form.display_name}" added — configure credentials before syncing.`)
    setForm({ display_name: '', provider: 'amazon', marketplace_id: 'A21TJRUUN4KGV', seller_id: '' })
    setShowAdd(false)
    load()
  }

  async function toggleEnabled(c: Channel) {
    setTogglingId(c.id)
    const { error } = await supabase.from('channels').update({ enabled: !c.enabled }).eq('id', c.id)
    setTogglingId(null)
    if (error) {
      reportError(showError, 'Toggle channel', error, orgId, profile?.id)
      return
    }
    load()
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold text-slate-900">Integrations</h2>
        {isAdmin && (
          <button onClick={() => setShowAdd((v) => !v)} className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
            {showAdd ? 'Cancel' : '+ Add channel'}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400 mb-6">
        Amazon SP-API is the only channel with a working sync connector today (<code>sp-api-sync</code> edge function, needs your Seller
        Central credentials). Other channels can be added as records now — the architecture supports them — but their sync connectors
        aren't built or live yet, and this page won't pretend otherwise.
      </p>

      {showAdd && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <label className="block">
            <span className="text-xs text-slate-500">Display name</span>
            <input type="text" value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Provider</span>
            <select value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5">
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          {form.provider === 'amazon' && (
            <label className="block">
              <span className="text-xs text-slate-500">Marketplace ID</span>
              <input type="text" value={form.marketplace_id} onChange={(e) => setForm((f) => ({ ...f, marketplace_id: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5" />
            </label>
          )}
          <label className="block">
            <span className="text-xs text-slate-500">Seller / Store ID (optional)</span>
            <input type="text" value={form.seller_id} onChange={(e) => setForm((f) => ({ ...f, seller_id: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5" />
          </label>
          <div className="sm:col-span-4">
            <button onClick={addChannel} disabled={saving} className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Add channel'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <Skeleton rows={2} />
        ) : channels.length === 0 ? (
          <EmptyState icon="🔌" title="No channels connected yet." />
        ) : (
          <div className="divide-y divide-slate-50">
            {channels.map((c) => (
              <div key={c.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-medium text-sm text-slate-900 flex items-center gap-2">
                      {c.display_name}
                      <span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">{providerOf(c)}</span>
                      {!c.enabled && <span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-400 rounded px-1.5 py-0.5">Disabled</span>}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Connection: {c.status} · Sync direction: {c.sync_direction}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${SYNC_STATUS_COLOR[c.sync_status] ?? SYNC_STATUS_COLOR.idle}`}>{c.sync_status}</span>
                    {isAdmin && (
                      <button onClick={() => toggleEnabled(c)} disabled={togglingId === c.id} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50">
                        {c.enabled ? 'Disable' : 'Enable'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-xs text-slate-400 mt-2 flex gap-4">
                  <span>Last success: {c.last_success_at ? format(new Date(c.last_success_at), 'dd MMM yyyy, HH:mm') : '—'}</span>
                  <span>Last failure: {c.last_failure_at ? format(new Date(c.last_failure_at), 'dd MMM yyyy, HH:mm') : '—'}</span>
                </div>
                {providerOf(c) === 'amazon' && (
                  <ul className="text-xs text-slate-400 mt-2 list-disc list-inside space-y-0.5">
                    <li>LWA Client ID + Client Secret (from Seller Central → Develop Apps)</li>
                    <li>Refresh token (from authorizing this app against your seller account)</li>
                    <li>Seller ID + Marketplace ID</li>
                  </ul>
                )}
                {providerOf(c) !== 'amazon' && (
                  <p className="text-xs text-amber-600 mt-2">Connector architecture only — no live sync built for this provider yet.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
