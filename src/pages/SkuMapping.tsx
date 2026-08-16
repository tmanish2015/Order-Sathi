import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import ConfirmDialog from '../components/ConfirmDialog'
import type { Tables } from '../lib/database.types'

type Mapping = Tables<'sku_channel_mappings'> & { skus: Tables<'skus'> | null; channels: Tables<'channels'> | null }
type Sku = Tables<'skus'>
type Channel = Tables<'channels'>
type Exception = Tables<'unmapped_sku_exceptions'> & { channels: Tables<'channels'> | null }

export default function SkuMapping() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [mappings, setMappings] = useState<Mapping[]>([])
  const [exceptions, setExceptions] = useState<Exception[]>([])
  const [skus, setSkus] = useState<Sku[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ sku_id: '', channel_id: '', channel_sku: '', channel_product_id: '' })
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Mapping | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const [{ data: m }, { data: exc }, { data: s }, { data: c }] = await Promise.all([
      supabase.from('sku_channel_mappings').select('*, skus(*), channels(*)').order('created_at', { ascending: false }),
      supabase.from('unmapped_sku_exceptions').select('*, channels(*)').eq('resolved', false).order('created_at', { ascending: false }),
      supabase.from('skus').select('*').eq('active', true).order('sku'),
      supabase.from('channels').select('*'),
    ])
    setMappings((m as unknown as Mapping[]) ?? [])
    setExceptions((exc as unknown as Exception[]) ?? [])
    setSkus(s ?? [])
    setChannels(c ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  async function addMapping() {
    if (!orgId || !form.sku_id || !form.channel_id || !form.channel_sku.trim()) {
      showError('SKU, channel, and channel SKU are required.')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('sku_channel_mappings').insert({
      organization_id: orgId,
      sku_id: form.sku_id,
      channel_id: form.channel_id,
      channel_sku: form.channel_sku.trim(),
      channel_product_id: form.channel_product_id || null,
    })
    setSaving(false)
    if (error) {
      reportError(showError, 'Add mapping', error, orgId, profile?.id)
      return
    }
    showSuccess('Mapping added.')
    setForm({ sku_id: '', channel_id: '', channel_sku: '', channel_product_id: '' })
    setShowAdd(false)
    load()
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const { error } = await supabase.from('sku_channel_mappings').delete().eq('id', deleteTarget.id)
    setDeleting(false)
    setDeleteTarget(null)
    if (error) {
      reportError(showError, 'Delete mapping', error, orgId, profile?.id)
      return
    }
    showSuccess('Mapping removed.')
    load()
  }

  // Resolving here just dismisses the exception - the seller is expected to
  // have added the actual mapping above first (or fixed the SKU on the
  // channel side); this doesn't infer or guess a mapping automatically.
  async function resolveException(exc: Exception) {
    setResolvingId(exc.id)
    const { error } = await supabase.from('unmapped_sku_exceptions').update({ resolved: true, resolved_by: profile!.id, resolved_at: new Date().toISOString() }).eq('id', exc.id)
    setResolvingId(null)
    if (error) {
      reportError(showError, 'Resolve exception', error, orgId, profile?.id)
      return
    }
    load()
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold text-slate-900">SKU / Channel Mapping</h2>
        {canEdit && (
          <button onClick={() => setShowAdd((v) => !v)} className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
            {showAdd ? 'Cancel' : '+ Add mapping'}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400 mb-6">
        One internal SKU can have a different code on each channel. Orders whose channel SKU has no mapping don't get silently dropped —
        they land in the exception list below.
      </p>

      {showAdd && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
          <label className="block">
            <span className="text-xs text-slate-500">Internal SKU</span>
            <select value={form.sku_id} onChange={(e) => setForm((f) => ({ ...f, sku_id: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5">
              <option value="">Select SKU…</option>
              {skus.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.sku} — {s.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Channel</span>
            <select value={form.channel_id} onChange={(e) => setForm((f) => ({ ...f, channel_id: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5">
              <option value="">Select channel…</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Channel SKU</span>
            <input type="text" value={form.channel_sku} onChange={(e) => setForm((f) => ({ ...f, channel_sku: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Channel product ID (optional)</span>
            <input type="text" value={form.channel_product_id} onChange={(e) => setForm((f) => ({ ...f, channel_product_id: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5" />
          </label>
          <button onClick={addMapping} disabled={saving} className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Add'}
          </button>
        </div>
      )}

      {exceptions.length > 0 && (
        <div className="bg-white rounded-xl border border-red-200 shadow-sm overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-red-100 bg-red-50 text-xs font-semibold uppercase text-red-700">
            Unmapped SKU exceptions ({exceptions.length})
          </div>
          <div className="divide-y divide-slate-50">
            {exceptions.map((exc) => (
              <div key={exc.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-sm text-slate-900">
                    <strong>{exc.channel_sku}</strong> on {exc.channels?.display_name ?? 'unknown channel'} — order {exc.channel_order_id}
                  </div>
                  <div className="text-xs text-slate-400">{format(new Date(exc.created_at), 'dd MMM yyyy, HH:mm')}</div>
                </div>
                {canEdit && (
                  <button onClick={() => resolveException(exc)} disabled={resolvingId === exc.id} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50">
                    {resolvingId === exc.id ? 'Resolving…' : 'Mark resolved'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <Skeleton />
        ) : mappings.length === 0 ? (
          <EmptyState icon="🔗" title="No mappings yet." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="px-4 py-2 font-medium">Internal SKU</th>
                <th className="px-4 py-2 font-medium">Channel</th>
                <th className="px-4 py-2 font-medium">Channel SKU</th>
                <th className="px-4 py-2 font-medium">Channel product ID</th>
                <th className="px-4 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {mappings.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2.5 font-medium text-slate-700">{m.skus?.sku}</td>
                  <td className="px-4 py-2.5 text-slate-500">{m.channels?.display_name}</td>
                  <td className="px-4 py-2.5 text-slate-500">{m.channel_sku}</td>
                  <td className="px-4 py-2.5 text-slate-500">{m.channel_product_id ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    {canEdit && (
                      <button onClick={() => setDeleteTarget(m)} className="text-xs text-slate-400 hover:text-red-600">
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="Delete mapping?"
          message={`Remove the mapping for ${deleteTarget.skus?.sku} on ${deleteTarget.channels?.display_name}?`}
          confirmLabel="Delete"
          danger
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
