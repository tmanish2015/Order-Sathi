import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'
import { formatINR } from '../lib/format'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import type { Tables, Enums } from '../lib/database.types'

type Order = Tables<'orders'> & { channels: Tables<'channels'> | null }
type LineItem = Tables<'order_line_items'> & { skus: Tables<'skus'> | null; warehouses: Tables<'warehouses'> | null }
type Shipment = Tables<'shipments'>
type Invoice = Tables<'gst_invoices'>
type StatusEvent = Tables<'order_status_history'>

const STATUS_LABEL: Record<Enums<'order_status'>, string> = {
  new: 'New',
  confirmed: 'Confirmed',
  inventory_allocated: 'Inventory Allocated',
  partially_allocated: 'Partially Allocated',
  stock_shortage: 'Stock Shortage',
  ready_to_pick: 'Ready to Pick',
  picked: 'Picked',
  packed: 'Packed',
  ready_to_ship: 'Ready to Ship',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  returned: 'Returned',
  rto: 'RTO',
}

const STATUS_COLOR: Record<Enums<'order_status'>, string> = {
  new: 'bg-slate-100 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300',
  confirmed: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  inventory_allocated: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  partially_allocated: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  stock_shortage: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  ready_to_pick: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  picked: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  packed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  ready_to_ship: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  shipped: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  delivered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  cancelled: 'bg-slate-100 text-slate-500 dark:bg-slate-900/40 dark:text-slate-400',
  returned: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  rto: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

const PRIORITY_COLOR: Record<Enums<'order_priority'>, string> = {
  normal: 'bg-slate-100 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300',
  high: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const { showError } = useToast()
  const orgId = profile?.organization_id

  const [order, setOrder] = useState<Order | null>(null)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [shipment, setShipment] = useState<Shipment | null>(null)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [history, setHistory] = useState<StatusEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!id) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function load() {
    setLoading(true)
    const [{ data: o }, { data: li }, { data: ship }, { data: inv }, { data: hist }] = await Promise.all([
      supabase.from('orders').select('*, channels(*)').eq('id', id!).maybeSingle(),
      supabase.from('order_line_items').select('*, skus(*), warehouses(*)').eq('order_id', id!),
      supabase.from('shipments').select('*').eq('order_id', id!).maybeSingle(),
      supabase.from('gst_invoices').select('*').eq('order_id', id!).maybeSingle(),
      supabase.from('order_status_history').select('*').eq('order_id', id!).order('changed_at', { ascending: true }),
    ])
    if (!o) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setOrder(o as unknown as Order)
    setLineItems((li as unknown as LineItem[]) ?? [])
    setShipment(ship ?? null)
    setInvoice(inv ?? null)
    setHistory(hist ?? [])
    setLoading(false)
  }

  async function downloadInvoice() {
    if (!invoice?.pdf_url) return
    setDownloading(true)
    const { data, error } = await supabase.storage.from('invoices').createSignedUrl(invoice.pdf_url, 60)
    setDownloading(false)
    if (error || !data) {
      reportError(showError, 'Download invoice', error ?? { message: 'No signed URL returned' }, orgId, profile?.id)
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">
        <Skeleton rows={6} />
      </div>
    )
  }

  if (notFound || !order) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">
        <Link to="/orders" className="text-sm text-indigo-600 hover:text-indigo-700">← Back to orders</Link>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm mt-4">
          <EmptyState icon="🔍" title="Order not found." />
        </div>
      </div>
    )
  }

  const grossTotal = lineItems.reduce((sum, l) => sum + l.quantity * Number(l.unit_price), 0)

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <Link to="/orders" className="text-sm text-indigo-600 hover:text-indigo-700">← Back to orders</Link>

      <div className="flex flex-wrap items-center justify-between gap-3 mt-3 mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{order.amazon_order_id}</h2>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{format(new Date(order.order_date), 'EEEE, dd MMMM yyyy')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold uppercase px-2.5 py-1 rounded ${STATUS_COLOR[order.order_status]}`}>{STATUS_LABEL[order.order_status]}</span>
          <span className={`text-xs font-semibold uppercase px-2.5 py-1 rounded ${PRIORITY_COLOR[order.priority]}`}>{order.priority}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Field label="Channel" value={order.channels?.display_name ?? '—'} />
        <Field label="Customer" value={order.customer_name ?? '—'} />
        <Field label="Payment" value={order.payment_type ?? '—'} />
        <Field label="Value" value={formatINR(Number(order.gross_amount))} />
        <Field label="Buyer state" value={order.buyer_state ?? '—'} />
        <Field label="Ship state" value={order.ship_state ?? '—'} />
        <Field label="SLA due" value={order.sla_due_at ? format(new Date(order.sla_due_at), 'dd MMM yyyy, HH:mm') : '—'} />
        <Field label="Created" value={format(new Date(order.created_at), 'dd MMM yyyy, HH:mm')} />
      </div>

      {order.ship_address && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 mb-6">
          <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1">Shipping address</div>
          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{order.ship_address}</p>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/60 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Line items</div>
        {lineItems.length === 0 ? (
          <EmptyState icon="📦" title="No line items on this order." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-700/60">
                  <th className="px-4 py-2 font-medium">SKU</th>
                  <th className="px-4 py-2 font-medium">Title</th>
                  <th className="px-4 py-2 font-medium">Warehouse</th>
                  <th className="px-4 py-2 font-medium text-right">Qty</th>
                  <th className="px-4 py-2 font-medium text-right">Unit price</th>
                  <th className="px-4 py-2 font-medium text-right">Line total</th>
                  <th className="px-4 py-2 font-medium text-right">Allocated</th>
                  <th className="px-4 py-2 font-medium text-right">Picked</th>
                  <th className="px-4 py-2 font-medium text-right">Packed</th>
                  <th className="px-4 py-2 font-medium text-right">Shipped</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
                {lineItems.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-300">{l.skus?.sku ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{l.skus?.title ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{l.warehouses?.name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{l.quantity}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{formatINR(Number(l.unit_price))}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-300">{formatINR(l.quantity * Number(l.unit_price))}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{l.allocated_qty}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{l.picked_qty}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{l.packed_qty}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">{l.shipped_qty}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-100 dark:border-slate-700/60">
                  <td colSpan={5} className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Total</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-slate-900 dark:text-slate-100">{formatINR(grossTotal)}</td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4">
          <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-2">Shipment</div>
          {shipment ? (
            <div className="text-sm text-slate-700 dark:text-slate-300 space-y-1">
              <div>{shipment.courier_name} / {shipment.awb_number}</div>
              <div className="text-xs text-slate-400 dark:text-slate-500 capitalize">{shipment.status.replace(/_/g, ' ')}</div>
              <div className="text-xs text-slate-400 dark:text-slate-500">Shipped {format(new Date(shipment.shipped_at), 'dd MMM yyyy, HH:mm')}</div>
              {shipment.tracking_url && (
                <a href={shipment.tracking_url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline">
                  Track shipment
                </a>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400 dark:text-slate-500">Not shipped yet.</p>
          )}
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4">
          <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-2">GST invoice</div>
          {invoice ? (
            <div className="text-sm text-slate-700 dark:text-slate-300 space-y-1">
              <div>{invoice.invoice_number} · {invoice.invoice_type}</div>
              <div className="text-xs text-slate-400 dark:text-slate-500">{formatINR(Number(invoice.total_amount))} · issued {format(new Date(invoice.issued_at), 'dd MMM yyyy')}</div>
              {invoice.pdf_url && (
                <button onClick={downloadInvoice} disabled={downloading} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50">
                  {downloading ? 'Preparing…' : 'Download PDF'}
                </button>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400 dark:text-slate-500">
              Not generated — go to <Link to="/orders" className="underline font-medium">Orders</Link> to generate one.
            </p>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4">
        <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-3">Status timeline</div>
        {history.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No status changes recorded yet.</p>
        ) : (
          <ol className="space-y-3">
            {history.map((h) => (
              <li key={h.id} className="flex items-start gap-3 text-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 shrink-0" />
                <div>
                  <div className="text-slate-700 dark:text-slate-300">
                    {h.previous_status ? (
                      <>
                        {STATUS_LABEL[h.previous_status]} <span className="text-slate-400 dark:text-slate-500">→</span> {STATUS_LABEL[h.new_status]}
                      </>
                    ) : (
                      <>Created as {STATUS_LABEL[h.new_status]}</>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 dark:text-slate-500">{format(new Date(h.changed_at), 'dd MMM yyyy, HH:mm')}{h.reason ? ` · ${h.reason}` : ''}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-3">
      <div className="text-xs text-slate-400 dark:text-slate-500">{label}</div>
      <div className="text-sm font-medium mt-0.5 text-slate-900 dark:text-slate-100 truncate">{value}</div>
    </div>
  )
}
