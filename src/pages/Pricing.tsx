import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import { formatINR } from '../lib/format'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables } from '../lib/database.types'

type Sku = Tables<'skus'>
type Channel = Tables<'channels'>
type PriceRow = Tables<'sku_prices'>

const BASE_SCOPE = '__base__'

export default function Pricing() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [skus, setSkus] = useState<Sku[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [prices, setPrices] = useState<PriceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [form, setForm] = useState({ channel_id: BASE_SCOPE, price: '', min_selling_price: '', effective_from: format(new Date(), 'yyyy-MM-dd') })
  const [saving, setSaving] = useState(false)

  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const [{ data: s }, { data: c }, { data: p }] = await Promise.all([
      supabase.from('skus').select('*').eq('active', true).order('sku'),
      supabase.from('channels').select('*'),
      supabase.from('sku_prices').select('*').order('effective_from', { ascending: false }),
    ])
    setSkus(s ?? [])
    setChannels(c ?? [])
    setPrices(p ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  // Current price for a scope = the most recent row (prices are already
  // sorted effective_from desc, so the first match wins) — never an
  // update, always the latest of an append-only history.
  function currentPrice(skuId: string, channelId: string | null): PriceRow | undefined {
    return prices.find((p) => p.sku_id === skuId && p.channel_id === channelId)
  }

  function historyFor(skuId: string): PriceRow[] {
    return prices.filter((p) => p.sku_id === skuId)
  }

  async function setPrice(sku: Sku) {
    const price = Number(form.price)
    if (!Number.isFinite(price) || price <= 0) {
      showError('Enter a valid price.')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('sku_prices').insert({
      organization_id: orgId!,
      sku_id: sku.id,
      channel_id: form.channel_id === BASE_SCOPE ? null : form.channel_id,
      price,
      min_selling_price: form.min_selling_price.trim() ? Number(form.min_selling_price) : null,
      effective_from: form.effective_from,
      created_by: profile!.id,
    })
    setSaving(false)
    if (error) {
      reportError(showError, 'Set price', error, orgId, profile?.id)
      return
    }
    showSuccess(`${sku.sku}: new price ${formatINR(price)} recorded, effective ${format(new Date(form.effective_from), 'dd MMM yyyy')}.`)
    setForm({ channel_id: BASE_SCOPE, price: '', min_selling_price: '', effective_from: format(new Date(), 'yyyy-MM-dd') })
    load()
  }

  const filteredSkus = skus.filter((s) => {
    const q = search.trim().toLowerCase()
    return !q || s.sku.toLowerCase().includes(q) || s.title.toLowerCase().includes(q)
  })

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">Pricing</h2>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-6">
        Price history is append-only — setting a new price never overwrites an old one, it adds a new effective-dated row. Base price
        applies unless a channel-specific price exists for that channel. Promotional discounts are a separate module; customer-specific
        pricing isn't supported yet (no customer master exists — see Customers page for why).
      </p>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search SKU or title…"
        className="text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 w-64 mb-3 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
      />

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {loading ? (
          <Skeleton rows={3} />
        ) : filteredSkus.length === 0 ? (
          <EmptyState icon="💰" title="No SKUs yet." />
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-700/60">
            {filteredSkus.map((s) => {
              const base = currentPrice(s.id, null)
              const isExpanded = expandedId === s.id
              return (
                <div key={s.id}>
                  <button onClick={() => setExpandedId(isExpanded ? null : s.id)} className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <div>
                      <div className="font-medium text-sm text-slate-900 dark:text-slate-100">
                        {s.sku} <span className="text-slate-400 dark:text-slate-500 font-normal">— {s.title}</span>
                      </div>
                      <div className="text-xs text-slate-400 dark:text-slate-500">
                        {channels
                          .map((c) => {
                            const cp = currentPrice(s.id, c.id)
                            return cp ? `${c.display_name}: ${formatINR(Number(cp.price))}` : null
                          })
                          .filter(Boolean)
                          .join(' · ') || 'No channel-specific prices'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{base ? formatINR(Number(base.price)) : '—'}</div>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500">base price</div>
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-slate-100 dark:border-slate-700/60 px-4 py-3 bg-slate-50 dark:bg-slate-700/40">
                      {canEdit && (
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4 items-end">
                          <label className="block">
                            <span className="text-xs text-slate-500 dark:text-slate-400">Scope</span>
                            <select value={form.channel_id} onChange={(e) => setForm((f) => ({ ...f, channel_id: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100">
                              <option value={BASE_SCOPE}>Base / internal</option>
                              {channels.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.display_name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block">
                            <span className="text-xs text-slate-500 dark:text-slate-400">Price</span>
                            <input type="number" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
                          </label>
                          <label className="block">
                            <span className="text-xs text-slate-500 dark:text-slate-400">Min selling price</span>
                            <input type="number" value={form.min_selling_price} onChange={(e) => setForm((f) => ({ ...f, min_selling_price: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
                          </label>
                          <label className="block">
                            <span className="text-xs text-slate-500 dark:text-slate-400">Effective from</span>
                            <input type="date" value={form.effective_from} onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))} className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2 py-1.5 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100" />
                          </label>
                          <button onClick={() => setPrice(s)} disabled={saving} className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50">
                            {saving ? 'Saving…' : 'Set price'}
                          </button>
                        </div>
                      )}
                      <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-2">Price history</div>
                      {historyFor(s.id).length === 0 ? (
                        <p className="text-xs text-slate-400 dark:text-slate-500">No prices recorded yet.</p>
                      ) : (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-slate-400 dark:text-slate-500">
                              <th className="py-1 pr-4 font-medium">Scope</th>
                              <th className="py-1 pr-4 font-medium text-right">Price</th>
                              <th className="py-1 pr-4 font-medium text-right">Min selling price</th>
                              <th className="py-1 font-medium">Effective from</th>
                            </tr>
                          </thead>
                          <tbody>
                            {historyFor(s.id).map((p) => (
                              <tr key={p.id}>
                                <td className="py-1 pr-4 text-slate-700 dark:text-slate-300">{p.channel_id ? channels.find((c) => c.id === p.channel_id)?.display_name ?? '—' : 'Base / internal'}</td>
                                <td className="py-1 pr-4 text-right text-slate-700 dark:text-slate-300">{formatINR(Number(p.price))}</td>
                                <td className="py-1 pr-4 text-right text-slate-500 dark:text-slate-400">{p.min_selling_price != null ? formatINR(Number(p.min_selling_price)) : '—'}</td>
                                <td className="py-1 text-slate-500 dark:text-slate-400">{format(new Date(p.effective_from), 'dd MMM yyyy')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
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
