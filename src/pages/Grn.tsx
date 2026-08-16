import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables, Enums } from '../lib/database.types'

type GrnRow = Tables<'grns'> & { warehouses: Tables<'warehouses'> | null }
type GrnLineItem = Tables<'grn_line_items'> & { skus: Tables<'skus'> | null }
type Sku = Tables<'skus'>
type Warehouse = Tables<'warehouses'>

interface DraftLine {
  sku_id: string
  ordered_qty: string
  received_qty: string
  accepted_qty: string
  rejected_qty: string
  reason: string
}

const BLANK_LINE: DraftLine = { sku_id: '', ordered_qty: '', received_qty: '', accepted_qty: '', rejected_qty: '0', reason: '' }

const STATUS_COLOR: Record<Enums<'grn_status'>, string> = {
  draft: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-emerald-100 text-emerald-700',
}

export default function Grn() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [grns, setGrns] = useState<GrnRow[]>([])
  const [loading, setLoading] = useState(true)
  const [skus, setSkus] = useState<Sku[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ warehouse_id: '', supplier_name: '', reference_po: '' })
  const [lines, setLines] = useState<DraftLine[]>([{ ...BLANK_LINE }])
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [linesByGrn, setLinesByGrn] = useState<Record<string, GrnLineItem[]>>({})
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops'

  async function load() {
    if (!orgId) return
    setLoading(true)
    const [{ data: g }, { data: s }, { data: w }] = await Promise.all([
      supabase.from('grns').select('*, warehouses(*)').order('created_at', { ascending: false }),
      supabase.from('skus').select('*').eq('active', true).order('sku'),
      supabase.from('warehouses').select('*').order('name'),
    ])
    setGrns((g as unknown as GrnRow[]) ?? [])
    setSkus(s ?? [])
    setWarehouses(w ?? [])
    if (w && w.length > 0 && !form.warehouse_id) setForm((f) => ({ ...f, warehouse_id: w.find((x) => x.is_default)?.id ?? w[0].id }))
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  async function submitGrn() {
    if (!orgId || !form.warehouse_id) {
      showError('Select a warehouse.')
      return
    }
    const validLines = lines.filter((l) => l.sku_id && l.received_qty !== '')
    if (validLines.length === 0) {
      showError('Add at least one line item.')
      return
    }
    setSaving(true)
    try {
      const { data: grnNumber, error: numError } = await supabase.rpc('next_grn_number')
      if (numError || !grnNumber) throw numError ?? new Error('Could not allocate GRN number')

      const { data: grn, error: grnError } = await supabase
        .from('grns')
        .insert({
          organization_id: orgId,
          grn_number: grnNumber,
          warehouse_id: form.warehouse_id,
          supplier_name: form.supplier_name || null,
          reference_po: form.reference_po || null,
          created_by: profile!.id,
        })
        .select()
        .single()
      if (grnError || !grn) throw grnError ?? new Error('Could not create GRN')

      const { error: linesError } = await supabase.from('grn_line_items').insert(
        validLines.map((l) => ({
          organization_id: orgId,
          grn_id: grn.id,
          sku_id: l.sku_id,
          ordered_qty: Number(l.ordered_qty) || 0,
          received_qty: Number(l.received_qty) || 0,
          accepted_qty: Number(l.accepted_qty) || Number(l.received_qty) || 0,
          rejected_qty: Number(l.rejected_qty) || 0,
          reason: l.reason || null,
        }))
      )
      if (linesError) throw linesError

      showSuccess(`GRN ${grnNumber} created as draft. Confirm it to add stock.`)
      setForm((f) => ({ ...f, supplier_name: '', reference_po: '' }))
      setLines([{ ...BLANK_LINE }])
      setShowNew(false)
      load()
    } catch (err) {
      reportError(showError, 'Create GRN', err as { message: string }, orgId, profile?.id)
    } finally {
      setSaving(false)
    }
  }

  async function expand(g: GrnRow) {
    setExpandedId(expandedId === g.id ? null : g.id)
    if (linesByGrn[g.id]) return
    const { data } = await supabase.from('grn_line_items').select('*, skus(*)').eq('grn_id', g.id)
    setLinesByGrn((m) => ({ ...m, [g.id]: (data as unknown as GrnLineItem[]) ?? [] }))
  }

  // Only a confirmed GRN posts stock - a draft is just a record of what
  // arrived, not yet trusted enough to move inventory.
  async function confirmGrn(g: GrnRow) {
    setConfirmingId(g.id)
    try {
      const { data: lineItems } = await supabase.from('grn_line_items').select('*').eq('grn_id', g.id)
      const withStock = (lineItems ?? []).filter((l) => l.accepted_qty > 0)
      if (withStock.length > 0) {
        const { error: ledgerError } = await supabase.from('inventory_ledger').insert(
          withStock.map((l) => ({
            organization_id: orgId!,
            sku_id: l.sku_id,
            warehouse_id: g.warehouse_id,
            movement_type: 'restock' as const,
            quantity_delta: l.accepted_qty,
            reference_type: 'grn',
            reference_id: g.id,
            note: `GRN ${g.grn_number}${g.supplier_name ? ` — ${g.supplier_name}` : ''}`,
            created_by: profile!.id,
          }))
        )
        if (ledgerError) throw ledgerError
      }
      const { error: statusError } = await supabase.from('grns').update({ status: 'confirmed', confirmed_at: new Date().toISOString() }).eq('id', g.id)
      if (statusError) throw statusError
      showSuccess(`GRN ${g.grn_number} confirmed — stock added. Pending items are now in Put-away.`)
      load()
    } catch (err) {
      reportError(showError, 'Confirm GRN', err as { message: string }, orgId, profile?.id)
    } finally {
      setConfirmingId(null)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold text-slate-900">GRN / Inward</h2>
        {canEdit && (
          <button onClick={() => setShowNew((v) => !v)} className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
            {showNew ? 'Cancel' : '+ New GRN'}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400 mb-6">
        Draft GRNs don't touch stock. Confirming a GRN adds its accepted quantity to physical stock and queues it in Put-away.
      </p>

      {showNew && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <label className="block">
              <span className="text-xs text-slate-500">Warehouse</span>
              <select
                value={form.warehouse_id}
                onChange={(e) => setForm((f) => ({ ...f, warehouse_id: e.target.value }))}
                className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
              >
                {warehouses.length === 0 && <option value="">No warehouses yet</option>}
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Supplier</span>
              <input
                type="text"
                value={form.supplier_name}
                onChange={(e) => setForm((f) => ({ ...f, supplier_name: e.target.value }))}
                className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Reference / PO</span>
              <input
                type="text"
                value={form.reference_po}
                onChange={(e) => setForm((f) => ({ ...f, reference_po: e.target.value }))}
                className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
              />
            </label>
          </div>

          <div className="text-xs text-slate-500 mb-2">Line items</div>
          <div className="space-y-2 mb-3">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-6 gap-2 items-center">
                <select
                  value={l.sku_id}
                  onChange={(e) => updateLine(i, { sku_id: e.target.value })}
                  className="col-span-2 text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                >
                  <option value="">Select SKU…</option>
                  {skus.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.sku} — {s.title}
                    </option>
                  ))}
                </select>
                <input type="number" placeholder="Ordered" value={l.ordered_qty} onChange={(e) => updateLine(i, { ordered_qty: e.target.value })} className="text-sm rounded-lg border border-slate-300 px-2 py-1.5" />
                <input type="number" placeholder="Received" value={l.received_qty} onChange={(e) => updateLine(i, { received_qty: e.target.value })} className="text-sm rounded-lg border border-slate-300 px-2 py-1.5" />
                <input type="number" placeholder="Accepted" value={l.accepted_qty} onChange={(e) => updateLine(i, { accepted_qty: e.target.value })} className="text-sm rounded-lg border border-slate-300 px-2 py-1.5" />
                <div className="flex items-center gap-1">
                  <input type="number" placeholder="Rejected" value={l.rejected_qty} onChange={(e) => updateLine(i, { rejected_qty: e.target.value })} className="w-full text-sm rounded-lg border border-slate-300 px-2 py-1.5" />
                  <button onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} disabled={lines.length === 1} className="text-xs text-slate-400 hover:text-red-600 disabled:opacity-30">
                    ✕
                  </button>
                </div>
              </div>
            ))}
            <button onClick={() => setLines((ls) => [...ls, { ...BLANK_LINE }])} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
              + Add line item
            </button>
          </div>

          <button onClick={submitGrn} disabled={saving || skus.length === 0} className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save as draft'}
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <Skeleton rows={3} />
        ) : grns.length === 0 ? (
          <EmptyState icon="📦" title="No GRNs yet." />
        ) : (
          <div className="divide-y divide-slate-50">
            {grns.map((g) => (
              <div key={g.id}>
                <button onClick={() => expand(g)} className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50">
                  <div>
                    <div className="font-medium text-sm text-slate-900">
                      {g.grn_number} — {g.warehouses?.name ?? '—'}
                      {g.supplier_name && <span className="text-slate-400 font-normal"> · {g.supplier_name}</span>}
                    </div>
                    <div className="text-xs text-slate-400">{format(new Date(g.created_at), 'dd MMM yyyy, HH:mm')}</div>
                  </div>
                  <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${STATUS_COLOR[g.status]}`}>{g.status}</span>
                </button>
                {expandedId === g.id && (
                  <div className="border-t border-slate-100 px-4 py-3 bg-slate-50">
                    <table className="w-full text-sm mb-3">
                      <thead>
                        <tr className="text-left text-xs text-slate-400">
                          <th className="py-1 font-medium">SKU</th>
                          <th className="py-1 font-medium text-right">Ordered</th>
                          <th className="py-1 font-medium text-right">Received</th>
                          <th className="py-1 font-medium text-right">Accepted</th>
                          <th className="py-1 font-medium text-right">Rejected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(linesByGrn[g.id] ?? []).map((l) => (
                          <tr key={l.id}>
                            <td className="py-1 text-slate-700">{l.skus?.sku}</td>
                            <td className="py-1 text-right text-slate-500">{l.ordered_qty}</td>
                            <td className="py-1 text-right text-slate-500">{l.received_qty}</td>
                            <td className="py-1 text-right text-emerald-600 font-medium">{l.accepted_qty}</td>
                            <td className="py-1 text-right text-red-500">{l.rejected_qty}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {canEdit && g.status === 'draft' && (
                      <button
                        onClick={() => confirmGrn(g)}
                        disabled={confirmingId === g.id}
                        className="text-xs font-medium rounded-lg bg-emerald-600 text-white px-3 py-1.5 hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {confirmingId === g.id ? 'Confirming…' : 'Confirm GRN (adds stock)'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
