import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import ConfirmDialog from '../components/ConfirmDialog'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables, Enums } from '../lib/database.types'

type Promotion = Tables<'promotions'> & { skus: Tables<'skus'> | null; channels: Tables<'channels'> | null }
type Sku = Tables<'skus'>
type Channel = Tables<'channels'>

const TYPE_LABEL: Record<Enums<'promotion_type'>, string> = {
  percentage: '% off',
  fixed: 'Flat amount off',
  bxgy: 'Buy X Get Y',
}

const BLANK_FORM = {
  name: '',
  promotion_type: 'percentage' as Enums<'promotion_type'>,
  discount_value: '',
  buy_qty: '',
  get_qty: '',
  sku_id: '',
  category: '',
  channel_id: '',
  min_order_value: '',
  start_date: format(new Date(), 'yyyy-MM-dd'),
  end_date: format(new Date(), 'yyyy-MM-dd'),
}

export default function Promotions() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [skus, setSkus] = useState<Sku[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Promotion | null>(null)
  const [deleting, setDeleting] = useState(false)

  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const [{ data: p }, { data: s }, { data: c }] = await Promise.all([
      supabase.from('promotions').select('*, skus(*), channels(*)').order('start_date', { ascending: false }),
      supabase.from('skus').select('*').eq('active', true).order('sku'),
      supabase.from('channels').select('*'),
    ])
    setPromotions((p as unknown as Promotion[]) ?? [])
    setSkus(s ?? [])
    setChannels(c ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  function status(p: Promotion): 'upcoming' | 'active' | 'expired' | 'inactive' {
    if (!p.active) return 'inactive'
    const today = format(new Date(), 'yyyy-MM-dd')
    if (today < p.start_date) return 'upcoming'
    if (today > p.end_date) return 'expired'
    return 'active'
  }

  const STATUS_COLOR: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    upcoming: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    expired: 'bg-slate-100 text-slate-500 dark:bg-slate-900/40 dark:text-slate-300',
    inactive: 'bg-slate-100 text-slate-400 dark:bg-slate-900/40 dark:text-slate-300',
  }

  async function createPromotion() {
    if (!orgId || !form.name.trim()) {
      showError('Name is required.')
      return
    }
    if (form.promotion_type === 'bxgy' && (!form.buy_qty || !form.get_qty)) {
      showError('Buy X Get Y needs both buy qty and get qty.')
      return
    }
    if (form.promotion_type !== 'bxgy' && !form.discount_value) {
      showError('Enter a discount value.')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('promotions').insert({
      organization_id: orgId,
      name: form.name.trim(),
      promotion_type: form.promotion_type,
      discount_value: form.promotion_type !== 'bxgy' ? Number(form.discount_value) : null,
      buy_qty: form.promotion_type === 'bxgy' ? Number(form.buy_qty) : null,
      get_qty: form.promotion_type === 'bxgy' ? Number(form.get_qty) : null,
      sku_id: form.sku_id || null,
      category: form.category.trim() || null,
      channel_id: form.channel_id || null,
      min_order_value: form.min_order_value ? Number(form.min_order_value) : null,
      start_date: form.start_date,
      end_date: form.end_date,
      created_by: profile!.id,
    })
    setSaving(false)
    if (error) {
      reportError(showError, 'Create promotion', error, orgId, profile?.id)
      return
    }
    showSuccess(`Promotion "${form.name}" created.`)
    setForm(BLANK_FORM)
    setShowNew(false)
    load()
  }

  async function toggleActive(p: Promotion) {
    const { error } = await supabase.from('promotions').update({ active: !p.active }).eq('id', p.id)
    if (error) {
      reportError(showError, 'Update promotion', error, orgId, profile?.id)
      return
    }
    load()
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const { error } = await supabase.from('promotions').delete().eq('id', deleteTarget.id)
    setDeleting(false)
    setDeleteTarget(null)
    if (error) {
      reportError(showError, 'Delete promotion', error, orgId, profile?.id)
      return
    }
    showSuccess('Promotion deleted.')
    load()
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Promotions &amp; Discounts</h2>
        {canEdit && (
          <button onClick={() => setShowNew((v) => !v)} className="text-sm rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700/40">
            {showNew ? 'Cancel' : '+ New promotion'}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">
        Order Sathi is an OMS, not a storefront — there's no live cart to auto-apply these to. This is a reference catalog of what's
        running (or scheduled), for planning and reporting.
      </p>

      {showNew && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <label className="block sm:col-span-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">Name</span>
              <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Type</span>
              <select value={form.promotion_type} onChange={(e) => setForm((f) => ({ ...f, promotion_type: e.target.value as Enums<'promotion_type'> }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100">
                <option value="percentage">% off</option>
                <option value="fixed">Flat amount off</option>
                <option value="bxgy">Buy X Get Y</option>
              </select>
            </label>

            {form.promotion_type === 'bxgy' ? (
              <>
                <label className="block">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Buy qty</span>
                  <input type="number" value={form.buy_qty} onChange={(e) => setForm((f) => ({ ...f, buy_qty: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Get qty (free)</span>
                  <input type="number" value={form.get_qty} onChange={(e) => setForm((f) => ({ ...f, get_qty: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
                </label>
              </>
            ) : (
              <label className="block">
                <span className="text-xs text-slate-500 dark:text-slate-400">{form.promotion_type === 'percentage' ? 'Discount %' : 'Discount amount (₹)'}</span>
                <input type="number" value={form.discount_value} onChange={(e) => setForm((f) => ({ ...f, discount_value: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
              </label>
            )}

            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">SKU (optional)</span>
              <select value={form.sku_id} onChange={(e) => setForm((f) => ({ ...f, sku_id: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100">
                <option value="">All SKUs</option>
                {skus.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.sku} — {s.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Category (optional)</span>
              <input type="text" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Channel (optional)</span>
              <select value={form.channel_id} onChange={(e) => setForm((f) => ({ ...f, channel_id: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100">
                <option value="">All channels</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Min order value (optional)</span>
              <input type="number" value={form.min_order_value} onChange={(e) => setForm((f) => ({ ...f, min_order_value: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Start date</span>
              <input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">End date</span>
              <input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
            </label>
          </div>
          <button onClick={createPromotion} disabled={saving} className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Create promotion'}
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {loading ? (
          <Skeleton rows={3} />
        ) : promotions.length === 0 ? (
          <EmptyState icon="🏷" title="No promotions yet." />
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-700/60">
            {promotions.map((p) => (
              <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-medium text-sm text-slate-900 dark:text-slate-100">
                    {p.name}
                    <span className="ml-2 text-[10px] uppercase tracking-wide bg-slate-100 text-slate-500 dark:bg-slate-700/60 dark:text-slate-400 rounded px-1.5 py-0.5">{TYPE_LABEL[p.promotion_type]}</span>
                  </div>
                  <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                    {p.promotion_type === 'bxgy' ? `Buy ${p.buy_qty} Get ${p.get_qty}` : p.promotion_type === 'percentage' ? `${p.discount_value}% off` : `₹${p.discount_value} off`}
                    {p.sku_id && p.skus ? ` · ${p.skus.sku}` : p.category ? ` · ${p.category}` : ' · all SKUs'}
                    {p.channels ? ` · ${p.channels.display_name}` : ' · all channels'}
                    {p.min_order_value ? ` · min order ₹${p.min_order_value}` : ''}
                    {' · '}
                    {format(new Date(p.start_date), 'dd MMM')} – {format(new Date(p.end_date), 'dd MMM yyyy')}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${STATUS_COLOR[status(p)]}`}>{status(p)}</span>
                  {canEdit && (
                    <>
                      <button onClick={() => toggleActive(p)} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                        {p.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => setDeleteTarget(p)} className="text-xs text-slate-400 dark:text-slate-500 hover:text-red-600">
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="Delete promotion?"
          message={`Delete "${deleteTarget.name}"? This can't be undone.`}
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
