import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import { formatINR } from '../lib/format'
import { calculateInvoice } from '../lib/gstInvoice'
import { buildInvoicePdf } from '../lib/invoicePdf'
import ConfirmDialog from '../components/ConfirmDialog'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import Pagination from '../components/Pagination'
import type { Tables, Enums } from '../lib/database.types'

type Order = Tables<'orders'> & { channels: Tables<'channels'> | null }
type Channel = Tables<'channels'>
type Organization = Tables<'organizations'>
type Sku = Tables<'skus'>

interface LineItemDraft {
  sku_id: string
  quantity: string
  unit_price: string
}

const BLANK_LINE_ITEM: LineItemDraft = { sku_id: '', quantity: '1', unit_price: '' }
const PAGE_SIZE = 20
const STATUSES: Enums<'order_status'>[] = ['pending', 'shipped', 'delivered', 'cancelled', 'returned']

const STATUS_COLOR: Record<Order['order_status'], string> = {
  pending: 'bg-amber-100 text-amber-700',
  shipped: 'bg-blue-100 text-blue-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
  returned: 'bg-red-100 text-red-700',
}

export default function Dashboard() {
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()
  const [orders, setOrders] = useState<Order[]>([])
  const [totalOrders, setTotalOrders] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<Enums<'order_status'> | ''>('')
  const [stats, setStats] = useState({ gross: 0, pending: 0, shipped: 0 })
  const [channels, setChannels] = useState<Channel[]>([])
  const [org, setOrg] = useState<Organization | null>(null)
  const [invoicedOrderIds, setInvoicedOrderIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [confirmInvoiceFor, setConfirmInvoiceFor] = useState<Order | null>(null)
  const [skus, setSkus] = useState<Sku[]>([])
  const [showNewOrder, setShowNewOrder] = useState(false)
  const [creatingChannel, setCreatingChannel] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)
  const [orderForm, setOrderForm] = useState({ amazon_order_id: '', order_date: format(new Date(), 'yyyy-MM-dd'), buyer_state: '', ship_state: '', channel_id: '' })
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([{ ...BLANK_LINE_ITEM }])
  const orgId = profile?.organization_id
  const canEdit = profile?.role === 'admin' || profile?.role === 'ops'

  async function loadOrders() {
    setLoading(true)
    let query = supabase.from('orders').select('*, channels(*)', { count: 'exact' }).order('order_date', { ascending: false })
    if (search.trim()) query = query.ilike('amazon_order_id', `%${search.trim()}%`)
    if (statusFilter) query = query.eq('order_status', statusFilter)
    const { data, count } = await query.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    setOrders((data as unknown as Order[]) ?? [])
    setTotalOrders(count ?? 0)
    setLoading(false)
  }

  async function loadStats() {
    const { data } = await supabase.from('orders').select('gross_amount, order_status')
    const rows = data ?? []
    setStats({
      gross: rows.reduce((sum, r) => sum + Number(r.gross_amount), 0),
      pending: rows.filter((r) => r.order_status === 'pending').length,
      shipped: rows.filter((r) => r.order_status === 'shipped').length,
    })
  }

  async function loadSupportingData() {
    if (!orgId) return
    const [{ data: c }, { data: orgRow }, { data: inv }, { data: s }] = await Promise.all([
      supabase.from('channels').select('*'),
      supabase.from('organizations').select('*').eq('id', orgId).single(),
      supabase.from('gst_invoices').select('order_id'),
      supabase.from('skus').select('*').eq('active', true).order('sku'),
    ])
    setChannels(c ?? [])
    setOrg(orgRow ?? null)
    setInvoicedOrderIds(new Set((inv ?? []).map((i) => i.order_id)))
    setSkus(s ?? [])
    if (c && c.length > 0 && !orderForm.channel_id) setOrderForm((f) => ({ ...f, channel_id: c[0].id }))
  }

  useEffect(() => {
    if (!orgId) return
    loadSupportingData()
    loadStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  useEffect(() => {
    if (!orgId) return
    loadOrders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, page, search, statusFilter])

  useEffect(() => {
    setPage(0)
  }, [search, statusFilter])

  async function createTestChannel() {
    if (!orgId) return
    setCreatingChannel(true)
    const { error } = await supabase.from('channels').insert({
      organization_id: orgId,
      marketplace_id: 'A21TJRUUN4KGV',
      seller_id: 'MANUAL-TEST',
      display_name: 'Manual Test Channel',
      status: 'manual',
      connected_by: profile!.id,
      connected_at: new Date().toISOString(),
    })
    setCreatingChannel(false)
    if (error) {
      reportError(showError, 'Create test channel', error, orgId, profile?.id)
      return
    }
    showSuccess('Test channel created — manual orders can now be entered against it.')
    loadSupportingData()
  }

  function updateLineItem(index: number, patch: Partial<LineItemDraft>) {
    setLineItems((items) => items.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  }

  async function submitOrder() {
    if (!orgId) return
    if (!orderForm.amazon_order_id.trim() || !orderForm.channel_id) {
      showError('Order ID and channel are required.')
      return
    }
    const validLines = lineItems.filter((li) => li.sku_id && Number(li.quantity) > 0 && li.unit_price !== '')
    if (validLines.length === 0) {
      showError('Add at least one line item with a SKU, quantity, and price.')
      return
    }

    setSavingOrder(true)
    try {
      const grossAmount = validLines.reduce((sum, li) => sum + Number(li.quantity) * Number(li.unit_price), 0)

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          organization_id: orgId,
          channel_id: orderForm.channel_id,
          amazon_order_id: orderForm.amazon_order_id.trim(),
          order_date: new Date(orderForm.order_date).toISOString(),
          buyer_state: orderForm.buyer_state || null,
          ship_state: orderForm.ship_state || orderForm.buyer_state || null,
          gross_amount: grossAmount,
        })
        .select()
        .single()
      if (orderError || !order) throw orderError ?? new Error('Could not create order')

      const { error: liError } = await supabase.from('order_line_items').insert(
        validLines.map((li) => ({
          organization_id: orgId,
          order_id: order.id,
          sku_id: li.sku_id,
          quantity: Number(li.quantity),
          unit_price: Number(li.unit_price),
        }))
      )
      if (liError) throw liError

      const { error: ledgerError } = await supabase.from('inventory_ledger').insert(
        validLines.map((li) => ({
          organization_id: orgId,
          sku_id: li.sku_id,
          movement_type: 'order_deduction' as const,
          quantity_delta: -Number(li.quantity),
          order_id: order.id,
          note: `Manual order ${orderForm.amazon_order_id.trim()}`,
        }))
      )
      if (ledgerError) throw ledgerError

      showSuccess(`Order ${orderForm.amazon_order_id} created.`)
      setOrderForm((f) => ({ ...f, amazon_order_id: '', buyer_state: '', ship_state: '' }))
      setLineItems([{ ...BLANK_LINE_ITEM }])
      setShowNewOrder(false)
      loadOrders()
      loadStats()
    } catch (err) {
      reportError(showError, 'Create manual order', err as { message: string }, orgId, profile?.id)
    } finally {
      setSavingOrder(false)
    }
  }

  async function generateInvoice(order: Order) {
    if (!org || !orgId) return
    setGeneratingId(order.id)
    try {
      const { data: lineItems, error: liError } = await supabase
        .from('order_line_items')
        .select('*, skus(*)')
        .eq('order_id', order.id)
      if (liError) throw liError
      if (!lineItems || lineItems.length === 0) {
        showError('No line items on this order — cannot generate an invoice.')
        return
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const calc = calculateInvoice(org.state, order.buyer_state, lineItems as any)

      const { data: invoiceNumber, error: numError } = await supabase.rpc('next_invoice_number')
      if (numError || !invoiceNumber) throw numError ?? new Error('Could not allocate invoice number')

      const pdfBlob = buildInvoicePdf(org, order, invoiceNumber, calc)
      const path = `${orgId}/${invoiceNumber}.pdf`
      const { error: uploadError } = await supabase.storage.from('invoices').upload(path, pdfBlob, { contentType: 'application/pdf' })
      if (uploadError) throw uploadError

      const { error: insertError } = await supabase.from('gst_invoices').insert({
        organization_id: orgId,
        order_id: order.id,
        invoice_number: invoiceNumber,
        invoice_type: calc.invoiceType,
        taxable_value: calc.taxableValue,
        cgst_amount: calc.cgstAmount,
        sgst_amount: calc.sgstAmount,
        igst_amount: calc.igstAmount,
        total_amount: calc.totalAmount,
        pdf_url: path,
      })
      if (insertError) throw insertError

      showSuccess(`Invoice ${invoiceNumber} generated.`)
      setInvoicedOrderIds((s) => new Set(s).add(order.id))
    } catch (err) {
      reportError(showError, 'Generate invoice', err as { message: string }, orgId, profile?.id)
    } finally {
      setGeneratingId(null)
      setConfirmInvoiceFor(null)
    }
  }

  const connectedChannels = channels.filter((c) => c.status === 'connected')

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Orders</h2>
          <p className="text-xs text-slate-400 mt-0.5">{format(new Date(), 'EEEE, dd MMMM yyyy')}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/integrations" className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700">
            🔌 Connect Amazon
          </Link>
          {canEdit && channels.length > 0 && (
            <button
              onClick={() => setShowNewOrder((v) => !v)}
              className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
            >
              {showNewOrder ? 'Cancel' : '+ New order'}
            </button>
          )}
        </div>
      </div>

      {channels.length === 0 && !loading && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-800 flex items-center justify-between gap-3 flex-wrap">
          <span>
            No Amazon channel connected yet. Orders won't sync until SP-API credentials are added —{' '}
            <Link to="/integrations" className="underline font-medium">connect one here</Link>.
          </span>
          {profile?.role === 'admin' && (
            <button
              onClick={createTestChannel}
              disabled={creatingChannel}
              className="text-xs font-medium rounded-lg border border-amber-300 bg-white px-3 py-1.5 hover:bg-amber-100 disabled:opacity-50 whitespace-nowrap"
            >
              {creatingChannel ? 'Creating…' : 'Create test channel for a dry run'}
            </button>
          )}
        </div>
      )}

      {showNewOrder && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6">
          <div className="text-xs font-semibold uppercase text-slate-500 mb-3">New manual order</div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-3">
            <Field label="Order ID" value={orderForm.amazon_order_id} onChange={(v) => setOrderForm((f) => ({ ...f, amazon_order_id: v }))} placeholder="TEST-001" />
            <label className="block">
              <span className="text-xs text-slate-500">Order date</span>
              <input
                type="date"
                value={orderForm.order_date}
                onChange={(e) => setOrderForm((f) => ({ ...f, order_date: e.target.value }))}
                className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
              />
            </label>
            <Field label="Buyer state" value={orderForm.buyer_state} onChange={(v) => setOrderForm((f) => ({ ...f, buyer_state: v }))} placeholder="e.g. Rajasthan" />
            {channels.length > 1 ? (
              <label className="block">
                <span className="text-xs text-slate-500">Channel</span>
                <select
                  value={orderForm.channel_id}
                  onChange={(e) => setOrderForm((f) => ({ ...f, channel_id: e.target.value }))}
                  className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                >
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.display_name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <Field label="Ship state" value={orderForm.ship_state} onChange={(v) => setOrderForm((f) => ({ ...f, ship_state: v }))} placeholder="defaults to buyer state" />
            )}
          </div>

          <div className="text-xs text-slate-500 mb-2">Line items</div>
          {skus.length === 0 ? (
            <p className="text-sm text-slate-400 mb-3">
              No SKUs yet — <Link to="/inventory" className="underline font-medium">add one under Inventory</Link> first.
            </p>
          ) : (
            <div className="space-y-2 mb-3">
              {lineItems.map((li, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={li.sku_id}
                    onChange={(e) => updateLineItem(i, { sku_id: e.target.value })}
                    className="flex-1 text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                  >
                    <option value="">Select SKU…</option>
                    {skus.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.sku} — {s.title}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    value={li.quantity}
                    onChange={(e) => updateLineItem(i, { quantity: e.target.value })}
                    placeholder="Qty"
                    className="w-20 text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                  />
                  <input
                    type="number"
                    value={li.unit_price}
                    onChange={(e) => updateLineItem(i, { unit_price: e.target.value })}
                    placeholder="Unit price"
                    className="w-28 text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
                  />
                  <button
                    onClick={() => setLineItems((items) => items.filter((_, idx) => idx !== i))}
                    disabled={lineItems.length === 1}
                    className="text-xs text-slate-400 hover:text-red-600 disabled:opacity-30"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button onClick={() => setLineItems((items) => [...items, { ...BLANK_LINE_ITEM }])} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
                + Add line item
              </button>
            </div>
          )}

          <button
            onClick={submitOrder}
            disabled={savingOrder || skus.length === 0}
            className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50"
          >
            {savingOrder ? 'Creating…' : 'Create order'}
          </button>
        </div>
      )}

      {org && !org.state && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-800">
          Your organization's state isn't set — GST invoices can't tell CGST/SGST from IGST without it. Set it under{' '}
          <Link to="/team" className="underline font-medium">Team → Organization</Link>.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <Stat label="Gross sales (all orders)" value={formatINR(stats.gross)} accent="indigo" />
        <Stat label="Pending" value={String(stats.pending)} accent="amber" />
        <Stat label="Shipped" value={String(stats.shipped)} accent="purple" />
        <Stat label="Channels connected" value={String(connectedChannels.length)} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <span className="text-xs font-semibold uppercase text-slate-500">Orders</span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search order ID…"
              className="text-sm rounded-lg border border-slate-300 px-2.5 py-1.5 w-40"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as Enums<'order_status'> | '')}
              className="text-sm rounded-lg border border-slate-300 px-2 py-1.5"
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
        {loading ? (
          <Skeleton />
        ) : orders.length === 0 ? (
          <EmptyState icon="📦" title={search || statusFilter ? 'No orders match this filter.' : 'No orders yet.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-2 font-medium">Order ID</th>
                  <th className="px-4 py-2 font-medium">Channel</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium text-right">Amount</th>
                  <th className="px-4 py-2 font-medium text-right">Invoice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {orders.map((o) => {
                  const invoiced = invoicedOrderIds.has(o.id)
                  return (
                    <tr key={o.id}>
                      <td className="px-4 py-2.5 font-medium text-slate-700">{o.amazon_order_id}</td>
                      <td className="px-4 py-2.5 text-slate-500">{o.channels?.display_name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-slate-500">{format(new Date(o.order_date), 'dd MMM yyyy')}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${STATUS_COLOR[o.order_status]}`}>
                          {o.order_status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-700">{formatINR(Number(o.gross_amount))}</td>
                      <td className="px-4 py-2.5 text-right">
                        {invoiced ? (
                          <Link to="/invoices" className="text-xs text-emerald-600 font-medium hover:underline">
                            Generated
                          </Link>
                        ) : (
                          <button
                            onClick={() => setConfirmInvoiceFor(o)}
                            disabled={generatingId === o.id}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
                          >
                            {generatingId === o.id ? 'Generating…' : 'Generate invoice'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && orders.length > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={totalOrders} onPageChange={setPage} />}
      </div>

      {confirmInvoiceFor && (
        <ConfirmDialog
          title="Generate GST invoice?"
          message={`This permanently consumes the next invoice number for order ${confirmInvoiceFor.amazon_order_id}. Cannot be undone.`}
          confirmLabel="Generate"
          busy={generatingId === confirmInvoiceFor.id}
          onConfirm={() => generateInvoice(confirmInvoiceFor)}
          onCancel={() => setConfirmInvoiceFor(null)}
        />
      )}
    </div>
  )
}

const ACCENTS = {
  indigo: 'from-indigo-500 to-indigo-600',
  purple: 'from-purple-500 to-purple-600',
  amber: 'from-amber-500 to-amber-600',
} as const

function Stat({ label, value, accent }: { label: string; value: string; accent?: keyof typeof ACCENTS }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5 sm:p-4 relative overflow-hidden">
      {accent && <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${ACCENTS[accent]}`} />}
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-lg sm:text-xl font-semibold mt-1 text-slate-900">{value}</div>
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
        className="mt-1 w-full text-sm rounded-lg border border-slate-300 px-2.5 py-1.5"
      />
    </label>
  )
}
